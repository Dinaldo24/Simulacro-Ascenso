import { Request, Response } from "express";
import { BadRequestError, NotFoundError, UnauthorizedError } from "../../../utils/errors";
import { obtenerParametroTexto } from "../../../utils/http";
import { buscarEspecialidad } from "../../especialidad/services/EspecialidadService";
import { ActorExamen } from "../services/ExamenCatalogoService";
import {
    finalizarSimulacro,
    listarExamenesDisponibles,
    listarSimulacrosHistorial,
    obtenerPreguntasExamen,
    obtenerRutaFiguraExamen,
    obtenerRutaPdfExamen,
    procesarYGuardarExamen,
    PythonDesgloseError,
    registrarSimulacroHistorial,
    verificarRespuesta,
} from "../services/ExamenStorageService";
import { eliminarExamenYSincronizar } from "../../sync/ExamenDocumentoSync";

function actorDe(req: Request): ActorExamen {
    return { role: req.usuario?.role, especialidadId: req.usuario?.especialidadId };
}

export async function listarExamenesDisponiblesController(
    req: Request,
    res: Response,
): Promise<void> {
    const examenes = await listarExamenesDisponibles(actorDe(req));
    res.json({ examenes });
}

export async function obtenerPreguntasExamenController(
    req: Request,
    res: Response,
): Promise<void> {
    const anio = obtenerParametroTexto(req, "anio");
    const curso = obtenerParametroTexto(req, "curso");

    if (!anio || !curso) {
        throw new BadRequestError("Año y curso son obligatorios.");
    }

    res.json(await obtenerPreguntasExamen(anio, curso, actorDe(req)));
}

export async function eliminarExamenStorageController(
    req: Request,
    res: Response,
): Promise<void> {
    const anio = obtenerParametroTexto(req, "anio");
    const curso = obtenerParametroTexto(req, "curso");

    if (!anio || !curso) {
        throw new BadRequestError("Año y curso son obligatorios.");
    }

    if (!(await eliminarExamenYSincronizar(anio, curso))) {
        throw new NotFoundError(`No se encontró el examen ${curso} (${anio}).`);
    }
    res.json({
        mensaje: `El examen ${curso} (${anio}) y sus preguntas han sido eliminados por completo.`,
    });
}

export async function subirExamenStorageController(req: Request, res: Response): Promise<void> {
    const anio = String(req.body?.anio || "").trim();
    const especialidadId = Number(req.body?.especialidadId);
    const claveTexto =
        typeof req.body?.claveTexto === "string" ? req.body.claveTexto.trim() : "";

    if (!anio || !Number.isInteger(especialidadId) || especialidadId <= 0) {
        throw new BadRequestError("El año y la especialidad son obligatorios.");
    }
    const especialidad = await buscarEspecialidad(especialidadId);
    if (!especialidad) {
        throw new BadRequestError("La especialidad indicada no existe.");
    }
    const curso = especialidad.nombre;

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const pdfPreguntas = files?.pdfPreguntas?.[0];
    const pdfRespuestas = files?.pdfRespuestas?.[0];

    if (!pdfPreguntas) {
        throw new BadRequestError("El archivo PDF de preguntas es obligatorio.");
    }

    try {
        const resultado = await procesarYGuardarExamen({
            anio,
            curso,
            especialidadId,
            ...(claveTexto ? { claveTexto } : {}),
            pdfPreguntasBuffer: pdfPreguntas.buffer,
            ...(pdfRespuestas ? { pdfRespuestasBuffer: pdfRespuestas.buffer } : {}),
        });
        res.status(201).json(resultado);
    } catch (error) {
        if (error instanceof PythonDesgloseError) {
            res.status(500).json({
                mensaje: error.message,
                detalle: error.detalle,
            });
            return;
        }
        throw error;
    }
}

function parseDetalleRespuestas(raw: unknown): Record<string, string> {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new BadRequestError("Las respuestas del simulacro no son válidas.");
    }
    const respuestas: Record<string, string> = {};
    for (const [numero, letra] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof letra === "string") respuestas[numero] = letra;
    }
    return respuestas;
}

