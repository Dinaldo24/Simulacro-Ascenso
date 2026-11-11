import fs from "fs/promises";
import path from "path";
import { BadRequestError } from "./errors";

export function resolverRutaSegura(baseDir: string, ...segmentos: string[]): string {
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(resolvedBase, ...segmentos);
    const relative = path.relative(resolvedBase, resolvedTarget);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new BadRequestError("La ruta solicitada no es válida.");
    }
    return resolvedTarget;
}

export function sanitizarCursoParaArchivo(curso: string, estricto: boolean = false): string {
    const limpio = estricto
        ? curso.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, "").replace(/ +/g, "_")
        : curso.trim().replace(/ /g, "_");
    if (!limpio || limpio.includes("..") || limpio.includes("/") || limpio.includes("\\")) {
        throw new BadRequestError("El nombre del curso no es válido.");
    }
    return limpio;
}

export function validarSegmentoAnio(anio: string): string {
    const limpio = anio.trim();
    if (!limpio || !/^[a-zA-Z0-9_-]{1,20}$/.test(limpio)) {
        throw new BadRequestError("El año indicado no es válido.");
    }
    return limpio;
}

export async function eliminarArchivosExamenEnDisco(
    examenesDir: string,
    anio: string,
    curso: string,
): Promise<number> {
    const anioSeguro = validarSegmentoAnio(anio);
    const cursoSanitizado = sanitizarCursoParaArchivo(curso, false);
    const anioPath = resolverRutaSegura(examenesDir, anioSeguro);

    const archivos = [
        resolverRutaSegura(anioPath, `${anioSeguro}_${cursoSanitizado}_Preguntas.pdf`),
        resolverRutaSegura(anioPath, `${anioSeguro}_${cursoSanitizado}_Respuestas.pdf`),
        resolverRutaSegura(anioPath, `${anioSeguro}_${cursoSanitizado}_preguntas.json`),
    ];

    let eliminados = 0;
    for (const archivo of archivos) {
        try {
            await fs.unlink(archivo);
            eliminados++;
        } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err.code !== "ENOENT") {
                throw error;
            }
        }
    }

    try {
        const restantes = await fs.readdir(anioPath);
        if (restantes.length === 0) {
            await fs.rmdir(anioPath);
        }
    } catch {
        // Ignorar si el directorio no existe o no está vacío
    }

    return eliminados;
}
