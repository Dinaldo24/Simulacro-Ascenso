import fs from "fs/promises";
import { env } from "../../../config/env";
import { AppDataSource } from "../../../database/data-source";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../../utils/errors";
import { resolverRutaSegura, validarSegmentoAnio } from "../../../utils/storage";
import { Opcion } from "../../opcion/entities/Opcion";
import { Pregunta } from "../../pregunta/entities/Pregunta";
import { Examen } from "../entities/Examen";
import { SimulacroDocente } from "../entities/SimulacroDocente";

/** Formato que genera pdf_a_preguntas.py. */
export interface PreguntaExtraida {
    numero: number;
    enunciado: string;
    alternativas: Record<string, string>;
    correcta?: string;
    contexto?: string;
    figuras?: string[];
    figurasAlternativas?: Record<string, string>;
}

const RE_NOMBRE_FIGURA = /^q\d{1,3}_\d{1,2}\.png$/;

function urlFiguraExamen(anio: string | number | null | undefined, curso: string | null | undefined, archivo: string): string {
    return `/examenes-disponibles/${encodeURIComponent(String(anio ?? ""))}/${encodeURIComponent(String(curso ?? ""))}/figuras/${archivo}`;
}

export interface ExamenDisponible {
    anio: string;
    curso: string;
    tienePreguntasPdf: boolean;
    tieneRespuestasPdf: boolean;
    tieneJson: boolean;
    tieneClave: boolean;
    preguntasPdfUrl: string | null;
    respuestasPdfUrl: string | null;
    totalPreguntas: number;
}

export function esPreguntaExtraida(valor: unknown): valor is PreguntaExtraida {
    if (typeof valor !== "object" || valor === null) return false;
    const q = valor as Record<string, unknown>;
    return (
        Number.isInteger(q.numero) &&
        typeof q.enunciado === "string" &&
        typeof q.alternativas === "object" &&
        q.alternativas !== null
    );
}

async function existe(ruta: string): Promise<boolean> {
    try {
        await fs.access(ruta);
        return true;
    } catch {
        return false;
    }
}

function rutaArchivo(anio: string, archivoBase: string, sufijo: string): string {
    return resolverRutaSegura(env.storage.examenesDir, anio, `${archivoBase}_${sufijo}`);
}

/** Quien consulta: los profesores solo acceden a los exámenes de su especialidad. */
export interface ActorExamen {
    role?: string | undefined;
    especialidadId?: number | null | undefined;
}

function estaRestringido(actor?: ActorExamen): boolean {
    return actor?.role === "profesor";
}

async function buscarExamen(anio: string, curso: string, actor?: ActorExamen): Promise<Examen> {
    const anioSeguro = validarSegmentoAnio(anio);
    const examen = await AppDataSource.getRepository(Examen).findOneBy({
        anio: anioSeguro,
        curso: curso.trim(),
    });
    if (!examen) {
        throw new NotFoundError(`No se encontró el examen ${curso} (${anio}).`);
    }
    if (estaRestringido(actor) && (!actor?.especialidadId || examen.especialidadId !== actor.especialidadId)) {
        throw new ForbiddenError("Este examen no corresponde a tu especialidad.");
    }
    return examen;
}

