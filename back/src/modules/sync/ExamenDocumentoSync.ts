import { validarSegmentoAnio } from "../../utils/storage";
import { Documento } from "../documento/entities/Documento";
import {
    actualizarDocumento,
    ActualizarDocumentoParams,
    buscarDocumento,
    buscarDocumentosDeExamen,
    contarDocumentosPorExamenId,
    eliminarDocumento,
    guardarDocumento,
    GuardarDocumentoParams,
    leerBufferDocumento,
} from "../documento/services/DocumentoService";
import { Especialidad } from "../especialidad/entities/Especialidad";
import { buscarEspecialidadPorNombre } from "../especialidad/services/EspecialidadService";
import {
    buscarExamenPorAnioYCurso,
    eliminarExamen,
    eliminarExamenPorId,
} from "../examen/services/ExamenCatalogoService";
import { extraerYPublicarExamenSinRepositorio } from "../examen/services/ExamenStorageService";

export interface ResultadoSyncDocumento {
    documento: Documento;
    sincronizadoSimulador: boolean;
    totalPreguntasDesglosadas?: number | undefined;
}

export interface ResultadoActualizacionSync extends ResultadoSyncDocumento {
    resincronizado: boolean;
}

async function resolverDestinoSimulador(
    anio: string | null | undefined,
    curso: string | null | undefined,
): Promise<{ anio: string; especialidad: Especialidad } | null> {
    if (!anio || !curso) return null;
    const anioTrim = anio.trim();
    if (!/^\d{4}$/.test(anioTrim)) return null;

    let anioValido: string;
    try {
        anioValido = validarSegmentoAnio(anioTrim);
    } catch {
        return null;
    }

    const especialidad = await buscarEspecialidadPorNombre(curso);
    if (!especialidad) return null;
    return { anio: anioValido, especialidad };
}

async function limpiarExamenHuerfano(params: {
    examenId: number | null;
    excluirDocumentoId?: number | undefined;
    anio?: string | null | undefined;
    curso?: string | null | undefined;
    titulo?: string | undefined;
}): Promise<void> {
    if (params.examenId !== null) {
        const restantes = await contarDocumentosPorExamenId(
            params.examenId,
            params.excluirDocumentoId,
        );
        if (restantes === 0) {
            await eliminarExamenPorId(params.examenId).catch((error) => {
                console.warn(`No se pudo eliminar examen#${params.examenId}:`, error);
            });
        }
        return;
    }

    if (params.anio && params.curso && params.titulo?.startsWith("Examen EBR ")) {
        await eliminarExamen(params.anio, params.curso).catch((error) => {
            console.warn(`No se pudo eliminar examen ${params.curso} (${params.anio}):`, error);
        });
    }
}

async function sincronizarDocumentoConSimulador(
    documento: Documento,
    buffers?: { pdfPreguntas?: Buffer | undefined; pdfRespuestas?: Buffer | undefined },
): Promise<ResultadoSyncDocumento> {
    const destino = await resolverDestinoSimulador(documento.anio, documento.curso);
    if (!destino) {
        return { documento, sincronizadoSimulador: false };
    }

    const pdfPreguntasBuffer =
        buffers?.pdfPreguntas ?? (await leerBufferDocumento(documento, "preguntas"));
    if (!pdfPreguntasBuffer) {
        console.warn(
            `[Sync] Documento #${documento.id} sin PDF de preguntas disponible en disco para desglose.`,
        );
        return { documento, sincronizadoSimulador: false };
    }

    let pdfRespuestasBuffer = buffers?.pdfRespuestas;
    if (!pdfRespuestasBuffer && documento.respuestasNombreArchivo) {
        pdfRespuestasBuffer = (await leerBufferDocumento(documento, "respuestas")) ?? undefined;
    }

    try {
        const resultado = await extraerYPublicarExamenSinRepositorio({
            anio: destino.anio,
            curso: destino.especialidad.nombre,
            especialidadId: destino.especialidad.id,
            pdfPreguntasBuffer,
            ...(pdfRespuestasBuffer ? { pdfRespuestasBuffer } : {}),
        });

        if (resultado.totalPreguntas <= 0) {
            console.warn(
                `[Sync] Documento #${documento.id} no produjo preguntas válidas para Simulación.`,
            );
            return { documento, sincronizadoSimulador: false };
        }

        const actualizado = await actualizarDocumento(documento.id, {
            examenId: resultado.examenId,
            curso: destino.especialidad.nombre,
        });

        return {
            documento: actualizado ?? documento,
            sincronizadoSimulador: true,
            totalPreguntasDesglosadas: resultado.totalPreguntas,
        };
    } catch (error) {
        console.warn(
            `[Sync] Documento #${documento.id} guardado en Repositorio sin desglose para Simulación:`,
            error instanceof Error ? error.message : error,
        );
        return { documento, sincronizadoSimulador: false };
    }
}

