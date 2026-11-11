import path from "node:path";
import express, { type RequestHandler } from "express";
import type { Pool, RowDataPacket } from "mysql2/promise";

interface StoredDocument extends RowDataPacket {
    nombre_archivo: string;
    archivo_guardado: string;
}

interface StoredCover extends RowDataPacket {
    archivo_imagen: string;
}

function isValidDocumentId(id: string | string[]): id is string {
    return typeof id === "string" && /^\d+$/.test(id);
}

function isMissingFileError(error: Error): error is NodeJS.ErrnoException {
    return "code" in error && error.code === "ENOENT";
}

function fileNotFoundError(message: string): Error & { status: number } {
    return Object.assign(new Error(message), { status: 404 });
}

function handleFileResponseError(
    error: Error | undefined,
    response: express.Response,
    next: express.NextFunction,
    message: string
): void {
    if (error && !response.headersSent) {
        next(isMissingFileError(error) ? fileNotFoundError(message) : error);
    }
}

export function createDocumentFileRouter(
    pool: Pool,
    requireAuthenticated: RequestHandler,
    storageDirectory: string
): express.Router {
    const router = express.Router();

    router.get("/:id/vista-previa", requireAuthenticated, async (request, response, next): Promise<void> => {
        if (!isValidDocumentId(request.params.id)) {
            response.status(400).json({ message: "El identificador del documento no es válido." });
            return;
        }

        try {
            const [documents] = await pool.execute<StoredDocument[]>(
                `SELECT archivo_guardado
                 FROM documentos
                 WHERE id_documento = ?
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

            const filePath = path.join(storageDirectory, document.archivo_guardado);
            response.set({
                "Cache-Control": "private, no-store",
                "Content-Disposition": "inline",
                "Content-Type": "application/pdf",
                "X-Content-Type-Options": "nosniff"
            });

            response.sendFile(filePath, (error) => {
                handleFileResponseError(
                    error,
                    response,
                    next,
                    "No se encontró el archivo PDF almacenado."
                );
            });
        } catch (error) {
            next(error);
        }
    });

    router.get("/:id/descargar", requireAuthenticated, async (request, response, next): Promise<void> => {
        if (!isValidDocumentId(request.params.id)) {
            response.status(400).json({ message: "El identificador del documento no es válido." });
            return;
        }

        try {
            const [documents] = await pool.execute<StoredDocument[]>(
                `SELECT nombre_archivo, archivo_guardado
                 FROM documentos
                 WHERE id_documento = ?
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

            const filePath = path.join(storageDirectory, document.archivo_guardado);
            response.download(filePath, document.nombre_archivo, (error) => {
                handleFileResponseError(
                    error,
                    response,
                    next,
                    "No se encontró el archivo PDF almacenado."
                );
            });
        } catch (error) {
            next(error);
        }
    });

    router.get("/:id/portada-imagen", requireAuthenticated, async (request, response, next): Promise<void> => {
        if (!isValidDocumentId(request.params.id)) {
            response.status(400).json({ message: "El identificador del documento no es válido." });
            return;
        }

        try {
            const [covers] = await pool.execute<StoredCover[]>(
                `SELECT archivo_imagen
                 FROM portadas_documentos
                 WHERE id_documento = ? AND archivo_imagen IS NOT NULL
                 LIMIT 1`,
                [request.params.id]
            );
            const cover = covers[0];

            if (!cover) {
                response.status(404).json({
                    message: "Este PDF no tiene una imagen de portada personalizada."
                });
                return;
            }

            if (!/^[0-9a-f-]+\.cover\.(?:png|jpg|webp)$/i.test(cover.archivo_imagen)) {
                next(new Error("El nombre interno de la portada no es válido."));
                return;
            }

            const filePath = path.join(storageDirectory, cover.archivo_imagen);
            response.set({
                "Cache-Control": "private, no-store",
                "Content-Type": cover.archivo_imagen.endsWith(".png")
                    ? "image/png"
                    : cover.archivo_imagen.endsWith(".webp")
                        ? "image/webp"
                        : "image/jpeg",
                "X-Content-Type-Options": "nosniff"
            });

            response.sendFile(filePath, (error) => {
                handleFileResponseError(
                    error,
                    response,
                    next,
                    "No se encontró la imagen de portada almacenada."
                );
            });
        } catch (error) {
            next(error);
        }
    });

    return router;
}