export async function listarExamenesDisponibles(actor?: ActorExamen): Promise<ExamenDisponible[]> {
    const consulta = AppDataSource.getRepository(Examen)
        .createQueryBuilder("e")
        .leftJoin("e.preguntas", "p")
        .select(["e.id", "e.anio", "e.curso", "e.archivoBase", "e.tieneClave"])
        .addSelect("COUNT(p.id)", "total")
        .where("e.anio IS NOT NULL AND e.curso IS NOT NULL")
        .groupBy("e.id")
        .orderBy("e.anio", "DESC")
        .addOrderBy("e.curso", "ASC");
    if (estaRestringido(actor)) {
        consulta.andWhere("e.especialidadId = :esp", { esp: actor?.especialidadId ?? -1 });
    }
    const filas = await consulta.getRawAndEntities();

    const resultado: ExamenDisponible[] = [];
    for (const [i, e] of filas.entities.entries()) {
        const anio = e.anio as string;
        const curso = e.curso as string;
        const base = e.archivoBase;
        const tienePreguntasPdf = base ? await existe(rutaArchivo(anio, base, "Preguntas.pdf")) : false;
        const tieneRespuestasPdf = base ? await existe(rutaArchivo(anio, base, "Respuestas.pdf")) : false;
        const prefijo = `/examenes-disponibles/${encodeURIComponent(anio)}/${encodeURIComponent(curso)}/pdf`;
        resultado.push({
            anio,
            curso,
            tienePreguntasPdf,
            tieneRespuestasPdf,
            tieneJson: true,
            tieneClave: e.tieneClave,
            preguntasPdfUrl: tienePreguntasPdf ? `${prefijo}/preguntas` : null,
            respuestasPdfUrl: tieneRespuestasPdf ? `${prefijo}/respuestas` : null,
            totalPreguntas: Number(filas.raw[i]?.total ?? 0),
        });
    }
    return resultado;
}

/** Inserta o reemplaza (por año + curso) el examen y sus preguntas/opciones en una transacción. */
export async function importarExamen(params: {
    anio: string;
    curso: string;
    archivoBase: string;
    especialidadId?: number | null;
    preguntas: PreguntaExtraida[];
}): Promise<{ examenId: number; total: number; conClave: number }> {
    if (params.preguntas.length === 0) {
        throw new BadRequestError("El examen no contiene preguntas.");
    }
    const anio = validarSegmentoAnio(params.anio);
    const curso = params.curso.trim().slice(0, 100);
    const conClave = params.preguntas.filter((q) => (q.correcta ?? "").trim() !== "").length;

    return AppDataSource.transaction(async (manager) => {
        const examenes = manager.getRepository(Examen);
        let examen = await examenes.findOneBy({ anio, curso });
        if (!examen) {
            examen = examenes.create({ anio, curso, descripcion: null });
        }
        examen.titulo = `Examen EBR ${curso} ${anio}`.slice(0, 150);
        examen.archivoBase = params.archivoBase;
        if (params.especialidadId !== undefined) examen.especialidadId = params.especialidadId;
        examen.tieneClave = conClave > 0;
        examen = await examenes.save(examen);

        await manager.getRepository(Pregunta).delete({ examen: { id: examen.id } });

        for (const q of params.preguntas) {
            const correcta = (q.correcta ?? "").trim().toUpperCase();
            const pregunta = await manager.getRepository(Pregunta).save(
                manager.getRepository(Pregunta).create({
                    texto: q.enunciado,
                    numero: q.numero,
                    contexto: q.contexto?.trim() || null,
                    figuras: Array.isArray(q.figuras) && q.figuras.length > 0 ? q.figuras : null,
                    examen,
                }),
            );
            const figsAltNorm = new Map<string, string>();
            for (const [k, v] of Object.entries(q.figurasAlternativas ?? {})) {
                const limpio = typeof v === "string" ? v.trim() : "";
                if (RE_NOMBRE_FIGURA.test(limpio)) {
                    figsAltNorm.set(k.trim().toUpperCase().slice(0, 1), limpio);
                }
            }
            const opciones = Object.entries(q.alternativas).map(([letra, texto]) => {
                const letraNorm = letra.trim().toUpperCase().slice(0, 1);
                return manager.getRepository(Opcion).create({
                    letra: letraNorm,
                    texto: String(texto),
                    figura: figsAltNorm.get(letraNorm) ?? null,
                    esCorrecta: correcta !== "" && letraNorm === correcta,
                    pregunta,
                });
            });
            if (opciones.length > 0) await manager.getRepository(Opcion).save(opciones);
        }
        return { examenId: examen.id, total: params.preguntas.length, conClave };
    });
}

