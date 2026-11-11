import bcrypt from "bcryptjs";
import express, { type RequestHandler } from "express";
import "express-session";
import type { Pool, RowDataPacket } from "mysql2/promise";

export interface AuthenticatedUser extends RowDataPacket {
    id_usuario: number;
    nombre_usuario: string;
    nombres: string;
    apellidos: string;
    rol: string;
}

interface LoginUser extends AuthenticatedUser {
    hash_contrasena: string;
}

interface LoginBody {
    username?: unknown;
    password?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export function requireAuthenticated(pool: Pool): RequestHandler {
    return async (request, response, next): Promise<void> => {
        try {
            const userId = request.session.userId;

            if (!userId) {
                response.status(401).json({ message: "Inicia sesión para continuar." });
                return;
            }

            const [users] = await pool.execute<AuthenticatedUser[]>(
                `SELECT id_usuario, nombre_usuario, nombres, apellidos, rol
                 FROM usuarios
                 WHERE id_usuario = ? AND activo = TRUE
                 LIMIT 1`,
                [userId]
            );
            const user = users[0];

            if (!user) {
                await new Promise<void>((resolve, reject) => {
                    request.session.destroy((error) => error ? reject(error) : resolve());
                });
                response.status(401).json({ message: "La cuenta no está activa." });
                return;
            }

            request.currentUser = user;
            next();
        } catch (error) {
            next(error);
        }
    };
}

export const requireRepositoryManager: RequestHandler = (request, response, next): void => {
    if (!request.currentUser || !["administrador", "director"].includes(request.currentUser.rol)) {
        response.status(403).json({
            message: "Solo el Administrador y el Director pueden modificar el repositorio."
        });
        return;
    }

    next();
};

export function createAuthRouter(
    pool: Pool,
    loginLimiter: RequestHandler,
    isProduction: boolean
): express.Router {
    const router = express.Router();
    const authenticate = requireAuthenticated(pool);

    router.post("/login", loginLimiter, async (request, response, next): Promise<void> => {
        try {
            const body: LoginBody = isRecord(request.body) ? request.body : {};
            const { username, password } = body;

            if (
                typeof username !== "string" ||
                typeof password !== "string" ||
                !username.trim() ||
                !password ||
                username.length > 50 ||
                Buffer.byteLength(password, "utf8") > 72
            ) {
                response.status(400).json({ message: "Revisa el usuario y la contraseña." });
                return;
            }

            const [users] = await pool.execute<LoginUser[]>(
                `SELECT id_usuario, nombre_usuario, hash_contrasena, nombres, apellidos, rol
                 FROM usuarios
                 WHERE nombre_usuario = ? AND activo = TRUE
                 LIMIT 1`,
                [username.trim()]
            );
            const user = users[0];

            if (!user || !(await bcrypt.compare(password, user.hash_contrasena))) {
                response.status(401).json({ message: "Usuario o contraseña incorrectos." });
                return;
            }

            await new Promise<void>((resolve, reject) => {
                request.session.regenerate((error) => error ? reject(error) : resolve());
            });
            request.session.userId = user.id_usuario;
            await new Promise<void>((resolve, reject) => {
                request.session.save((error) => error ? reject(error) : resolve());
            });

            response.json({
                user: {
                    username: user.nombre_usuario,
                    nombres: user.nombres,
                    apellidos: user.apellidos,
                    role: user.rol
                }
            });
        } catch (error) {
            next(error);
        }
    });

    router.get("/me", authenticate, (request, response): void => {
        const user = request.currentUser;

        if (!user) {
            response.status(401).json({ message: "Inicia sesión para continuar." });
            return;
        }

        response.json({
            user: {
                username: user.nombre_usuario,
                nombres: user.nombres,
                apellidos: user.apellidos,
                role: user.rol
            }
        });
    });

    router.post("/logout", (request, response, next): void => {
        request.session.destroy((error) => {
            if (error) {
                next(error);
                return;
            }

            response.clearCookie("simulador.sid", {
                httpOnly: true,
                sameSite: "lax",
                secure: isProduction
            });
            response.status(204).end();
        });
    });

    return router;
}
