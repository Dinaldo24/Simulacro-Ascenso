import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/errors";

function obtenerCodigoMySql(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null) {
        return undefined;
    }
    const err = error as { code?: unknown; driverError?: { code?: unknown } };
    if (typeof err.driverError?.code === "string") {
        return err.driverError.code;
    }
    return typeof err.code === "string" ? err.code : undefined;
}

export function errorHandler(
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void {
    if (error instanceof AppError) {
        res.status(error.statusCode).json({ mensaje: error.mensaje });
        return;
    }

    if (error instanceof Error && error.name === "MulterError") {
        const status = "code" in error && error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        res.status(status).json({
            mensaje: status === 413 ? "El PDF no puede superar los 25 MB." : error.message,
        });
        return;
    }

    const mysqlCode = obtenerCodigoMySql(error);
    if (mysqlCode === "ER_DUP_ENTRY") {
        res.status(409).json({ mensaje: "Ya existe un registro con ese valor único." });
        return;
    }

    console.error("Error en la solicitud:", error);
    res.status(500).json({ mensaje: "Error interno del servidor." });
}