/** Devuelve las preguntas SIN la clave; la respuesta correcta solo se revela al verificar. */
export async function obtenerPreguntasExamen(
    anio: string,
    curso: string,
    actor?: ActorExamen,
): Promise<PreguntaExtraida[]> {
    const examen = await buscarExamen(anio, curso, actor);
    const preguntas = await AppDataSource.getRepository(Pregunta).find({
        where: { examen: { id: examen.id } },
        relations: { opciones: true },
        order: { numero: "ASC" },
    });
    return preguntas.map((p) => {
        const opciones = [...p.opciones].sort((a, b) => a.letra.localeCompare(b.letra));
        const figurasAltEntries = opciones
            .filter((o) => Boolean(o.figura))
            .map((o) => [o.letra, urlFiguraExamen(examen.anio, examen.curso, o.figura!)] as const);
        return {
            anio: Number.isNaN(Number(examen.anio)) ? examen.anio : Number(examen.anio),
            curso: examen.curso,
            numero: p.numero,
            enunciado: p.texto,
            alternativas: Object.fromEntries(opciones.map((o) => [o.letra, o.texto])),
            ...(p.contexto ? { contexto: p.contexto } : {}),
            ...(p.figuras?.length
                ? {
                      figuras: p.figuras.map((f) => urlFiguraExamen(examen.anio, examen.curso, f)),
                  }
                : {}),
            ...(figurasAltEntries.length > 0
                ? { figurasAlternativas: Object.fromEntries(figurasAltEntries) }
                : {}),
        } as PreguntaExtraida;
    });
}

export async function verificarRespuesta(
    anio: string,
    curso: string,
    numero: number,
    alternativa: string,
    actor?: ActorExamen,
): Promise<{ correcta: string; esCorrecta: boolean; tieneClave: boolean }> {
    const examen = await buscarExamen(anio, curso, actor);
    const pregunta = await AppDataSource.getRepository(Pregunta).findOne({
        where: { examen: { id: examen.id }, numero },
        relations: { opciones: true },
    });
    if (!pregunta) throw new NotFoundError("No existe esa pregunta en el examen.");
    const letra = alternativa.trim().toUpperCase();
    if (!pregunta.opciones.some((o) => o.letra === letra)) {
        throw new BadRequestError("La alternativa indicada no existe en la pregunta.");
    }
    const correcta = pregunta.opciones.find((o) => o.esCorrecta)?.letra ?? "";
    return { correcta, esCorrecta: correcta !== "" && correcta === letra, tieneClave: correcta !== "" };
}

export async function obtenerRutaPdfExamen(
    anio: string,
    curso: string,
    tipo: string,
    actor?: ActorExamen,
): Promise<string> {
    if (tipo !== "preguntas" && tipo !== "respuestas") {
        throw new BadRequestError("El tipo de PDF no es válido.");
    }
    const examen = await buscarExamen(anio, curso, actor);
    if (!examen.archivoBase || !examen.anio) throw new NotFoundError("El examen no tiene PDF asociado.");
    const ruta = rutaArchivo(
        examen.anio,
        examen.archivoBase,
        tipo === "preguntas" ? "Preguntas.pdf" : "Respuestas.pdf",
    );
    if (!(await existe(ruta))) throw new NotFoundError("No se encontró el PDF solicitado.");
    return ruta;
}

const RE_ARCHIVO_FIGURA = /^q\d{1,3}_\d{1,2}\.png$/;

export function dirFigurasExamen(anio: string, archivoBase: string): string {
    return resolverRutaSegura(env.storage.examenesDir, anio, `${archivoBase}_figuras`);
}

export async function obtenerRutaFiguraExamen(
    anio: string,
    curso: string,
    archivo: string,
    actor?: ActorExamen,
): Promise<string> {
    if (!RE_ARCHIVO_FIGURA.test(archivo)) throw new BadRequestError("El nombre de la figura no es válido.");
    const examen = await buscarExamen(anio, curso, actor);
    if (!examen.archivoBase || !examen.anio) throw new NotFoundError("El examen no tiene figuras.");
    const ruta = resolverRutaSegura(dirFigurasExamen(examen.anio, examen.archivoBase), archivo);
    if (!(await existe(ruta))) throw new NotFoundError("No se encontró la figura solicitada.");
    return ruta;
}

