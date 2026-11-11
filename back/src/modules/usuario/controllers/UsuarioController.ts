import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { requireJwtSecret } from "../../../config/env";
import { BadRequestError, ConflictError, NotFoundError } from "../../../utils/errors";
import { obtenerIdPositivo } from "../../../utils/http";
import { RolUsuario } from "../entities/Usuario";
import {
    actualizarUsuario,
    alternarEstadoUsuario,
    autenticarUsuario,
    buscarUsuarioPorId,
    crearUsuario,
    listarUsuarios,
} from "../services/UsuarioService";

function serializarUsuarioSesion(usuario: {
    id: number;
    email: string;
    nombre: string;
    role: RolUsuario;
    activo: boolean;
    especialidadId?: number | null;
    especialidad?: { id: number; nombre: string } | null;
}) {
    return {
        id: usuario.id,
        username: usuario.email,
        nombres: usuario.nombre,
        apellidos: "",
        role: usuario.role,
        activo: usuario.activo,
        especialidadId: usuario.especialidadId ?? null,
        especialidad: usuario.especialidad?.nombre ?? null,
    };
}

function leerEspecialidadId(valor: unknown): number | null | undefined {
    if (valor === undefined) return undefined;
    if (valor === null || valor === "") return null;
    const n = Number(valor);
    if (!Number.isInteger(n) || n <= 0) throw new BadRequestError("La especialidad indicada no es válida.");
    return n;
}

function esDuplicadoMySql(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const err = error as { code?: unknown; driverError?: { code?: unknown } };
    return err.code === "ER_DUP_ENTRY" || err.driverError?.code === "ER_DUP_ENTRY";
}

export async function listarUsuariosController(_req: Request, res: Response): Promise<void> {
    const usuarios = await listarUsuarios();
    res.json({ usuarios });
}

export async function crearUsuarioController(req: Request, res: Response): Promise<void> {
    const { nombre, email, password, role } = req.body ?? {};
    const especialidadId = leerEspecialidadId(req.body?.especialidadId);

    if (
        typeof nombre !== "string" ||
        typeof email !== "string" ||
        typeof password !== "string" ||
        !nombre.trim() ||
        !email.trim() ||
        !password
    ) {
        throw new BadRequestError("nombre, email y password son obligatorios y deben ser texto.");
    }

    if (nombre.trim().length > 100 || email.trim().length > 255) {
        throw new BadRequestError("nombre debe tener hasta 100 caracteres y email hasta 255.");
    }

    if (password.length < 6) {
        throw new BadRequestError("La contraseña debe tener al menos 6 caracteres.");
    }

    const rolValido = Object.values(RolUsuario).includes(role) ? role : RolUsuario.PROFESOR;

    try {
        const usuario = await crearUsuario({
            nombre: nombre.trim(),
            email: email.trim().toLowerCase(),
            password,
            role: rolValido,
            especialidadId,
        });

        res.status(201).json({
            mensaje: "Usuario creado exitosamente.",
            usuario,
        });
    } catch (error) {
        if (esDuplicadoMySql(error)) {
            throw new ConflictError("Ya existe un usuario registrado con este correo electrónico.");
        }
        throw error;
    }
}

