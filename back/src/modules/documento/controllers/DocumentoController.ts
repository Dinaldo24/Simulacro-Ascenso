import { Request, Response } from "express";
import { BadRequestError, NotFoundError } from "../../../utils/errors";
import { obtenerIdPositivo } from "../../../utils/http";
import { Documento } from "../entities/Documento";
import {
    actualizarDocumento,
    buscarDocumento,
    eliminarDocumento,
    guardarDocumento,
    listarDocumentos,
    obtenerRutaDocumentoExistente,
} from "../services/DocumentoService";

function representarDocumento(documento: Documento) {
    return {
        id_documento: documento.id,
        titulo: documento.titulo,
        nombre_archivo: documento.nombreOriginal,
        tamano_bytes: documento.tamanio,
        curso: documento.curso,
        anio: documento.anio,
        fecha_subida: documento.creadoEn.toISOString(),
        subido_por_nombres: "Administrador",
        subido_por_apellidos: "General",
        pagina_portada: documento.paginaPortada,
        portada_personalizada: false,
    };
}

export async function subirDocumentoController(req: Request, res: Response): Promise<void> {
    const archivo = req.file;
    if (!archivo) {
        throw new BadRequestError("Debes adjuntar un PDF en el campo 'pdf' o 'archivo'.");
    }

    const pdfSignatureIndex = archivo.buffer.indexOf(Buffer.from("%PDF-"));
    if (pdfSignatureIndex < 0 || pdfSignatureIndex > 1024) {
        throw new BadRequestError("El archivo no contiene una cabecera PDF válida.");
    }

    const { titulo, curso, anio } = req.body ?? {};
    const documento = await guardarDocumento({
        nombreOriginal: archivo.originalname,
        contenido: archivo.buffer,
        titulo: typeof titulo === "string" ? titulo : undefined,
        curso: typeof curso === "string" ? curso : undefined,
        anio: typeof anio === "string" ? anio : undefined,
    });

    res.status(201).json({
        mensaje: "El PDF se agregó al repositorio.",
        document: representarDocumento(documento),
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
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id del documento no es válido.");
    }

    const documento = await buscarDocumento(id);
    if (!documento) {
        throw new NotFoundError("No se encontró el documento.");
    }

    const rutaArchivo = await obtenerRutaDocumentoExistente(documento);
    if (!rutaArchivo) {
        throw new NotFoundError("El archivo físico del documento no está disponible.");
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(documento.nombreOriginal)}"`,
    );
    res.sendFile(rutaArchivo);
}

export async function descargarDocumentoController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id del documento no es válido.");
    }

    const documento = await buscarDocumento(id);
    if (!documento) {
        throw new NotFoundError("No se encontró el documento.");
    }

    const rutaArchivo = await obtenerRutaDocumentoExistente(documento);
    if (!rutaArchivo) {
        throw new NotFoundError("El archivo físico del documento no está disponible.");
    }

    res.download(rutaArchivo, documento.nombreOriginal);
}

export async function renombrarDocumentoController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id del documento no es válido.");
    }

    const { titulo } = req.body ?? {};
    if (typeof titulo !== "string" || !titulo.trim()) {
        throw new BadRequestError("El título es obligatorio.");
    }

    const actualizado = await actualizarDocumento(id, { titulo: titulo.trim() });
    if (!actualizado) {
        throw new NotFoundError("No se encontró el documento.");
    }
    res.json({ mensaje: "Documento actualizado correctamente." });
}

export async function eliminarDocumentoController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id del documento no es válido.");
    }

    if (!(await eliminarDocumento(id))) {
        throw new NotFoundError("No se encontró el documento.");
    }
    res.status(200).json({ mensaje: "Documento eliminado correctamente." });
}
