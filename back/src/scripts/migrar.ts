import fs from "fs";
import path from "path";
import { AppDataSource } from "../database/data-source";

/** Aplica una migración .sql (sentencias separadas por ';'): npx tsx src/scripts/migrar.ts 001_examenes_en_bd.sql */
async function main(): Promise<void> {
    const archivo = process.argv[2];
    if (!archivo) throw new Error("Indica el archivo de migración.");
    const ruta = path.resolve(__dirname, "..", "..", "database", "migrations", path.basename(archivo));
    const sql = fs
        .readFileSync(ruta, "utf-8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n");
    await AppDataSource.initialize();
    for (const sentencia of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
        if (/^USE\s/i.test(sentencia)) continue;
        await AppDataSource.query(sentencia);
        console.log("OK:", sentencia.split("\n")[0]);
    }
    await AppDataSource.destroy();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
