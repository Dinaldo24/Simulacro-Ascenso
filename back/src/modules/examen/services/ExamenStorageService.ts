import { execFile } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import { promisify } from "util";
import { env } from "../../../config/env";
import { AppDataSource } from "../../../database/data-source";
import { BadRequestError } from "../../../utils/errors";
import {
    resolverRutaSegura,
    sanitizarCursoParaArchivo,
    validarSegmentoAnio,
} from "../../../utils/storage";
import { Documento } from "../../documento/entities/Documento";
import { eliminarDocumento, guardarDocumento } from "../../documento/services/DocumentoService";
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
    claveTexto?: string;
    pdfPreguntasBuffer: Buffer;
    pdfRespuestasBuffer?: Buffer;
}

export class PythonDesgloseError extends Error {
    constructor(public readonly detalle: string) {
        super("Error durante el desglose automático del PDF.");
        this.name = "PythonDesgloseError";
    }
}

function esPdf(buffer: Buffer): boolean {
    return buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"));
}

/**
 * Valida, desglosa con Python en un directorio temporal, guarda en MySQL y solo entonces
 * publica los archivos. Si algo falla no queda nada a medias en disco ni en la BD.
 */
export async function procesarYGuardarExamen(params: SubirExamenParams): Promise<{
    mensaje: string;
    totalPreguntas: number;
    conRespuestas: number;
    anio: string;
    curso: string;
}> {
    const anio = validarSegmentoAnio(params.anio);
    const curso = params.curso.trim();
    if (!curso || curso.length > 100) {
        throw new BadRequestError("El curso es obligatorio y no puede superar 100 caracteres.");
    }
    if (!esPdf(params.pdfPreguntasBuffer)) {
        throw new BadRequestError("El archivo de preguntas no es un PDF válido.");
    }
    if (params.pdfRespuestasBuffer && !esPdf(params.pdfRespuestasBuffer)) {
        throw new BadRequestError("El archivo de respuestas no es un PDF válido.");
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

        // Copia en el Repositorio sin duplicar: reemplaza la anterior del mismo año + curso.
        const titulo = `Examen EBR ${curso} ${anio}`;
        const previos = await AppDataSource.getRepository(Documento).findBy({ anio, curso, titulo });
        for (const previo of previos) {
            await eliminarDocumento(previo.id, { conservarExamen: true });
        }
        await guardarDocumento({
            nombreOriginal: `${archivoBase}_Preguntas.pdf`,
            contenido: params.pdfPreguntasBuffer,
            titulo,
            curso,
            anio,
        });

        return {
            mensaje: `¡Examen desglosado con éxito! Se guardaron ${importado.total} preguntas y ${importado.conClave} claves correctas. El PDF también está en el Repositorio.`,
            totalPreguntas: importado.total,
            conRespuestas: importado.conClave,
            anio,
            curso,
        };
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}
