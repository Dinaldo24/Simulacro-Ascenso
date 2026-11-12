import { randomUUID } from "crypto";
import { access, mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { FindOptionsWhere } from "typeorm";
import { env } from "../../../config/env";
import { AppDataSource } from "../../../database/data-source";
import { resolverRutaSegura } from "../../../utils/storage";
import { eliminarExamen } from "../../examen/services/ExamenCatalogoService";
import { Documento } from "../entities/Documento";

export const directorioDocumentos = env.storage.documentosDir;

export type TipoArchivoDocumento = "preguntas" | "respuestas";

export interface ArchivoPdfEntrada {
    nombreOriginal: string;
    contenido: Buffer;
}

export interface GuardarDocumentoParams {
    nombreOriginal: string;
    contenido: Buffer;
    respuestasNombreOriginal?: string | undefined;
    respuestasContenido?: Buffer | undefined;
    titulo?: string | undefined;
    curso?: string | undefined;
    anio?: string | undefined;
}

export interface ActualizarDocumentoParams {
    titulo?: string | undefined;
    curso?: string | null | undefined;
    anio?: string | null | undefined;
    paginaPortada?: number | undefined;
    pdfPreguntas?: ArchivoPdfEntrada | undefined;
    pdfRespuestas?: ArchivoPdfEntrada | undefined;
    eliminarRespuestas?: boolean | undefined;
}

function normalizarNombreOriginal(nombreOriginal: string): string {
    return path.basename(nombreOriginal).slice(0, 255) || "documento.pdf";
}

function resolverTituloDocumento(params: {
    titulo?: string | undefined;
    curso?: string | null | undefined;
    anio?: string | null | undefined;
    nombreOriginal: string;
}): string {
    const titulo = params.titulo?.trim();
    if (titulo) return titulo.slice(0, 150);

    const partes = [params.curso?.trim(), params.anio?.trim()].filter(Boolean);
    if (partes.length > 0) {
        return `Material ${partes.join(" ")}`.slice(0, 150);
    }

    const base = path.basename(params.nombreOriginal, path.extname(params.nombreOriginal)).trim();
    return (base || "Material sin título").slice(0, 150);
}

async function guardarPdfEnDisco(contenido: Buffer): Promise<string> {
    await mkdir(directorioDocumentos, { recursive: true });
    const nombreArchivo = `${randomUUID()}.pdf`;
    const rutaArchivo = resolverRutaSegura(directorioDocumentos, nombreArchivo);
    await writeFile(rutaArchivo, contenido, { flag: "wx" });
    return nombreArchivo;
}

async function eliminarArchivoEnDisco(
    nombreArchivo: string | null | undefined,
    ignorarErrores: boolean = false,
): Promise<void> {
    if (!nombreArchivo) return;
    const rutaArchivo = resolverRutaSegura(directorioDocumentos, nombreArchivo);
    try {
        await unlink(rutaArchivo);
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === "ENOENT") return;
        if (ignorarErrores) {
            console.error(`No se pudo limpiar el PDF ${nombreArchivo}:`, error);
            return;
        }
        throw error;
    }
}

async function limpiarArchivosSilencioso(nombres: (string | null | undefined)[]): Promise<void> {
    for (const nombre of nombres) {
        await eliminarArchivoEnDisco(nombre, true);
    }
}

export async function guardarDocumento(params: GuardarDocumentoParams): Promise<Documento> {
    const archivosCreados: string[] = [];

    try {
        const nombreArchivo = await guardarPdfEnDisco(params.contenido);
        archivosCreados.push(nombreArchivo);

        let respuestasNombreArchivo: string | null = null;
        let respuestasNombreOriginal: string | null = null;
        let respuestasTipoMime: string | null = null;
        let respuestasTamanio: number | null = null;

        if (params.respuestasContenido) {
            respuestasNombreArchivo = await guardarPdfEnDisco(params.respuestasContenido);
            archivosCreados.push(respuestasNombreArchivo);
            respuestasNombreOriginal = normalizarNombreOriginal(
                params.respuestasNombreOriginal || "respuestas.pdf",
            );
            respuestasTipoMime = "application/pdf";
            respuestasTamanio = params.respuestasContenido.length;
        }

        const repository = AppDataSource.getRepository(Documento);
        const curso = params.curso?.trim() || null;
        const anio = params.anio?.trim() || null;
        const nombreOriginal = normalizarNombreOriginal(params.nombreOriginal);

        const documento = repository.create({
            titulo: resolverTituloDocumento({
                titulo: params.titulo,
                curso,
                anio,
                nombreOriginal,
            }),
            curso,
            anio,
            nombreOriginal,
            nombreArchivo,
            tipoMime: "application/pdf",
            tamanio: params.contenido.length,
            respuestasNombreOriginal,
            respuestasNombreArchivo,
            respuestasTipoMime,
            respuestasTamanio,
            paginaPortada: 1,
        });
        return await repository.save(documento);
    } catch (error) {
        await limpiarArchivosSilencioso(archivosCreados);
        throw error;
    }
}

export async function listarDocumentos(filtros?: {
    curso?: string | undefined;
    anio?: string | undefined;
}): Promise<Documento[]> {
    const repository = AppDataSource.getRepository(Documento);
    const where: FindOptionsWhere<Documento> = {};
    if (filtros?.curso) where.curso = filtros.curso;
    if (filtros?.anio) where.anio = filtros.anio;

    return repository.find({
        where,
        order: { creadoEn: "DESC" },
    });
}

