import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { env } from "../config/env";
import { AppDataSource } from "../database/data-source";
import { dirFigurasExamen } from "../modules/examen/services/ExamenCatalogoService";
import { Examen } from "../modules/examen/entities/Examen";
import { Pregunta } from "../modules/pregunta/entities/Pregunta";
import { resolverRutaSegura } from "../utils/storage";

const execFileAsync = promisify(execFile);

/**
 * Re-extrae las figuras de los exámenes ya cargados sin tocar sus preguntas ni claves.
 * Uso: npx tsx src/scripts/reextraer-figuras.ts
 */
async function main(): Promise<void> {
    await AppDataSource.initialize();
    const examenes = await AppDataSource.getRepository(Examen).find();
    for (const e of examenes) {
        if (!e.archivoBase || !e.anio || !e.curso) continue;
        const pdf = resolverRutaSegura(env.storage.examenesDir, e.anio, `${e.archivoBase}_Preguntas.pdf`);
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "figuras-"));
        try {
            const jsonTmp = path.join(tmp, "preguntas.json");
            const figurasTmp = path.join(tmp, "figuras");
            await execFileAsync(
                "python",
                [env.storage.pdfExtractorScript, pdf, "-a", e.anio, "-k", e.curso, "-o", jsonTmp, "-f", figurasTmp],
                { timeout: 120_000, maxBuffer: 5 * 1024 * 1024 },
            );
            const preguntas = JSON.parse(await fs.readFile(jsonTmp, "utf-8")) as {
                numero: number;
                figuras?: string[];
            }[];
            const repo = AppDataSource.getRepository(Pregunta);
            await repo.update({ examen: { id: e.id } }, { figuras: null });
            let total = 0;
            for (const q of preguntas) {
                if (!q.figuras?.length) continue;
                await repo.update({ examen: { id: e.id }, numero: q.numero }, { figuras: q.figuras });
                total += q.figuras.length;
            }
            const destino = dirFigurasExamen(e.anio, e.archivoBase);
            await fs.rm(destino, { recursive: true, force: true });
            if (total > 0) await fs.cp(figurasTmp, destino, { recursive: true });
            console.log(`OK ${e.anio} ${e.curso}: ${total} figuras`);
        } catch (error) {
            console.error(`FALLÓ ${e.anio} ${e.curso}:`, (error as Error).message);
        } finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    }
    await AppDataSource.destroy();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