export async function registrarHistorialController(req: Request, res: Response): Promise<void> {
    const docenteId = Number(req.usuario?.sub);
    if (!docenteId || !Number.isInteger(docenteId)) {
        throw new UnauthorizedError("Usuario no autenticado.");
    }

    const { curso, anio, tiempoSegundos, detalleRespuestas } = req.body ?? {};
    if (typeof curso !== "string" || !curso.trim() || (typeof anio !== "string" && typeof anio !== "number")) {
        throw new BadRequestError("Faltan datos obligatorios del simulacro.");
    }
    const respuestas = parseDetalleRespuestas(detalleRespuestas);
    const tiempo = Number(tiempoSegundos ?? 0);

    // El puntaje y los aciertos se calculan en el servidor; el cliente no los envía.
    const guardado = await registrarSimulacroHistorial({
        docenteId,
        curso,
        anio: String(anio),
        tiempoSegundos: Number.isFinite(tiempo) ? tiempo : 0,
        detalleRespuestas: respuestas,
        actor: actorDe(req),
    });

    res.status(201).json({
        mensaje: "Simulacro registrado en el historial.",
        intento: guardado,
    });
}

export async function finalizarSimulacroController(req: Request, res: Response): Promise<void> {
    const docenteId = Number(req.usuario?.sub);
    if (!docenteId || !Number.isInteger(docenteId)) {
        throw new UnauthorizedError("Usuario no autenticado.");
    }
    const anio = obtenerParametroTexto(req, "anio");
    const curso = obtenerParametroTexto(req, "curso");
    if (!anio || !curso) {
        throw new BadRequestError("Año y curso son obligatorios.");
    }

    const { tiempoSegundos, detalleRespuestas } = req.body ?? {};
    const respuestas = parseDetalleRespuestas(detalleRespuestas);
    const tiempo = Number(tiempoSegundos ?? 0);

    const resultado = await finalizarSimulacro({
        docenteId,
        anio,
        curso,
        tiempoSegundos: Number.isFinite(tiempo) ? tiempo : 0,
        detalleRespuestas: respuestas,
        actor: actorDe(req),
    });

    res.status(resultado.tieneClave ? 201 : 200).json(resultado);
}

export async function listarHistorialController(req: Request, res: Response): Promise<void> {
    const usuarioId = Number(req.usuario?.sub);
    const rol = req.usuario?.role;

    let filtroDocenteId: number | undefined;
    if (typeof req.query.docenteId === "string" && req.query.docenteId.trim() !== "") {
        const parsed = Number(req.query.docenteId);
        if (!Number.isInteger(parsed) || parsed <= 0) {
            throw new BadRequestError("El parámetro docenteId no es válido.");
        }
        filtroDocenteId = parsed;
    }

    const { esGestor, historial } = await listarSimulacrosHistorial({
        usuarioId,
        rol,
        filtroDocenteId,
    });

    if (!esGestor) {
        res.json({ historial });
        return;
    }

    res.json({
        historial: historial.map((h) => ({
            id: h.id,
            docenteId: h.docenteId,
            docenteNombre: h.docente?.nombre || "Docente",
            docenteEmail: h.docente?.email || "",
            curso: h.curso,
            anio: h.anio,
            totalPreguntas: h.totalPreguntas,
            aciertos: h.aciertos,
            desaciertos: h.desaciertos,
            puntaje: h.puntaje,
            tiempoSegundos: h.tiempoSegundos,
            creadoEn: h.creadoEn,
        })),
    });
}

export async function obtenerPdfExamenController(req: Request, res: Response): Promise<void> {
    const anio = obtenerParametroTexto(req, "anio");
    const curso = obtenerParametroTexto(req, "curso");
    const tipo = obtenerParametroTexto(req, "tipo");
    if (!anio || !curso || !tipo) {
        throw new BadRequestError("Año, curso y tipo son obligatorios.");
    }
    const ruta = await obtenerRutaPdfExamen(anio, curso, tipo, actorDe(req));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, no-store");
    res.sendFile(ruta);
}

export async function verificarRespuestaController(req: Request, res: Response): Promise<void> {
    const anio = obtenerParametroTexto(req, "anio");
    const curso = obtenerParametroTexto(req, "curso");
    const numero = Number(obtenerParametroTexto(req, "numero"));
    const alternativa = req.body?.alternativa;
    if (!anio || !curso || !Number.isInteger(numero) || numero <= 0 || typeof alternativa !== "string") {
        throw new BadRequestError("Examen, número de pregunta y alternativa son obligatorios.");
    }
    res.json(await verificarRespuesta(anio, curso, numero, alternativa, actorDe(req)));
}

export async function obtenerFiguraExamenController(req: Request, res: Response): Promise<void> {
    const anio = obtenerParametroTexto(req, "anio");
    const curso = obtenerParametroTexto(req, "curso");
    const archivo = obtenerParametroTexto(req, "archivo");
    if (!anio || !curso || !archivo) {
        throw new BadRequestError("Año, curso y archivo son obligatorios.");
    }
    const ruta = await obtenerRutaFiguraExamen(anio, curso, archivo, actorDe(req));
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(ruta);
}
