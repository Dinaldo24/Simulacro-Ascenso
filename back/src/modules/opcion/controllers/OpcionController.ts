import { Request, Response } from "express";
import { BadRequestError, NotFoundError } from "../../../utils/errors";
import { esIdPositivo, obtenerIdPositivo } from "../../../utils/http";
import { Opcion } from "../entities/Opcion";
import {
    actualizarOpcion,
    buscarOpcion,
    crearOpcion,
    eliminarOpcion,
    listarOpciones,
} from "../services/OpcionService";

function representarOpcion(opcion: Opcion): object {
    return {
        id: opcion.id,
        texto: opcion.texto,
        esCorrecta: opcion.esCorrecta,
        preguntaId: opcion.pregunta.id,
    };
}

export async function listarOpcionesController(_req: Request, res: Response): Promise<void> {
    const opciones = await listarOpciones();
    res.json(opciones.map(representarOpcion));
}

export async function buscarOpcionController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id de la opción no es válido.");
    }

    const opcion = await buscarOpcion(id);
    if (!opcion) {
        throw new NotFoundError("No se encontró la opción.");
    }
    res.json(representarOpcion(opcion));
}

export async function crearOpcionController(req: Request, res: Response): Promise<void> {
    const { preguntaId, texto, esCorrecta } = req.body ?? {};
    if (
        !esIdPositivo(preguntaId) ||
        typeof texto !== "string" ||
        !texto.trim() ||
        texto.length > 255 ||
        (esCorrecta !== undefined && typeof esCorrecta !== "boolean")
    ) {
        throw new BadRequestError("Envía preguntaId y texto válidos. esCorrecta es opcional.");
    }

    const opcion = await crearOpcion(preguntaId, texto.trim(), esCorrecta ?? false);
    if (!opcion) {
        throw new NotFoundError("No se encontró la pregunta indicada.");
    }
    res.status(201).json({
        id: opcion.id,
        texto: opcion.texto,
        esCorrecta: opcion.esCorrecta,
        preguntaId,
    });
}

export async function actualizarOpcionController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    const { preguntaId, texto, esCorrecta } = req.body ?? {};
    if (
        id === null ||
        (preguntaId === undefined && texto === undefined && esCorrecta === undefined) ||
        (preguntaId !== undefined && !esIdPositivo(preguntaId)) ||
        (texto !== undefined &&
            (typeof texto !== "string" || !texto.trim() || texto.length > 255)) ||
        (esCorrecta !== undefined && typeof esCorrecta !== "boolean")
    ) {
        throw new BadRequestError("El id o los datos de la opción no son válidos.");
    }

    const opcion = await actualizarOpcion(id, {
        ...(typeof texto === "string" ? { texto: texto.trim() } : {}),
        ...(typeof esCorrecta === "boolean" ? { esCorrecta } : {}),
        ...(typeof preguntaId === "number" ? { preguntaId } : {}),
    });
    if (!opcion) {
        throw new NotFoundError("No se encontró la opción o la pregunta indicada.");
    }
    res.json(representarOpcion(opcion));
}

export async function eliminarOpcionController(req: Request, res: Response): Promise<void> {
    const id = obtenerIdPositivo(req);
    if (id === null) {
        throw new BadRequestError("El id de la opción no es válido.");
    }

    if (!(await eliminarOpcion(id))) {
        throw new NotFoundError("No se encontró la opción.");
    }
    res.status(204).send();
}
