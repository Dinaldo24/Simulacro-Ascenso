import { Request, Response } from "express";
import { BadRequestError, NotFoundError } from "../../../utils/errors";
import { obtenerIdPositivo } from "../../../utils/http";
import { asegurarBufferPdf } from "../../../utils/storage";
import {
    actualizarDocumentoYSincronizar,
    eliminarDocumentoYSincronizar,
    subirDocumentoYSincronizar,
} from "../../sync/ExamenDocumentoSync";
import { Documento } from "../entities/Documento";
import {
    ActualizarDocumentoParams,
    buscarDocumento,
    listarDocumentos,
    obtenerRutaDocumentoExistente,
    TipoArchivoDocumento,
} from "../services/DocumentoService";

type MulterFilesMap = { [fieldname: string]: Express.Multer.File[] } | undefined;

function representarDocumento(documento: Documento) {
    return {
        id_documento: documento.id,
        titulo: documento.titulo,
        nombre_archivo: documento.nombreOriginal,
        tamano_bytes: documento.tamanio,
        tiene_respuestas: Boolean(documento.respuestasNombreArchivo),
        respuestas_nombre_archivo: documento.respuestasNombreOriginal ?? null,
        respuestas_tipo_mime: documento.respuestasTipoMime ?? null,
        respuestas_tamano_bytes: documento.respuestasTamanio ?? null,
        curso: documento.curso,
        anio: documento.anio,
        examen_id: documento.examenId ?? null,
        fecha_subida: documento.creadoEn.toISOString(),
        subido_por_nombres: "Administrador",
        subido_por_apellidos: "General",
        pagina_portada: documento.paginaPortada,
        portada_personalizada: false,
    };
}

function extraerArchivosSubidos(req: Request): {
    pdfPreguntas?: Express.Multer.File | undefined;
    pdfRespuestas?: Express.Multer.File | undefined;
} {
    const files = req.files as MulterFilesMap;
    const campoPreguntas = files?.pdfPreguntas?.[0];
    const campoLegacy = files?.pdf?.[0];
    if (campoPreguntas && campoLegacy) {
        throw new BadRequestError("Envía el cuadernillo de preguntas en 'pdfPreguntas' o 'pdf', no en ambos.");
    }

    const pdfPreguntas = campoPreguntas ?? campoLegacy;
    const pdfRespuestas = files?.pdfRespuestas?.[0];

    if (pdfPreguntas) {
        asegurarBufferPdf(pdfPreguntas.buffer, "El archivo de preguntas");
    }
    if (pdfRespuestas) {
        asegurarBufferPdf(pdfRespuestas.buffer, "El archivo de respuestas");
    }

    return { pdfPreguntas, pdfRespuestas };
}

function parseTextoOpcional(valor: unknown, campo: string, maxLen: number): string | null | undefined {
    if (valor === undefined) return undefined;
    if (valor === null) return null;
    if (typeof valor !== "string") {
        throw new BadRequestError(`El campo '${campo}' debe ser texto.`);
    }
    const limpio = valor.trim();
    if (limpio.length > maxLen) {
        throw new BadRequestError(`El campo '${campo}' no puede superar los ${maxLen} caracteres.`);
    }
    return limpio || null;
}

function parseBooleanoOpcional(valor: unknown, campo: string): boolean {
    if (valor === undefined || valor === null || valor === false) return false;
    if (valor === true) return true;
    if (typeof valor === "string") {
        const normalizado = valor.trim().toLowerCase();
        if (normalizado === "" || normalizado === "false" || normalizado === "0") return false;
        if (normalizado === "true" || normalizado === "1" || normalizado === "on") return true;
    }
    throw new BadRequestError(`El campo '${campo}' debe ser booleano.`);
}

function obtenerTipoArchivoQuery(req: Request): TipoArchivoDocumento {
    const raw = req.query.tipo;
    if (raw === undefined) return "preguntas";
    if (typeof raw !== "string") {
        throw new BadRequestError("El parámetro 'tipo' debe ser 'preguntas' o 'respuestas'.");
    }
    const normalizado = raw.trim().toLowerCase();
    if (normalizado === "preguntas" || normalizado === "respuestas") {
        return normalizado;
    }
    throw new BadRequestError("El parámetro 'tipo' debe ser 'preguntas' o 'respuestas'.");
}

async function resolverArchivoDocumento(req: Request): Promise<{
    rutaArchivo: string;
    nombreOriginal: string;
}> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id del documento no es válido.");
    }

    const tipo = obtenerTipoArchivoQuery(req);
    const documento = await buscarDocumento(id);
    if (!documento) {
        throw new NotFoundError("No se encontró el documento.");
    }
    if (tipo === "respuestas" && !documento.respuestasNombreArchivo) {
        throw new NotFoundError("Este documento no tiene hoja de respuestas adjunta.");
    }

    const rutaArchivo = await obtenerRutaDocumentoExistente(documento, tipo);
    if (!rutaArchivo) {
        throw new NotFoundError("El archivo físico del documento no está disponible.");
    }

    const nombreOriginal =
        tipo === "respuestas"
            ? (documento.respuestasNombreOriginal ?? "respuestas.pdf")
            : documento.nombreOriginal;

    return { rutaArchivo, nombreOriginal };
}

