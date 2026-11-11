import { Request, Response } from "express";
import { BadRequestError, ConflictError, NotFoundError } from "../../../utils/errors";
import { obtenerIdPositivo } from "../../../utils/http";
import { Anio } from "../entities/Anio";
import {
    actualizarAnio,
    buscarAnio,
    crearAnio,
    eliminarAnio,
    listarAnios,
} from "../services/AnioService";

function representarAnio(anio: Anio): object {
    return {
        id: anio.id,
        nombre: anio.nombre,
        cursos: anio.cursos?.map((curso) => ({
            id: curso.id,
            nombre: curso.nombre,
            descripcion: curso.descripcion,
        })),
    };
}

export async function crearAnioController(req: Request, res: Response): Promise<void> {
    const { nombre } = req.body ?? {};
    if (typeof nombre !== "string" || !nombre.trim() || nombre.trim().length > 100) {
        throw new BadRequestError("nombre es obligatorio y debe tener hasta 100 caracteres.");
    }

    const anio = await crearAnio(nombre.trim());
    res.status(201).json(representarAnio(anio));
}

export async function listarAniosController(_req: Request, res: Response): Promise<void> {
    const anios = await listarAnios();
    res.json(anios.map(representarAnio));
}

export async function buscarAnioController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id del año no es válido.");
    }

    const anio = await buscarAnio(id);
    if (!anio) {
        throw new NotFoundError("No se encontró el año.");
    }
    res.json(representarAnio(anio));
}

export async function actualizarAnioController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    const { nombre } = req.body ?? {};
    if (
        id === null ||
        typeof nombre !== "string" ||
        !nombre.trim() ||
        nombre.trim().length > 100
    ) {
        throw new BadRequestError("El id o el nombre del año no son válidos.");
    }

    const anio = await actualizarAnio(id, nombre.trim());
    if (!anio) {
        throw new NotFoundError("No se encontró el año.");
    }
    res.json(representarAnio(anio));
}

export async function eliminarAnioController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id del año no es válido.");
    }

    const resultado = await eliminarAnio(id);
    if (resultado === "no-encontrado") {
        throw new NotFoundError("No se encontró el año.");
    }
    if (resultado === "tiene-cursos") {
        throw new ConflictError("No se puede eliminar el año mientras tenga cursos asociados.");
    }
    res.status(204).send();
}
