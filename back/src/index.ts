import http from "http";
import { createApp } from "./app";
import { env, requireJwtSecret } from "./config/env";
import { closeDatabase, initializeDatabase } from "./database/data-source";

async function iniciarServidor(): Promise<void> {
    requireJwtSecret();
    await initializeDatabase();

    const app = createApp();
    const server: http.Server = app.listen(env.port, () => {
        console.log(`Servidor escuchando en http://localhost:${env.port}`);
    });

    let cerrando = false;
    const apagarServidor = (signal: string): void => {
        if (cerrando) return;
        cerrando = true;
        console.log(`Señal ${signal} recibida. Cerrando servidor HTTP y conexión MySQL...`);

        const forceExitTimer = setTimeout(() => {
            console.error("Cierre forzado por tiempo de espera agotado.");
            process.exit(1);
        }, 10000);
        forceExitTimer.unref();

        server.close(async (serverError) => {
            try {
                await closeDatabase();
                clearTimeout(forceExitTimer);
                if (serverError) {
                    console.error("Error al cerrar servidor HTTP:", serverError);
                    process.exit(1);
                }
                process.exit(0);
            } catch (dbError) {
                clearTimeout(forceExitTimer);
                console.error("Error al cerrar conexión MySQL:", dbError);
                process.exit(1);
            }
        });
    };

    process.on("SIGTERM", () => apagarServidor("SIGTERM"));
    process.on("SIGINT", () => apagarServidor("SIGINT"));
}

iniciarServidor().catch((error: unknown) => {
    console.error("No se pudo iniciar el servidor o conectar con MySQL:", error);
    process.exitCode = 1;
});