export async function actualizarUsuarioController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("ID de usuario inválido.");
    }

    const { nombre, email, password, role, activo } = req.body ?? {};
    const especialidadId = leerEspecialidadId(req.body?.especialidadId);

    if (nombre !== undefined && (typeof nombre !== "string" || !nombre.trim() || nombre.trim().length > 100)) {
        throw new BadRequestError("nombre debe ser un texto válido de hasta 100 caracteres.");
    }
    if (email !== undefined && (typeof email !== "string" || !email.trim() || email.trim().length > 255)) {
        throw new BadRequestError("email debe ser un texto válido de hasta 255 caracteres.");
    }
    if (password !== undefined && password !== "" && (typeof password !== "string" || password.length < 6)) {
        throw new BadRequestError("La contraseña debe tener al menos 6 caracteres.");
    }

    const usuarioIdAutenticado = Number(req.usuario?.sub);
    if (id === usuarioIdAutenticado && activo === false) {
        throw new BadRequestError("Por seguridad, no puedes deshabilitar tu propia cuenta activa.");
    }

    const rolValidado = Object.values(RolUsuario).includes(role) ? (role as RolUsuario) : undefined;
    if (
        id === usuarioIdAutenticado &&
        rolValidado !== undefined &&
        req.usuario?.role &&
        rolValidado !== req.usuario.role
    ) {
        throw new BadRequestError("Por seguridad, no puedes cambiar tu propio rol.");
    }

    try {
        const actualizado = await actualizarUsuario(
            id,
            {
                nombre,
                email,
                password: password ? String(password) : undefined,
                role: rolValidado,
                activo: typeof activo === "boolean" ? activo : undefined,
                especialidadId,
            },
            Number.isInteger(usuarioIdAutenticado) ? usuarioIdAutenticado : undefined,
        );

        if (!actualizado) {
            throw new NotFoundError("Usuario no encontrado.");
        }

        res.json({
            mensaje: "Usuario actualizado correctamente.",
            usuario: actualizado,
        });
    } catch (error) {
        if (esDuplicadoMySql(error)) {
            throw new ConflictError("Ya existe otro usuario con este correo electrónico.");
        }
        throw error;
    }
}

export async function alternarEstadoUsuarioController(
    req: Request,
    res: Response,
): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("ID de usuario inválido.");
    }

    const { activo } = req.body ?? {};
    if (typeof activo !== "boolean") {
        throw new BadRequestError("El campo 'activo' (booleano) es requerido.");
    }

    const usuarioIdAutenticado = Number(req.usuario?.sub);
    const exito = await alternarEstadoUsuario(
        id,
        activo,
        Number.isInteger(usuarioIdAutenticado) ? usuarioIdAutenticado : undefined,
    );
    if (!exito) {
        throw new NotFoundError("Usuario no encontrado.");
    }

    res.json({
        mensaje: `Usuario ${activo ? "habilitado" : "deshabilitado"} correctamente.`,
        activo,
    });
}

export async function loginUsuarioController(req: Request, res: Response): Promise<void> {
    const { email, username, password } = req.body ?? {};
    const usuarioEmail =
        typeof email === "string" && email.trim()
            ? email.trim()
            : typeof username === "string" && username.trim()
              ? username.trim()
              : "";

    if (!usuarioEmail || typeof password !== "string" || !password) {
        res.status(400).json({
            message: "Revisa el usuario/email y la contraseña.",
            mensaje: "email y password son obligatorios y deben ser texto.",
        });
        return;
    }

    const { usuario, inactivo } = await autenticarUsuario(usuarioEmail.toLowerCase(), password);

    if (inactivo) {
        res.status(403).json({
            message: "Tu cuenta ha sido deshabilitada. Consulta con la Dirección.",
            mensaje: "Tu cuenta ha sido deshabilitada por el Administrador.",
        });
        return;
    }

    if (!usuario) {
        res.status(401).json({
            message: "Usuario o contraseña incorrectos.",
            mensaje: "Email o contraseña incorrectos.",
        });
        return;
    }

    const token = jwt.sign(
        { email: usuario.email, role: usuario.role, nombre: usuario.nombre },
        requireJwtSecret(),
        { subject: String(usuario.id), expiresIn: "8h" },
    );

    res.json({
        mensaje: "Inicio de sesión correcto.",
        token,
        user: serializarUsuarioSesion(usuario),
    });
}

export async function verificarSesionController(req: Request, res: Response): Promise<void> {
    const usuarioId = Number(req.usuario?.sub);
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
        res.status(401).json({ mensaje: "El token no es válido." });
        return;
    }

    const usuario = await buscarUsuarioPorId(usuarioId);
    if (!usuario || usuario.activo === false) {
        res.status(401).json({
            mensaje: "Tu sesión expiró o tu cuenta ha sido deshabilitada.",
        });
        return;
    }

    res.json({
        user: serializarUsuarioSesion(usuario),
    });
}
