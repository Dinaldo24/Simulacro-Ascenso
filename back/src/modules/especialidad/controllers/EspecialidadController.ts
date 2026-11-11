import { Request, Response } from "express";
import { BadRequestError } from "../../../utils/errors";
import { obtenerIdPositivo } from "../../../utils/http";
import {
    crearEspecialidad,
    eliminarEspecialidad,
    listarEspecialidades,
} from "../services/EspecialidadService";

export async function listarEspecialidadesController(_req: Request, res: Response): Promise<void> {
    res.json({ especialidades: await listarEspecialidades() });
}

export async function crearEspecialidadController(req: Request, res: Response): Promise<void> {
    const nombre = req.body?.nombre;
    if (typeof nombre !== "string") {
        throw new BadRequestError("El nombre de la especialidad es obligatorio.");
    }
    res.status(201).json({ especialidad: await crearEspecialidad(nombre) });
}

export async function eliminarEspecialidadController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) throw new BadRequestError("ID de especialidad inválido.");
    await eliminarEspecialidad(id);
    res.json({ mensaje: "Especialidad eliminada." });
}
