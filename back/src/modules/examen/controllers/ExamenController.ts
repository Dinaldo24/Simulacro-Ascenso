import { Request, Response } from "express";
import { BadRequestError, NotFoundError } from "../../../utils/errors";
import { obtenerIdPositivo } from "../../../utils/http";
import { esContenidoPreguntaValido } from "../../pregunta/controllers/PreguntaController";
import { Examen } from "../entities/Examen";
import {
    actualizarExamen,
    buscarExamen,
    crearExamen,
    eliminarExamen,
    ExamenNuevo,
    listarExamenes,
} from "../services/ExamenService";

function representarExamen(examen: Examen): object {
    return {
        id: examen.id,
        titulo: examen.titulo,
        descripcion: examen.descripcion ?? null,
        preguntas: examen.preguntas.map((pregunta) => ({
            id: pregunta.id,
            texto: pregunta.texto,
            opciones: pregunta.opciones.map((opcion) => ({
                id: opcion.id,
                texto: opcion.texto,
                esCorrecta: opcion.esCorrecta ?? false,
            })),
        })),
    };
}

export async function listarExamenesController(_req: Request, res: Response): Promise<void> {
    const examenes = await listarExamenes();
    res.json(examenes.map(representarExamen));
}

export async function buscarExamenController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id del examen no es válido.");
    }

    const examen = await buscarExamen(id);
    if (!examen) {
        throw new NotFoundError("No se encontró el examen.");
    }
    res.json(representarExamen(examen));
}

export async function actualizarExamenController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    const { titulo, descripcion } = req.body ?? {};

    if (
        id === null ||
        (titulo === undefined && descripcion === undefined) ||
        (titulo !== undefined &&
            (typeof titulo !== "string" || !titulo.trim() || titulo.length > 150)) ||
        (descripcion !== undefined &&
            descripcion !== null &&
            (typeof descripcion !== "string" || descripcion.length > 65535))
    ) {
        throw new BadRequestError("El id o los datos del examen no son válidos.");
    }

    const examen = await actualizarExamen(id, {
        ...(typeof titulo === "string" ? { titulo: titulo.trim() } : {}),
        ...(descripcion === null || typeof descripcion === "string"
            ? { descripcion: typeof descripcion === "string" ? descripcion.trim() : null }
            : {}),
    });
    if (!examen) {
        throw new NotFoundError("No se encontró el examen.");
    }
    res.json(representarExamen(examen));
}

export async function eliminarExamenController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id del examen no es válido.");
    }

    if (!(await eliminarExamen(id))) {
        throw new NotFoundError("No se encontró el examen.");
    }
    res.status(204).send();
}

export async function crearExamenController(req: Request, res: Response): Promise<void> {
    const { titulo, descripcion, preguntas } = req.body ?? {};

    const esPregunta = (valor: unknown): boolean => {
        if (typeof valor !== "object" || valor === null) return false;
        const p = valor as Record<string, unknown>;
        return esContenidoPreguntaValido(p.texto, p.opciones);
    };

    if (
        typeof titulo !== "string" ||
        !titulo.trim() ||
        titulo.length > 150 ||
        (descripcion !== undefined &&
            (typeof descripcion !== "string" || descripcion.length > 65535)) ||
        !Array.isArray(preguntas) ||
        preguntas.length === 0 ||
        !preguntas.every(esPregunta)
    ) {
        throw new BadRequestError(
            "Envía un título válido y al menos una pregunta con dos opciones de texto. esCorrecta es opcional.",
        );
    }

    const examen = await crearExamen({
        titulo: titulo.trim(),
        ...(typeof descripcion === "string" ? { descripcion: descripcion.trim() } : {}),
        preguntas: preguntas as ExamenNuevo["preguntas"],
    });
    res.status(201).json(representarExamen(examen));
}
