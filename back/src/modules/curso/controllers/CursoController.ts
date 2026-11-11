import { Request, Response } from "express";
import { BadRequestError, NotFoundError } from "../../../utils/errors";
import { esIdPositivo, obtenerIdPositivo } from "../../../utils/http";
import { Curso } from "../entities/Curso";
import {
    actualizarCurso,
    buscarCurso,
    crearCurso,
    DatosCurso,
    eliminarCurso,
    listarCursos,
} from "../services/CursoService";

function representarCurso(curso: Curso): object {
    return {
        id: curso.id,
        nombre: curso.nombre,
        descripcion: curso.descripcion,
        anioId: curso.anio.id,
        anio: curso.anio.nombre,
    };
}

function validarDatosCurso(
    nombre: unknown,
    descripcion: unknown,
    anioId: unknown,
    parcial: boolean,
): string | null {
    if (!parcial || nombre !== undefined) {
        if (typeof nombre !== "string" || !nombre.trim() || nombre.trim().length > 150) {
            return "nombre es obligatorio y debe tener hasta 150 caracteres.";
        }
    }
    if (descripcion !== undefined && descripcion !== null && typeof descripcion !== "string") {
        return "descripcion debe ser texto o null.";
    }
    if (typeof descripcion === "string" && descripcion.length > 65535) {
        return "descripcion es demasiado larga.";
    }
    if (!parcial || anioId !== undefined) {
        if (!esIdPositivo(anioId)) {
            return "anioId es obligatorio y debe ser un entero positivo.";
        }
    }
    return null;
}

export async function crearCursoController(req: Request, res: Response): Promise<void> {
    const { nombre, descripcion, anioId } = req.body ?? {};
    const errorValidacion = validarDatosCurso(nombre, descripcion, anioId, false);
    if (errorValidacion) {
        throw new BadRequestError(errorValidacion);
    }

    const curso = await crearCurso({
        nombre: (nombre as string).trim(),
        ...(typeof descripcion === "string" || descripcion === null
            ? { descripcion: typeof descripcion === "string" ? descripcion.trim() : null }
            : {}),
        anioId: anioId as number,
    });
    if (!curso) {
        throw new NotFoundError("No se encontró el año indicado.");
    }
    res.status(201).json(representarCurso(curso));
}

export async function listarCursosController(_req: Request, res: Response): Promise<void> {
    const cursos = await listarCursos();
    res.json(cursos.map(representarCurso));
}

export async function buscarCursoController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id del curso no es válido.");
    }

    const curso = await buscarCurso(id);
    if (!curso) {
        throw new NotFoundError("No se encontró el curso.");
    }
    res.json(representarCurso(curso));
}

export async function actualizarCursoController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    const { nombre, descripcion, anioId } = req.body ?? {};
    const errorValidacion = validarDatosCurso(nombre, descripcion, anioId, true);
    if (id === null || errorValidacion) {
        throw new BadRequestError(errorValidacion ?? "El id del curso no es válido.");
    }

    const datos: Partial<DatosCurso> = {
        ...(typeof nombre === "string" ? { nombre: nombre.trim() } : {}),
        ...(typeof descripcion === "string" || descripcion === null
            ? { descripcion: typeof descripcion === "string" ? descripcion.trim() : null }
            : {}),
        ...(typeof anioId === "number" ? { anioId } : {}),
    };
    if (Object.keys(datos).length === 0) {
        throw new BadRequestError("Debes enviar al menos un campo para actualizar.");
    }

    const curso = await actualizarCurso(id, datos);
    if (!curso) {
        throw new NotFoundError("No se encontró el curso o el año indicado.");
    }
    res.json(representarCurso(curso));
}

export async function eliminarCursoController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id del curso no es válido.");
    }

    if (!(await eliminarCurso(id))) {
        throw new NotFoundError("No se encontró el curso.");
    }
    res.status(204).send();
}