export async function subirDocumentoYSincronizar(
    params: GuardarDocumentoParams,
): Promise<ResultadoSyncDocumento> {
    const documento = await guardarDocumento(params);
    return sincronizarDocumentoConSimulador(documento, {
        pdfPreguntas: params.contenido,
        ...(params.respuestasContenido ? { pdfRespuestas: params.respuestasContenido } : {}),
    });
}

export async function actualizarDocumentoYSincronizar(
    id: number,
    cambios: ActualizarDocumentoParams,
): Promise<ResultadoActualizacionSync | null> {
    const previo = await buscarDocumento(id);
    if (!previo) return null;

    const actualizado = await actualizarDocumento(id, cambios);
    if (!actualizado) return null;

    const cursoCambio =
        cambios.curso !== undefined && (previo.curso ?? null) !== (actualizado.curso ?? null);
    const anioCambio =
        cambios.anio !== undefined && (previo.anio ?? null) !== (actualizado.anio ?? null);
    const pdfCambio = Boolean(
        cambios.pdfPreguntas || cambios.pdfRespuestas || cambios.eliminarRespuestas,
    );

    if (!pdfCambio && !cursoCambio && !anioCambio) {
        return {
            documento: actualizado,
            resincronizado: false,
            sincronizadoSimulador: Boolean(actualizado.examenId),
        };
    }

    const sync = await sincronizarDocumentoConSimulador(actualizado, {
        ...(cambios.pdfPreguntas ? { pdfPreguntas: cambios.pdfPreguntas.contenido } : {}),
        ...(cambios.pdfRespuestas ? { pdfRespuestas: cambios.pdfRespuestas.contenido } : {}),
    });

    if (sync.sincronizadoSimulador) {
        if (previo.examenId !== null && previo.examenId !== sync.documento.examenId) {
            await limpiarExamenHuerfano({
                examenId: previo.examenId,
                excluirDocumentoId: id,
            });
        }
        return {
            documento: sync.documento,
            resincronizado: true,
            sincronizadoSimulador: true,
            totalPreguntasDesglosadas: sync.totalPreguntasDesglosadas,
        };
    }

    let documentoFinal = sync.documento;
    if (previo.examenId !== null) {
        documentoFinal = (await actualizarDocumento(id, { examenId: null })) ?? sync.documento;
        await limpiarExamenHuerfano({
            examenId: previo.examenId,
            excluirDocumentoId: id,
        });
    }

    return {
        documento: documentoFinal,
        resincronizado: true,
        sincronizadoSimulador: false,
    };
}

export async function eliminarDocumentoYSincronizar(id: number): Promise<boolean> {
    const documento = await buscarDocumento(id);
    if (!documento) return false;

    const { examenId, anio, curso, titulo } = documento;
    const eliminado = await eliminarDocumento(id);
    if (!eliminado) return false;

    await limpiarExamenHuerfano({
        examenId,
        excluirDocumentoId: id,
        anio,
        curso,
        titulo,
    });
    return true;
}

export async function eliminarExamenYSincronizar(anio: string, curso: string): Promise<boolean> {
    const anioSeguro = validarSegmentoAnio(anio);
    const cursoLimpio = curso.trim();
    const examen = await buscarExamenPorAnioYCurso(anioSeguro, cursoLimpio);
    if (!examen) return false;

    // Buscar y borrar primero los documentos vinculados antes de que ON DELETE SET NULL limpie examenId.
    const docs = await buscarDocumentosDeExamen({
        examenId: examen.id,
        anio: anioSeguro,
        curso: cursoLimpio,
        archivoBase: examen.archivoBase,
        titulo: examen.titulo,
    });
    for (const doc of docs) {
        await eliminarDocumento(doc.id);
    }

    return eliminarExamen(anioSeguro, cursoLimpio);
}