export async function eliminarArchivosDeExamen(anio: string, archivoBase: string): Promise<number> {
    let eliminados = 0;
    for (const sufijo of ["Preguntas.pdf", "Respuestas.pdf", "preguntas.json"]) {
        try {
            await fs.unlink(rutaArchivo(anio, archivoBase, sufijo));
            eliminados++;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
    await fs.rm(dirFigurasExamen(anio, archivoBase), { recursive: true, force: true });
    try {
        const dir = resolverRutaSegura(env.storage.examenesDir, anio);
        if ((await fs.readdir(dir)).length === 0) await fs.rmdir(dir);
    } catch {
        // directorio ya inexistente o no vacío
    }
    return eliminados;
}

export async function buscarExamenPorAnioYCurso(
    anio: string,
    curso: string,
): Promise<Examen | null> {
    const anioSeguro = validarSegmentoAnio(anio);
    return AppDataSource.getRepository(Examen).findOneBy({
        anio: anioSeguro,
        curso: curso.trim(),
    });
}

async function borrarExamenYArchivos(examen: Examen): Promise<boolean> {
    const anioSeguro = examen.anio ? validarSegmentoAnio(examen.anio) : null;
    const archivoBase = examen.archivoBase;
    await AppDataSource.getRepository(Examen).remove(examen);
    if (anioSeguro && archivoBase) await eliminarArchivosDeExamen(anioSeguro, archivoBase);
    return true;
}

/** Borra el examen (cascada a preguntas/opciones) y sus archivos. Devuelve false si no existía. */
export async function eliminarExamen(anio: string, curso: string): Promise<boolean> {
    const examen = await buscarExamenPorAnioYCurso(anio, curso);
    if (!examen) return false;
    return borrarExamenYArchivos(examen);
}

/** Borra un examen por su ID junto con sus archivos en disco. */
export async function eliminarExamenPorId(id: number): Promise<boolean> {
    const examen = await AppDataSource.getRepository(Examen).findOneBy({ id });
    if (!examen) return false;
    return borrarExamenYArchivos(examen);
}

export interface RegistrarSimulacroParams {
    docenteId: number;
    anio: string;
    curso: string;
    tiempoSegundos: number;
    detalleRespuestas: Record<string, string>;
    actor?: ActorExamen;
}

export interface ResultadoFinalizacionSimulacro {
    tieneClave: boolean;
    totalPreguntas: number;
    aciertos: number;
    desaciertos: number;
    sinResponder: number;
    puntaje: number;
    claves: Record<string, string>;
    intentoId: number | null;
}

function evaluarRespuestasExamen(
    preguntas: Pregunta[],
    detalleRespuestas: Record<string, string>,
): {
    totalPreguntas: number;
    aciertos: number;
    desaciertos: number;
    sinResponder: number;
    puntaje: number;
    detalle: Record<string, string>;
    claves: Record<string, string>;
} {
    let aciertos = 0;
    let desaciertos = 0;
    const detalle: Record<string, string> = {};
    const claves: Record<string, string> = {};

    for (const p of preguntas) {
        const key = String(p.numero);
        const correcta = p.opciones.find((o) => o.esCorrecta)?.letra?.trim().toUpperCase();
        if (correcta) claves[key] = correcta;

        const elegida = (detalleRespuestas[key] ?? "").trim().toUpperCase();
        if (!elegida) continue;
        detalle[key] = elegida;
        if (!correcta) continue;
        if (correcta === elegida) aciertos++;
        else desaciertos++;
    }

    const totalPreguntas = preguntas.length;
    const respondidas = Object.keys(detalle).length;
    const sinResponder = Math.max(0, totalPreguntas - respondidas);
    const puntaje = totalPreguntas > 0 ? Math.round((aciertos / totalPreguntas) * 20 * 100) / 100 : 0;

    return { totalPreguntas, aciertos, desaciertos, sinResponder, puntaje, detalle, claves };
}

type EvaluacionSimulacro = ReturnType<typeof evaluarRespuestasExamen>;

function guardarIntentoSimulacro(
    examen: Examen,
    datos: RegistrarSimulacroParams,
    evalRes: EvaluacionSimulacro,
): Promise<SimulacroDocente> {
    const repo = AppDataSource.getRepository(SimulacroDocente);
    return repo.save(
        repo.create({
            docenteId: datos.docenteId,
            examenId: examen.id,
            curso: examen.curso as string,
            anio: examen.anio as string,
            totalPreguntas: evalRes.totalPreguntas,
            aciertos: evalRes.aciertos,
            desaciertos: evalRes.desaciertos,
            puntaje: evalRes.puntaje,
            tiempoSegundos: Math.max(0, Math.floor(datos.tiempoSegundos) || 0),
            detalleRespuestas: evalRes.detalle,
        }),
    );
}

/** Califica en el servidor: el cliente solo envía sus respuestas, nunca puntajes. */
export async function registrarSimulacroHistorial(datos: RegistrarSimulacroParams): Promise<SimulacroDocente> {
    const examen = await buscarExamen(datos.anio, datos.curso, datos.actor);
    if (!examen.tieneClave) {
        throw new BadRequestError("Este examen no tiene clave de respuestas; no se puede calificar.");
    }
    const preguntas = await AppDataSource.getRepository(Pregunta).find({
        where: { examen: { id: examen.id } },
        relations: { opciones: true },
    });
    const evalRes = evaluarRespuestasExamen(preguntas, datos.detalleRespuestas);
    return guardarIntentoSimulacro(examen, datos, evalRes);
}

/** Finaliza el simulacro, califica todas las respuestas en bloque, guarda el intento si tiene clave y devuelve las claves oficiales. */
export async function finalizarSimulacro(
    datos: RegistrarSimulacroParams,
): Promise<ResultadoFinalizacionSimulacro> {
    const examen = await buscarExamen(datos.anio, datos.curso, datos.actor);
    const preguntas = await AppDataSource.getRepository(Pregunta).find({
        where: { examen: { id: examen.id } },
        relations: { opciones: true },
        order: { numero: "ASC" },
    });
    const evalRes = evaluarRespuestasExamen(preguntas, datos.detalleRespuestas);

    if (!examen.tieneClave) {
        return {
            tieneClave: false,
            totalPreguntas: evalRes.totalPreguntas,
            aciertos: 0,
            desaciertos: 0,
            sinResponder: evalRes.sinResponder,
            puntaje: 0,
            claves: {},
            intentoId: null,
        };
    }

    const guardado = await guardarIntentoSimulacro(examen, datos, evalRes);

    return {
        tieneClave: true,
        totalPreguntas: evalRes.totalPreguntas,
        aciertos: evalRes.aciertos,
        desaciertos: evalRes.desaciertos,
        sinResponder: evalRes.sinResponder,
        puntaje: evalRes.puntaje,
        claves: evalRes.claves,
        intentoId: guardado.id,
    };
}

export async function listarSimulacrosHistorial(params: {
    usuarioId: number;
    rol?: string | undefined;
    filtroDocenteId?: number | undefined;
}): Promise<{ esGestor: boolean; historial: SimulacroDocente[] }> {
    const repo = AppDataSource.getRepository(SimulacroDocente);
    const esGestor = params.rol === "administrador" || params.rol === "director";
    if (!esGestor) {
        return {
            esGestor: false,
            historial: await repo.find({ where: { docenteId: params.usuarioId }, order: { creadoEn: "DESC" } }),
        };
    }
    return {
        esGestor: true,
        historial: await repo.find({
            where: params.filtroDocenteId ? { docenteId: params.filtroDocenteId } : {},
            relations: { docente: true },
            order: { creadoEn: "DESC" },
        }),
    };
}
