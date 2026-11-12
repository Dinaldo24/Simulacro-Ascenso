import fs from "fs/promises";
import { env } from "../config/env";
import { AppDataSource } from "../database/data-source";
import { actualizarDocumento, buscarDocumentosDeExamen } from "../modules/documento/services/DocumentoService";
import { Examen } from "../modules/examen/entities/Examen";
import { esBufferPdf, resolverRutaSegura } from "../utils/storage";

/**
 * Adjunta los PDFs *_Respuestas.pdf existentes en storage/examenes/ a las filas de
 * documentos que aún tienen respuestasNombreArchivo en NULL. Es idempotente.
 * Uso: npx tsx src/scripts/backfill-documentos-respuestas.ts
 */
async function main(): Promise<void> {
    await AppDataSource.initialize();
    let actualizados = 0;
    let yaSincronizados = 0;
    let sinArchivo = 0;
    let sinDocumento = 0;

    try {
        const examenes = await AppDataSource.getRepository(Examen).find({
            order: { anio: "ASC", curso: "ASC" },
        });

        for (const examen of examenes) {
            if (!examen.anio || !examen.curso || !examen.archivoBase) continue;

            const nombreRespuestas = `${examen.archivoBase}_Respuestas.pdf`;
            const rutaRespuestas = resolverRutaSegura(
                env.storage.examenesDir,
                examen.anio,
                nombreRespuestas,
            );

            let contenido: Buffer;
            try {
                contenido = await fs.readFile(rutaRespuestas);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                    sinArchivo++;
                    console.log(`SALTADO (sin PDF): ${examen.anio} ${examen.curso}`);
                    continue;
                }
                throw error;
            }

            if (!esBufferPdf(contenido)) {
                sinArchivo++;
                console.warn(`SALTADO (PDF inválido): ${rutaRespuestas}`);
                continue;
            }

            const docs = await buscarDocumentosDeExamen({
                anio: examen.anio,
                curso: examen.curso,
                archivoBase: examen.archivoBase,
                titulo: examen.titulo,
            });
            if (docs.length === 0) {
                sinDocumento++;
                console.log(`SIN DOCUMENTO: ${examen.anio} ${examen.curso}`);
                continue;
            }

            const pendientes = docs.filter((d) => !d.respuestasNombreArchivo);
            if (pendientes.length === 0) {
                yaSincronizados++;
                console.log(`YA SINCRONIZADO: ${examen.anio} ${examen.curso}`);
                continue;
            }

            for (const doc of pendientes) {
                await actualizarDocumento(doc.id, {
                    pdfRespuestas: {
                        nombreOriginal: nombreRespuestas,
                        contenido,
                    },
                });
                actualizados++;
                console.log(`OK doc#${doc.id} (${examen.anio} ${examen.curso}): ${nombreRespuestas}`);
            }
        }

        console.log(
            `Resumen: ${actualizados} actualizados, ${yaSincronizados} ya sincronizados, ${sinArchivo} sin PDF válido, ${sinDocumento} sin documento.`,
        );
    } finally {
        if (AppDataSource.isInitialized) {
            await AppDataSource.destroy();
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
