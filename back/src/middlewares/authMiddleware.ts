import { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { requireJwtSecret } from "../config/env";
import { AppDataSource } from "../database/data-source";
import { Usuario } from "../modules/usuario/entities/Usuario";

export interface UsuarioAutenticadoPayload extends JwtPayload {
    sub: string;
    email: string;
    role: string;
    nombre: string;
    especialidadId?: number | null;
}

declare global {
    namespace Express {
        interface Request {
            usuario?: UsuarioAutenticadoPayload | undefined;
        }
    }
}

export async function autenticarToken(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    const autorizacion = req.header("Authorization");
    const coincidencia = autorizacion?.match(/^Bearer\s+(.+)$/i);
    const token = coincidencia?.[1];

    if (!token) {
        res.status(401).json({ mensaje: "Debes iniciar sesión para acceder." });
        return;
    }

    try {
        const payload = jwt.verify(token, requireJwtSecret()) as UsuarioAutenticadoPayload;
        const usuarioId = Number(payload.sub);
        if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
            res.status(401).json({ mensaje: "El token no es válido." });
            return;
        }

        // Valida en BD que la cuenta siga activa y usa el rol vigente (no el del token).
        const actual = await AppDataSource.getRepository(Usuario).findOne({
            where: { id: usuarioId },
            select: { id: true, role: true, activo: true, nombre: true, email: true, especialidadId: true },
        });
        if (!actual || actual.activo === false) {
            res.status(401).json({ mensaje: "Tu cuenta no está disponible. Inicia sesión nuevamente." });
            return;
        }

        req.usuario = {
            ...payload,
            role: actual.role,
            nombre: actual.nombre,
            email: actual.email,
            especialidadId: actual.especialidadId,
        };
        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.NotBeforeError) {
            res.status(401).json({ mensaje: "El token no es válido o ha expirado." });
            return;
        }
        next(error);
    }
}

export function requerirAdminODirector(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    const rol = req.usuario?.role;
    if (rol !== "administrador" && rol !== "director") {
        res.status(403).json({
            mensaje: "Acceso denegado: se requieren permisos de Administrador o Director.",
        });
        return;
    }
    next();
}
