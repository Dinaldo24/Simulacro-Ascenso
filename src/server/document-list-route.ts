import express, { type RequestHandler } from "express";
import type { Pool, RowDataPacket } from "mysql2/promise";

interface DocumentRow extends RowDataPacket {
    id_documento: number;
    titulo: string;
    nombre_archivo: string;
    tamano_bytes: number;
    curso: string | null;
    anio: string | null;
    fecha_subida: Date | string;
    subido_por_nombres: string;
    subido_por_apellidos: string;
    pagina_portada: number;
    portada_personalizada: boolean | number;
}

function isRepositoryManager(role: string): boolean {
    return role === "administrador" || role === "director";
}

export function createDocumentListRouter(
    pool: Pool,
    requireAuthenticated: RequestHandler
): express.Router {
    const router = express.Router();

    router.get("/", requireAuthenticated, async (request, response, next): Promise<void> => {
        const hasYearFilter = request.query.anio !== undefined;
        const hasCourseFilter = request.query.curso !== undefined;

        if (hasYearFilter !== hasCourseFilter) {
            response.status(400).json({
                message: "Para filtrar documentos, indica tanto el año como el curso."
            });
            return;
        }

        const year = hasYearFilter && typeof request.query.anio === "string"
            ? request.query.anio.trim()
            : null;
        const course = hasCourseFilter && typeof request.query.curso === "string"
            ? request.query.curso.trim()
            : null;

        if (
            (hasYearFilter && (!year || year.length > 50 || /[\u0000-\u001f\u007f]/.test(year))) ||
            (hasCourseFilter && (!course || course.length > 150 || /[\u0000-\u001f\u007f]/.test(course)))
        ) {
            response.status(400).json({ message: "El año o el curso seleccionado no es válido." });
            return;
        }

        if (!request.currentUser) {
            response.status(401).json({ message: "Inicia sesión para continuar." });
            return;
        }

        try {
            const [documents] = await pool.execute<DocumentRow[]>(
                `SELECT d.id_documento, d.titulo, d.nombre_archivo, d.tamano_bytes,
                        d.curso, d.anio,
                        d.fecha_subida, u.nombres AS subido_por_nombres,
                        u.apellidos AS subido_por_apellidos,
                        COALESCE(p.pagina_pdf, 1) AS pagina_portada,
                        p.archivo_imagen IS NOT NULL AS portada_personalizada
                 FROM documentos AS d
                 INNER JOIN usuarios AS u ON u.id_usuario = d.subido_por
                 LEFT JOIN portadas_documentos AS p ON p.id_documento = d.id_documento
                 ${hasYearFilter ? "WHERE d.anio = ? AND d.curso = ?" : ""}
                 ORDER BY d.fecha_subida DESC, d.id_documento DESC`,
                hasYearFilter ? [year, course] : []
            );

            response.json({
                documents,
                canManage: isRepositoryManager(request.currentUser.rol)
            });
        } catch (error) {
            next(error);
        }
    });

    return router;
}