export async function buscarDocumento(id: number): Promise<Documento | null> {
    return AppDataSource.getRepository(Documento).findOneBy({ id });
}

export async function buscarDocumentosDeExamen(params: {
    anio: string;
    curso: string;
    archivoBase?: string | null | undefined;
    titulo?: string | undefined;
}): Promise<Documento[]> {
    const anio = params.anio.trim();
    const curso = params.curso.trim();
    const titulo = (params.titulo?.trim() || `Examen EBR ${curso} ${anio}`).slice(0, 150);
    const nombrePreguntas = params.archivoBase ? `${params.archivoBase}_Preguntas.pdf` : null;

    const consulta = AppDataSource.getRepository(Documento)
        .createQueryBuilder("d")
        .where("d.anio = :anio", { anio })
        .andWhere("d.curso = :curso", { curso });

    if (nombrePreguntas) {
        consulta.andWhere("(d.titulo = :titulo OR d.nombreOriginal = :nombrePreguntas)", {
            titulo,
            nombrePreguntas,
        });
    } else {
        consulta.andWhere("d.titulo = :titulo", { titulo });
    }

    return consulta.getMany();
}

export async function obtenerRutaDocumentoExistente(
    documento: Documento,
    tipo: TipoArchivoDocumento = "preguntas",
): Promise<string | null> {
    const nombreArchivo =
        tipo === "respuestas" ? documento.respuestasNombreArchivo : documento.nombreArchivo;
    if (!nombreArchivo) return null;

    const rutaArchivo = resolverRutaSegura(directorioDocumentos, nombreArchivo);
    try {
        await access(rutaArchivo);
        return rutaArchivo;
    } catch {
        return null;
    }
}

export async function actualizarDocumento(
    id: number,
    cambios: ActualizarDocumentoParams,
): Promise<Documento | null> {
    const repository = AppDataSource.getRepository(Documento);
    const documento = await repository.findOneBy({ id });
    if (!documento) return null;

    const archivosNuevos: string[] = [];
    const archivosARetirar: string[] = [];

    try {
        if (cambios.titulo !== undefined) {
            documento.titulo = cambios.titulo.trim().slice(0, 150);
        }
        if (cambios.curso !== undefined) {
            documento.curso = cambios.curso?.trim() || null;
        }
        if (cambios.anio !== undefined) {
            documento.anio = cambios.anio?.trim() || null;
        }
        if (cambios.paginaPortada !== undefined) {
            documento.paginaPortada = cambios.paginaPortada;
        }

        if (cambios.pdfPreguntas) {
            const nuevoArchivo = await guardarPdfEnDisco(cambios.pdfPreguntas.contenido);
            archivosNuevos.push(nuevoArchivo);
            archivosARetirar.push(documento.nombreArchivo);
            documento.nombreOriginal = normalizarNombreOriginal(cambios.pdfPreguntas.nombreOriginal);
            documento.nombreArchivo = nuevoArchivo;
            documento.tipoMime = "application/pdf";
            documento.tamanio = cambios.pdfPreguntas.contenido.length;
        }

        if (cambios.pdfRespuestas) {
            const nuevoResp = await guardarPdfEnDisco(cambios.pdfRespuestas.contenido);
            archivosNuevos.push(nuevoResp);
            if (documento.respuestasNombreArchivo) {
                archivosARetirar.push(documento.respuestasNombreArchivo);
            }
            documento.respuestasNombreOriginal = normalizarNombreOriginal(cambios.pdfRespuestas.nombreOriginal);
            documento.respuestasNombreArchivo = nuevoResp;
            documento.respuestasTipoMime = "application/pdf";
            documento.respuestasTamanio = cambios.pdfRespuestas.contenido.length;
        } else if (cambios.eliminarRespuestas) {
            if (documento.respuestasNombreArchivo) {
                archivosARetirar.push(documento.respuestasNombreArchivo);
            }
            documento.respuestasNombreOriginal = null;
            documento.respuestasNombreArchivo = null;
            documento.respuestasTipoMime = null;
            documento.respuestasTamanio = null;
        }

        const actualizado = await repository.save(documento);
        await limpiarArchivosSilencioso(archivosARetirar);
        return actualizado;
    } catch (error) {
        await limpiarArchivosSilencioso(archivosNuevos);
        throw error;
    }
}

export async function eliminarDocumento(
    id: number,
    opciones: { conservarExamen?: boolean } = {},
): Promise<boolean> {
    const repository = AppDataSource.getRepository(Documento);
    const documento = await repository.findOneBy({ id });
    if (!documento) {
        return false;
    }

    await eliminarArchivoEnDisco(documento.nombreArchivo);
    await eliminarArchivoEnDisco(documento.respuestasNombreArchivo);

    // Si está vinculado a un curso y año de examen, limpiar también los archivos del simulador
    if (!opciones.conservarExamen && documento.curso && documento.anio && documento.titulo.startsWith("Examen EBR ")) {
        await eliminarExamen(documento.anio, documento.curso).catch(() => undefined);
    }

    await repository.remove(documento);
    return true;
}
