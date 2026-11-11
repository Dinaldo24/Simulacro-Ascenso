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

export interface GuardarDocumentoParams {
    nombreOriginal: string;
    contenido: Buffer;
    titulo?: string | undefined;
    curso?: string | undefined;
    anio?: string | undefined;
}

export async function guardarDocumento(params: GuardarDocumentoParams): Promise<Documento> {
    await mkdir(directorioDocumentos, { recursive: true });

    const nombreArchivo = `${randomUUID()}.pdf`;
    const rutaArchivo = resolverRutaSegura(directorioDocumentos, nombreArchivo);
    await writeFile(rutaArchivo, params.contenido, { flag: "wx" });

    try {
        const repository = AppDataSource.getRepository(Documento);
        const tituloFinal =
            params.titulo && params.titulo.trim()
                ? params.titulo.trim()
                : path.basename(params.nombreOriginal, path.extname(params.nombreOriginal));

        const documento = repository.create({
            titulo: tituloFinal.slice(0, 150),
            curso: params.curso?.trim() || null,
            anio: params.anio?.trim() || null,
            nombreOriginal: path.basename(params.nombreOriginal).slice(0, 255),
            nombreArchivo,
            tipoMime: "application/pdf",
            tamanio: params.contenido.length,
            paginaPortada: 1,
        });
        return await repository.save(documento);
    } catch (error) {
        try {
            await unlink(rutaArchivo);
        } catch (cleanupError) {
            console.error("No se pudo limpiar el PDF tras fallar su registro:", cleanupError);
        }
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

export async function obtenerRutaDocumentoExistente(documento: Documento): Promise<string | null> {
    const rutaArchivo = resolverRutaSegura(directorioDocumentos, documento.nombreArchivo);
    try {
        await access(rutaArchivo);
        return rutaArchivo;
    } catch {
        return null;
    }
}

export async function actualizarDocumento(
    id: number,
    cambios: Partial<Pick<Documento, "titulo" | "curso" | "anio" | "paginaPortada">>,
): Promise<Documento | null> {
    const repository = AppDataSource.getRepository(Documento);
    const documento = await repository.findOneBy({ id });
    if (!documento) return null;

    Object.assign(documento, cambios);
    return repository.save(documento);
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

    const rutaArchivo = resolverRutaSegura(directorioDocumentos, documento.nombreArchivo);
    await unlink(rutaArchivo).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") {
            throw error;
        }
    });

    // Si está vinculado a un curso y año de examen, limpiar también los archivos del simulador
    if (!opciones.conservarExamen && documento.curso && documento.anio && documento.titulo.startsWith("Examen EBR ")) {
        await eliminarExamen(documento.anio, documento.curso).catch(() => undefined);
    }

    await repository.remove(documento);
    return true;
}
