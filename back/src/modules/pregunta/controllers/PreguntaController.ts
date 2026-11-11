import { Request, Response } from "express";
import { BadRequestError, NotFoundError } from "../../../utils/errors";
import { esIdPositivo, obtenerIdPositivo } from "../../../utils/http";
import { OpcionNueva } from "../../examen/services/ExamenService";
import { Pregunta } from "../entities/Pregunta";
import {
    actualizarPregunta,
    buscarPregunta,
    crearPregunta,
    eliminarPregunta,
    listarPreguntas,
} from "../services/PreguntaService";

export function esContenidoPreguntaValido(texto: unknown, opciones: unknown): boolean {
    if (
        typeof texto !== "string" ||
        !texto.trim() ||
        texto.length > 2000 ||
        !Array.isArray(opciones) ||
        opciones.length < 2
    ) {
        return false;
    }

    return opciones.every((valorOpcion: unknown) => {
        if (typeof valorOpcion !== "object" || valorOpcion === null) {
            return false;
        }
        const opcion = valorOpcion as Record<string, unknown>;
        return (
            typeof opcion.texto === "string" &&
            !!opcion.texto.trim() &&
            opcion.texto.length <= 255 &&
            (opcion.esCorrecta === undefined || typeof opcion.esCorrecta === "boolean")
        );
    });
}

function representarPregunta(pregunta: Pregunta): object {
    return {
        id: pregunta.id,
        texto: pregunta.texto,
        examenId: pregunta.examen.id,
        opciones: pregunta.opciones.map((opcion) => ({
            id: opcion.id,
            texto: opcion.texto,
            esCorrecta: opcion.esCorrecta,
        })),
    };
}

export async function listarPreguntasController(_req: Request, res: Response): Promise<void> {
    const preguntas = await listarPreguntas();
    res.json(preguntas.map(representarPregunta));
}

export async function buscarPreguntaController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id de la pregunta no es válido.");
    }

    const pregunta = await buscarPregunta(id);
    if (!pregunta) {
        throw new NotFoundError("No se encontró la pregunta.");
    }
    res.json(representarPregunta(pregunta));
}

export async function actualizarPreguntaController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    const { texto, examenId } = req.body ?? {};

    if (
        id === null ||
        (texto === undefined && examenId === undefined) ||
        (texto !== undefined &&
            (typeof texto !== "string" || !texto.trim() || texto.length > 2000)) ||
        (examenId !== undefined && !esIdPositivo(examenId))
    ) {
        throw new BadRequestError("El id o los datos de la pregunta no son válidos.");
    }

    const pregunta = await actualizarPregunta(id, {
        ...(typeof texto === "string" ? { texto: texto.trim() } : {}),
        ...(typeof examenId === "number" ? { examenId } : {}),
    });
    if (!pregunta) {
        throw new NotFoundError("No se encontró la pregunta o el examen indicado.");
    }
    res.json(representarPregunta(pregunta));
}

export async function eliminarPreguntaController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id de la pregunta no es válido.");
    }

    if (!(await eliminarPregunta(id))) {
        throw new NotFoundError("No se encontró la pregunta.");
    }
    res.status(204).send();
}

export async function crearPreguntaController(req: Request, res: Response): Promise<void> {
    const { examenId, texto, opciones } = req.body ?? {};

    if (!esIdPositivo(examenId) || !esContenidoPreguntaValido(texto, opciones)) {
        throw new BadRequestError(
            "Envía examenId, texto y al menos dos opciones de texto. esCorrecta es opcional.",
        );
    }

    const pregunta = await crearPregunta(
        examenId,
        (texto as string).trim(),
        opciones as OpcionNueva[],
    );
    if (!pregunta) {
        throw new NotFoundError("No se encontró el examen indicado.");
    }

    res.status(201).json(representarPregunta(pregunta));
}
