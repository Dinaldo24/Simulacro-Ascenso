import { promises as fs } from "node:fs";
import path from "node:path";
import express, { type RequestHandler } from "express";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
    hasCoverImageSignature,
    removeUploadedFile
} from "./file-utils.js";

interface DocumentCover extends RowDataPacket {
    archivo_imagen: string | null;
}

interface DocumentFile extends RowDataPacket {
    archivo_guardado: string;
    archivo_imagen: string | null;
}

function isValidDocumentId(id: string | string[]): id is string {
    return typeof id === "string" && /^\d+$/.test(id);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isValidCoverFilename(filename: string): boolean {
    return /^[0-9a-f-]+\.cover\.(?:png|jpg|webp)$/i.test(filename);
}

export function createDocumentMutationRouter(
    pool: Pool,
    requireAuthenticated: RequestHandler,
    requireRepositoryManager: RequestHandler,
    handleCoverImageUpload: RequestHandler,
    storageDirectory: string
): express.Router {
    const router = express.Router();

    router.patch(
        "/:id/portada",
        requireAuthenticated,
        requireRepositoryManager,
        async (request, response, next): Promise<void> => {
            if (!isValidDocumentId(request.params.id)) {
                response.status(400).json({ message: "El identificador del documento no es válido." });
                return;
            }

            const pageNumber = request.body?.pagina;

            if (
                typeof pageNumber !== "number" ||
                !Number.isSafeInteger(pageNumber) ||
                pageNumber < 1 ||
                pageNumber > 10000
            ) {
                response.status(400).json({ message: "Selecciona una página válida del PDF." });
                return;
            }

            try {
                const [documents] = await pool.execute<RowDataPacket[]>(
                    "SELECT id_documento FROM documentos WHERE id_documento = ? LIMIT 1",
                    [request.params.id]
                );

                if (!documents[0]) {
                    response.status(404).json({ message: "No se encontró el PDF solicitado." });
                    return;
                }

                const [covers] = await pool.execute<DocumentCover[]>(
                    `SELECT archivo_imagen
                     FROM portadas_documentos
                     WHERE id_documento = ?
                     LIMIT 1`,
                    [request.params.id]
                );

                await pool.execute(
                    `INSERT INTO portadas_documentos (id_documento, pagina_pdf, archivo_imagen)
                     VALUES (?, ?, NULL)
                     ON DUPLICATE KEY UPDATE pagina_pdf = VALUES(pagina_pdf), archivo_imagen = NULL`,
                    [request.params.id, pageNumber]
                );

                const oldImage = covers[0]?.archivo_imagen;
                if (oldImage && isValidCoverFilename(oldImage)) {
                    await removeUploadedFile(path.join(storageDirectory, oldImage));
                }

                response.json({ message: "Se actualizó la portada del PDF.", pagina: pageNumber });
            } catch (error) {
                next(error);
            }
        }
    );

    router.post(
        "/:id/portada-imagen",
        requireAuthenticated,
        requireRepositoryManager,
        handleCoverImageUpload,
        async (request, response, next): Promise<void> => {
            if (!isValidDocumentId(request.params.id)) {
                if (request.file) {
                    await removeUploadedFile(request.file.path);
                }
                response.status(400).json({ message: "El identificador del documento no es válido." });
                return;
            }

            const file = request.file;
            if (!file) {
                response.status(400).json({
                    message: "Selecciona una imagen PNG, JPEG (.jpg, .jpeg, .jpe) o WebP para la portada."
                });
                return;
            }

            try {
                const extension = path.extname(file.originalname).toLowerCase();
                if (!(await hasCoverImageSignature(file.path, extension))) {
                    await removeUploadedFile(file.path);
                    response.status(400).json({
                        message: "La imagen seleccionada no tiene un formato válido."
                    });
                    return;
                }

                const [documents] = await pool.execute<RowDataPacket[]>(
                    "SELECT id_documento FROM documentos WHERE id_documento = ? LIMIT 1",
                    [request.params.id]
                );

                if (!documents[0]) {
                    await removeUploadedFile(file.path);
                    response.status(404).json({ message: "No se encontró el PDF solicitado." });
                    return;
                }

                const [covers] = await pool.execute<DocumentCover[]>(
                    `SELECT archivo_imagen
                     FROM portadas_documentos
                     WHERE id_documento = ?
                     LIMIT 1`,
                    [request.params.id]
                );

                await pool.execute(
                    `INSERT INTO portadas_documentos (id_documento, pagina_pdf, archivo_imagen)
                     VALUES (?, 1, ?)
                     ON DUPLICATE KEY UPDATE archivo_imagen = VALUES(archivo_imagen)`,
                    [request.params.id, file.filename]
                );

                const oldImage = covers[0]?.archivo_imagen;
                if (oldImage && oldImage !== file.filename && isValidCoverFilename(oldImage)) {
                    await removeUploadedFile(path.join(storageDirectory, oldImage));
                }

                response.json({ message: "Se actualizó la imagen de portada del PDF." });
            } catch (error) {
                await removeUploadedFile(file.path);
                next(error);
            }
        }
    );

    router.patch(
        "/:id",
        requireAuthenticated,
        requireRepositoryManager,
        async (request, response, next): Promise<void> => {
            if (!isValidDocumentId(request.params.id)) {
                response.status(400).json({ message: "El identificador del documento no es válido." });
                return;
            }

            const name = typeof request.body?.nombre === "string"
                ? request.body.nombre.trim().replace(/\.pdf$/i, "").trim()
                : "";

            if (!name || name.length > 150 || /[\\/\u0000-\u001f\u007f]/.test(name)) {
                response.status(400).json({
                    message: "Escribe un nombre válido de entre 1 y 150 caracteres, sin extensión ni separadores."
                });
                return;
            }

            try {
                const [result] = await pool.execute<ResultSetHeader>(
                    `UPDATE documentos
                     SET titulo = ?, nombre_archivo = ?
                     WHERE id_documento = ?`,
                    [name, `${name}.pdf`, request.params.id]
                );

                if (result.affectedRows === 0) {
                    const [documents] = await pool.execute<RowDataPacket[]>(
                        "SELECT id_documento FROM documentos WHERE id_documento = ? LIMIT 1",
                        [request.params.id]
                    );

                    if (!documents[0]) {
                        response.status(404).json({ message: "No se encontró el PDF solicitado." });
                        return;
                    }
                }

                response.json({
                    message: "Nombre del PDF actualizado.",
                    document: {
                        id_documento: request.params.id,
                        titulo: name,
                        nombre_archivo: `${name}.pdf`
                    }
                });
            } catch (error) {
                next(error);
            }
        }
    );

    router.delete(
        "/:id",
        requireAuthenticated,
        requireRepositoryManager,
        async (request, response, next): Promise<void> => {
            if (!isValidDocumentId(request.params.id)) {
                response.status(400).json({ message: "El identificador del documento no es válido." });
                return;
            }

            let originalFilePath: string | undefined;
            let deletingFilePath: string | undefined;
            let coverImagePath: string | undefined;

            try {
                const [documents] = await pool.execute<DocumentFile[]>(
                    `SELECT d.archivo_guardado, p.archivo_imagen
                     FROM documentos AS d
                     LEFT JOIN portadas_documentos AS p ON p.id_documento = d.id_documento
                     WHERE d.id_documento = ?
                     LIMIT 1`,
                    [request.params.id]
                );
                const document = documents[0];

                if (!document) {
                    response.status(404).json({ message: "No se encontró el PDF solicitado." });
                    return;
                }

                if (!/^[0-9a-f-]+\.pdf$/i.test(document.archivo_guardado)) {
                    next(new Error("El nombre interno del PDF no es válido."));
                    return;
                }

                originalFilePath = path.join(storageDirectory, document.archivo_guardado);
                deletingFilePath = path.join(
                    storageDirectory,
                    `${path.basename(document.archivo_guardado, ".pdf")}.deleting`
                );
                if (document.archivo_imagen && isValidCoverFilename(document.archivo_imagen)) {
                    coverImagePath = path.join(storageDirectory, document.archivo_imagen);
                }

                await fs.rename(originalFilePath, deletingFilePath);

                try {
                    const [result] = await pool.execute<ResultSetHeader>(
                        "DELETE FROM documentos WHERE id_documento = ?",
                        [request.params.id]
                    );

                    if (result.affectedRows === 0) {
                        await fs.rename(deletingFilePath, originalFilePath);
                        response.status(404).json({ message: "No se encontró el PDF solicitado." });
                        return;
                    }
                } catch (databaseError) {
                    try {
                        await fs.rename(deletingFilePath, originalFilePath);
                    } catch (restoreError) {
                        console.error(
                            "No se pudo restaurar el PDF después de un error de base de datos:",
                            restoreError instanceof Error ? restoreError.message : restoreError
                        );
                        next(new Error("No se pudo completar ni revertir la eliminación del PDF."));
                        return;
                    }
                    throw databaseError;
                }

                await fs.unlink(deletingFilePath).catch((error: NodeJS.ErrnoException) => {
                    console.error("No se pudo limpiar el PDF eliminado:", error.message);
                });
                if (coverImagePath) {
                    await fs.unlink(coverImagePath).catch((error: NodeJS.ErrnoException) => {
                        console.error("No se pudo limpiar la imagen de portada eliminada:", error.message);
                    });
                }

                response.status(204).end();
            } catch (error) {
                if (isMissingFileError(error) && originalFilePath) {
                    try {
                        await pool.execute(
                            "DELETE FROM documentos WHERE id_documento = ?",
                            [request.params.id]
                        );
                        if (coverImagePath) {
                            await fs.unlink(coverImagePath).catch((cleanupError: NodeJS.ErrnoException) => {
                                console.error(
                                    "No se pudo limpiar la imagen de portada eliminada:",
                                    cleanupError.message
                                );
                            });
                        }
                        console.warn("Se eliminó el registro de un PDF cuyo archivo ya no existía.");
                        response.status(204).end();
                        return;
                    } catch (cleanupError) {
                        next(cleanupError);
                        return;
                    }
                }

                next(error);
            }
        }
    );

    return router;
}
