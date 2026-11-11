import cors from "cors";
import express, { Express } from "express";
import { env } from "./config/env";
import { errorHandler } from "./middlewares/errorHandler";
import rootRouter from "./routes";

export function createApp(): Express {
    const app = express();

    app.use(
        cors({
            origin: env.corsOrigins,
            methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization"],
        }),
    );

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.get("/", (_req, res) => {
        res.send(`Servidor Express funcionando en el puerto ${env.port}`);
    });

    app.use(rootRouter);
    app.use(errorHandler);

    return app;
}
