import fs from "fs/promises";
import path from "path";
import { env } from "../config/env";
import { AppDataSource } from "../database/data-source";
import { esPreguntaExtraida, importarExamen } from "../modules/examen/services/ExamenCatalogoService";

/**
 * Importa a MySQL los *_preguntas.json que ya existen en storage/examenes/.
 * Es idempotente: re-ejecutarlo reemplaza las preguntas del mismo año + curso.
 * Uso: npx tsx src/scripts/importar-examenes-existentes.ts
 */
async function main(): Promise<void> {
    await AppDataSource.initialize();
    const raiz = env.storage.examenesDir;
    for (const anio of await fs.readdir(raiz)) {
        const dir = path.join(raiz, anio);
        if (!(await fs.stat(dir)).isDirectory()) continue;
        for (const archivo of await fs.readdir(dir)) {
            if (!archivo.endsWith("_preguntas.json")) continue;
            const parsed: unknown = JSON.parse(await fs.readFile(path.join(dir, archivo), "utf-8"));
            if (!Array.isArray(parsed) || !parsed.every(esPreguntaExtraida)) {
                console.warn(`SALTADO (formato inválido): ${archivo}`);
                continue;
            }
            const curso =
                (parsed[0] as { curso?: unknown } | undefined)?.curso?.toString().trim() ||
                archivo.slice(anio.length + 1, -"_preguntas.json".length).replace(/_/g, " ");
            const r = await importarExamen({
                anio,
                curso,
                archivoBase: archivo.slice(0, -"_preguntas.json".length),
                preguntas: parsed,
            });
            console.log(`OK ${anio} ${curso}: ${r.total} preguntas, ${r.conClave} con clave`);
        }
    }
    await AppDataSource.destroy();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
