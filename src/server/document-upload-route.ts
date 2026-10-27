import path from "node:path";
import express, { type RequestHandler } from "express";
import type { Pool, ResultSetHeader } from "mysql2/promise";
import { removeUploadedFile, hasPdfSignature } from "./file-utils.js";

export function createDocumentUploadRouter(
    pool: Pool,
    requireAuthenticated: RequestHandler,
    requireRepositoryManager: RequestHandler,
    handlePdfUpload: RequestHandler
): express.Router {
    const router = express.Router();

    router.post(
        "/",
        requireAuthenticated,
        requireRepositoryManager,
        handlePdfUpload,
        async (request, response, next): Promise<void> => {
            const file = request.file;

            if (!file) {
                response.status(400).json({ message: "Selecciona un archivo PDF." });
                return;
            }

            const user = request.currentUser;
            if (!user) {
                await removeUploadedFile(file.path);
                response.status(401).json({ message: "Inicia sesión para continuar." });
                return;
            }

            const title = typeof request.body?.titulo === "string"
                ? request.body.titulo.trim()
                : "";
            const course = typeof request.body?.curso === "string"
                ? request.body.curso.trim()
                : "";
            const year = typeof request.body?.anio === "string"
                ? request.body.anio.trim()
                : "";

            if (!title || title.length > 150) {
                await removeUploadedFile(file.path);
                response.status(400).json({
                    message: "Escribe un título de entre 1 y 150 caracteres."
                });
                return;
            }

            if (!course || course.length > 150 || /[\u0000-\u001f\u007f]/.test(course)) {
                await removeUploadedFile(file.path);
                response.status(400).json({
                    message: "Escribe un curso válido de entre 1 y 150 caracteres."
                });
                return;
            }

            if (!year || year.length > 50 || /[\u0000-\u001f\u007f]/.test(year)) {
                await removeUploadedFile(file.path);
                response.status(400).json({
                    message: "Escribe un año o grado válido de entre 1 y 50 caracteres."
                });
                return;
            }

            try {
                if (!(await hasPdfSignature(file.path))) {
                    await removeUploadedFile(file.path);
                    response.status(400).json({
                        message: "El archivo seleccionado no parece ser un PDF válido."
                    });
                    return;
                }

                const originalName = path.win32.basename(file.originalname)
                    .replace(/[\u0000-\u001f\u007f]/g, "")
                    .slice(0, 255);

                if (!originalName) {
                    await removeUploadedFile(file.path);
                    response.status(400).json({
                        message: "El PDF debe tener un nombre de archivo válido."
                    });
                    return;
                }

                const [result] = await pool.execute<ResultSetHeader>(
                    `INSERT INTO documentos
                        (titulo, nombre_archivo, archivo_guardado, tamano_bytes, subido_por, curso, anio)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        title,
                        originalName,
                        file.filename,
                        file.size,
                        user.id_usuario,
                        course,
                        year
                    ]
                );

                response.status(201).json({
                    message: "PDF agregado al repositorio.",
                    document: {
                        id_documento: result.insertId,
                        titulo: title,
                        curso: course,
                        anio: year,
                        nombre_archivo: originalName,
                        tamano_bytes: file.size
                    }
                });
            } catch (error) {
                await removeUploadedFile(file.path);
                next(error);
            }
        }
    );

    return router;
}
