import { execFile } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import { promisify } from "util";
import { env } from "../../../config/env";
import { BadRequestError } from "../../../utils/errors";
import {
    asegurarBufferPdf,
    resolverRutaSegura,
    sanitizarCursoParaArchivo,
    validarSegmentoAnio,
} from "../../../utils/storage";
import {
    actualizarDocumento,
    buscarDocumentosDeExamen,
    eliminarDocumento,
    guardarDocumento,
} from "../../documento/services/DocumentoService";
import { dirFigurasExamen, esPreguntaExtraida, importarExamen, PreguntaExtraida } from "./ExamenCatalogoService";

export {
    eliminarExamen,
    finalizarSimulacro,
    listarExamenesDisponibles,
    listarSimulacrosHistorial,
    obtenerPreguntasExamen,
    obtenerRutaFiguraExamen,
    obtenerRutaPdfExamen,
    registrarSimulacroHistorial,
    verificarRespuesta,
} from "./ExamenCatalogoService";

const execFileAsync = promisify(execFile);
const TIEMPO_MAXIMO_PYTHON_MS = 120_000;

export interface SubirExamenParams {
    anio: string;
    curso: string;
    especialidadId: number;
    claveTexto?: string | undefined;
    pdfPreguntasBuffer: Buffer;
    pdfRespuestasBuffer?: Buffer | undefined;
    documentoExistenteId?: number | undefined;
    sincronizarRepositorio?: boolean | undefined;
}

export interface ResultadoDesgloseExamen {
    examenId: number;
    anio: string;
    curso: string;
    totalPreguntas: number;
    conRespuestas: number;
    mensaje: string;
}

export class PythonDesgloseError extends Error {
    constructor(public readonly detalle: string) {
        super("Error durante el desglose automático del PDF.");
        this.name = "PythonDesgloseError";
    }
}

/**
 * Valida, desglosa con Python en un directorio temporal, guarda en MySQL y publica
 * los archivos del examen sin tocar el Repositorio (`documentos`).
 */