export async function subirDocumentoController(req: Request, res: Response): Promise<void> {
    const { pdfPreguntas, pdfRespuestas } = extraerArchivosSubidos(req);
    if (!pdfPreguntas) {
        throw new BadRequestError("Debes adjuntar un PDF en el campo 'pdfPreguntas' o 'pdf'.");
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const titulo = parseTextoOpcional(body.titulo, "titulo", 150) ?? undefined;
    const curso = parseTextoOpcional(body.curso, "curso", 100) ?? undefined;
    const anio = parseTextoOpcional(body.anio, "anio", 50) ?? undefined;

    const resultado = await subirDocumentoYSincronizar({
        nombreOriginal: pdfPreguntas.originalname,
        contenido: pdfPreguntas.buffer,
        ...(pdfRespuestas
            ? {
                  respuestasNombreOriginal: pdfRespuestas.originalname,
                  respuestasContenido: pdfRespuestas.buffer,
              }
            : {}),
        titulo,
        curso,
        anio,
    });

    res.status(201).json({
        mensaje: resultado.sincronizadoSimulador
            ? `Documento guardado y sincronizado con Materiales y Simulación (${resultado.totalPreguntasDesglosadas} preguntas desglosadas).`
            : "Documento guardado en el Repositorio (no se desglosó para Simulación).",
        document: representarDocumento(resultado.documento),
        sincronizado_simulador: resultado.sincronizadoSimulador,
        ...(resultado.sincronizadoSimulador
            ? { total_preguntas_desglosadas: resultado.totalPreguntasDesglosadas }
            : {}),
    });
}

export async function listarDocumentosController(req: Request, res: Response): Promise<void> {
    const curso = typeof req.query.curso === "string" ? req.query.curso : undefined;
    const anio = typeof req.query.anio === "string" ? req.query.anio : undefined;
    const documentos = await listarDocumentos({ curso, anio });

    res.json({
        documents: documentos.map(representarDocumento),
        canManage: true,
    });
}

export async function verDocumentoController(req: Request, res: Response): Promise<void> {
    const { rutaArchivo, nombreOriginal } = await resolverArchivoDocumento(req);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(nombreOriginal)}"`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.sendFile(rutaArchivo);
}

export async function descargarDocumentoController(req: Request, res: Response): Promise<void> {
    const { rutaArchivo, nombreOriginal } = await resolverArchivoDocumento(req);
    const nombreDescarga = nombreOriginal.toLowerCase().endsWith(".pdf")
        ? nombreOriginal
        : `${nombreOriginal}.pdf`;

    res.setHeader("Cache-Control", "private, no-store");
    res.download(rutaArchivo, nombreDescarga);
}

export async function actualizarDocumentoController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id del documento no es válido.");
    }

    const { pdfPreguntas, pdfRespuestas } = extraerArchivosSubidos(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const cambios: ActualizarDocumentoParams = {};
    if (body.titulo !== undefined) {
        if (typeof body.titulo !== "string" || !body.titulo.trim()) {
            throw new BadRequestError("El título es obligatorio.");
        }
        const titulo = body.titulo.trim();
        if (titulo.length > 150) {
            throw new BadRequestError("El campo 'titulo' no puede superar los 150 caracteres.");
        }
        cambios.titulo = titulo;
    }

    const curso = parseTextoOpcional(body.curso, "curso", 100);
    if (curso !== undefined) cambios.curso = curso;

    const anio = parseTextoOpcional(body.anio, "anio", 50);
    if (anio !== undefined) cambios.anio = anio;

    const eliminarRespuestas = parseBooleanoOpcional(body.eliminarRespuestas, "eliminarRespuestas");
    if (pdfRespuestas && eliminarRespuestas) {
        throw new BadRequestError("No puedes adjuntar y eliminar la hoja de respuestas al mismo tiempo.");
    }

    if (pdfPreguntas) {
        cambios.pdfPreguntas = {
            nombreOriginal: pdfPreguntas.originalname,
            contenido: pdfPreguntas.buffer,
        };
    }
    if (pdfRespuestas) {
        cambios.pdfRespuestas = {
            nombreOriginal: pdfRespuestas.originalname,
            contenido: pdfRespuestas.buffer,
        };
    } else if (eliminarRespuestas) {
        cambios.eliminarRespuestas = true;
    }

    if (
        cambios.titulo === undefined &&
        cambios.curso === undefined &&
        cambios.anio === undefined &&
        !cambios.pdfPreguntas &&
        !cambios.pdfRespuestas &&
        !cambios.eliminarRespuestas
    ) {
        throw new BadRequestError("Debes enviar al menos un campo o archivo para actualizar.");
    }

    const resultado = await actualizarDocumentoYSincronizar(id, cambios);
    if (!resultado) {
        throw new NotFoundError("No se encontró el documento.");
    }

    if (!resultado.resincronizado) {
        res.json({
            mensaje: "Documento actualizado correctamente.",
            document: representarDocumento(resultado.documento),
        });
        return;
    }

    res.json({
        mensaje: resultado.sincronizadoSimulador
            ? `Documento actualizado y sincronizado con Materiales y Simulación (${resultado.totalPreguntasDesglosadas} preguntas desglosadas).`
            : "Documento actualizado en el Repositorio (no se desglosó para Simulación).",
        document: representarDocumento(resultado.documento),
        sincronizado_simulador: resultado.sincronizadoSimulador,
        ...(resultado.sincronizadoSimulador
            ? { total_preguntas_desglosadas: resultado.totalPreguntasDesglosadas }
            : {}),
    });
}

export async function eliminarDocumentoController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id del documento no es válido.");
    }

    if (!(await eliminarDocumentoYSincronizar(id))) {
        throw new NotFoundError("No se encontró el documento.");
    }
    res.status(200).json({ mensaje: "Documento eliminado correctamente." });
}