export async function extraerYPublicarExamenSinRepositorio(
    params: Omit<SubirExamenParams, "documentoExistenteId" | "sincronizarRepositorio">,
): Promise<ResultadoDesgloseExamen & { archivoBase: string }> {
    const anio = validarSegmentoAnio(params.anio);
    const curso = params.curso.trim();
    if (!curso || curso.length > 100) {
        throw new BadRequestError("El curso es obligatorio y no puede superar 100 caracteres.");
    }
    asegurarBufferPdf(params.pdfPreguntasBuffer, "El archivo de preguntas");
    if (params.pdfRespuestasBuffer) {
        asegurarBufferPdf(params.pdfRespuestasBuffer, "El archivo de respuestas");
    }

    const archivoBase = `${anio}_${sanitizarCursoParaArchivo(curso, true)}`;
    const anioDir = resolverRutaSegura(env.storage.examenesDir, anio);
    const tmpDir = resolverRutaSegura(anioDir, `.tmp-${randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    try {
        const preguntasTmp = resolverRutaSegura(tmpDir, "Preguntas.pdf");
        const respuestasTmp = resolverRutaSegura(tmpDir, "Respuestas.pdf");
        const jsonTmp = resolverRutaSegura(tmpDir, "preguntas.json");
        const figurasTmp = resolverRutaSegura(tmpDir, "figuras");
        await fs.writeFile(preguntasTmp, params.pdfPreguntasBuffer);
        if (params.pdfRespuestasBuffer) await fs.writeFile(respuestasTmp, params.pdfRespuestasBuffer);

        const args = [env.storage.pdfExtractorScript, preguntasTmp, "-a", anio, "-k", curso, "-o", jsonTmp, "-f", figurasTmp];
        if (params.pdfRespuestasBuffer) args.push("-r", respuestasTmp);
        if (params.claveTexto) args.push("-c", params.claveTexto);

        let stdout = "";
        try {
            const result = await execFileAsync("python", args, {
                timeout: TIEMPO_MAXIMO_PYTHON_MS,
                maxBuffer: 5 * 1024 * 1024,
            });
            stdout = result.stdout;
        } catch (error) {
            const execErr = error as Error & { stderr?: string };
            console.error("[Python Error al desglosar examen]", execErr, execErr.stderr);
            throw new PythonDesgloseError(execErr.stderr || execErr.message);
        }

        try {
            const resumen = JSON.parse(stdout) as { error?: string };
            if (resumen.error) throw new BadRequestError(resumen.error);
        } catch (error) {
            if (error instanceof BadRequestError) throw error;
            // stdout no era JSON: se valida el archivo de salida a continuación
        }

        let preguntas: PreguntaExtraida[];
        try {
            const parsed: unknown = JSON.parse(await fs.readFile(jsonTmp, "utf-8"));
            if (!Array.isArray(parsed) || !parsed.every(esPreguntaExtraida)) {
                throw new Error("formato inesperado");
            }
            preguntas = parsed;
        } catch {
            throw new BadRequestError("No se pudieron extraer preguntas válidas del PDF.");
        }

        const importado = await importarExamen({
            anio,
            curso,
            archivoBase,
            especialidadId: params.especialidadId,
            preguntas,
        });

        // Publicar archivos definitivos (sobrescribe una versión previa del mismo examen).
        await fs.rename(preguntasTmp, resolverRutaSegura(anioDir, `${archivoBase}_Preguntas.pdf`));
        const respuestasFinal = resolverRutaSegura(anioDir, `${archivoBase}_Respuestas.pdf`);
        if (params.pdfRespuestasBuffer) {
            await fs.rename(respuestasTmp, respuestasFinal);
        } else {
            await fs.rm(respuestasFinal, { force: true });
        }
        await fs.rename(jsonTmp, resolverRutaSegura(anioDir, `${archivoBase}_preguntas.json`));
        const figurasFinal = dirFigurasExamen(anio, archivoBase);
        await fs.rm(figurasFinal, { recursive: true, force: true });
        if (
            preguntas.some(
                (q) =>
                    Boolean(q.figuras?.length) ||
                    (Boolean(q.figurasAlternativas) && Object.keys(q.figurasAlternativas!).length > 0),
            )
        ) {
            await fs.rename(figurasTmp, figurasFinal);
        }

        return {
            examenId: importado.examenId,
            anio,
            curso,
            archivoBase,
            totalPreguntas: importado.total,
            conRespuestas: importado.conClave,
            mensaje: `¡Examen desglosado con éxito! Se guardaron ${importado.total} preguntas y ${importado.conClave} claves correctas.`,
        };
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}

/**
 * Valida, desglosa con Python en un directorio temporal, guarda en MySQL y publica
 * los archivos. Cuando `sincronizarRepositorio` es true (por defecto), mantiene
 * sincronizada una única fila vinculada en `documentos` vía `examenId`.
 */
export async function procesarYGuardarExamen(params: SubirExamenParams): Promise<ResultadoDesgloseExamen> {
    const resultado = await extraerYPublicarExamenSinRepositorio(params);

    if (params.documentoExistenteId !== undefined) {
        await actualizarDocumento(params.documentoExistenteId, {
            examenId: resultado.examenId,
            curso: resultado.curso,
        });
    } else if (params.sincronizarRepositorio !== false) {
        const titulo = `Examen EBR ${resultado.curso} ${resultado.anio}`.slice(0, 150);
        const existentes = await buscarDocumentosDeExamen({
            examenId: resultado.examenId,
            anio: resultado.anio,
            curso: resultado.curso,
            archivoBase: resultado.archivoBase,
            titulo,
        });

        const pdfPreguntasEntrada = {
            nombreOriginal: `${resultado.archivoBase}_Preguntas.pdf`,
            contenido: params.pdfPreguntasBuffer,
        };
        const pdfRespuestasEntrada = params.pdfRespuestasBuffer
            ? {
                  nombreOriginal: `${resultado.archivoBase}_Respuestas.pdf`,
                  contenido: params.pdfRespuestasBuffer,
              }
            : undefined;

        if (existentes.length > 0) {
            const [principal, ...duplicados] = existentes;
            await actualizarDocumento(principal!.id, {
                anio: resultado.anio,
                curso: resultado.curso,
                examenId: resultado.examenId,
                pdfPreguntas: pdfPreguntasEntrada,
                ...(pdfRespuestasEntrada
                    ? { pdfRespuestas: pdfRespuestasEntrada }
                    : { eliminarRespuestas: true }),
            });
            for (const duplicado of duplicados) {
                await eliminarDocumento(duplicado.id);
            }
        } else {
            await guardarDocumento({
                nombreOriginal: pdfPreguntasEntrada.nombreOriginal,
                contenido: pdfPreguntasEntrada.contenido,
                ...(pdfRespuestasEntrada
                    ? {
                          respuestasNombreOriginal: pdfRespuestasEntrada.nombreOriginal,
                          respuestasContenido: pdfRespuestasEntrada.contenido,
                      }
                    : {}),
                titulo,
                curso: resultado.curso,
                anio: resultado.anio,
                examenId: resultado.examenId,
            });
        }
    }

    return {
        examenId: resultado.examenId,
        anio: resultado.anio,
        curso: resultado.curso,
        totalPreguntas: resultado.totalPreguntas,
        conRespuestas: resultado.conRespuestas,
        mensaje:
            params.sincronizarRepositorio === false
                ? resultado.mensaje
                : `${resultado.mensaje} El PDF también está en el Repositorio.`,
    };
}
