import { Router } from "express";
import { checkDatabaseHealth } from "../database/data-source";
import { asyncHandler } from "../middlewares/asyncHandler";
import { autenticarToken } from "../middlewares/authMiddleware";
import anioRoutes from "../modules/anio/routes/AnioRoutes";
import cursoRoutes from "../modules/curso/routes/CursoRoutes";
import documentoRoutes from "../modules/documento/routes/DocumentoRoutes";
import especialidadRoutes from "../modules/especialidad/routes/EspecialidadRoutes";
import examenRoutes from "../modules/examen/routes/ExamenRoutes";
import examenStorageRoutes from "../modules/examen/routes/ExamenStorageRoutes";
import opcionRoutes from "../modules/opcion/routes/OpcionRoutes";
import preguntaRoutes from "../modules/pregunta/routes/PreguntaRoutes";
import usuarioRoutes from "../modules/usuario/routes/UsuarioRoutes";

const rootRouter = Router();

rootRouter.get(
    "/health",
    asyncHandler(async (_req, res) => {
        const dbOk = await checkDatabaseHealth();
        if (!dbOk) {
            res.status(503).json({ status: "error", database: "disconnected" });
            return;
        }
        res.json({
            status: "ok",
            database: "connected",
            uptime: Math.floor(process.uptime()),
        });
    }),
);

rootRouter.use("/usuarios", usuarioRoutes);
rootRouter.use("/examenes-disponibles", autenticarToken, examenStorageRoutes);
rootRouter.use("/especialidades", autenticarToken, especialidadRoutes);
rootRouter.use("/anios", autenticarToken, anioRoutes);
rootRouter.use("/cursos", autenticarToken, cursoRoutes);
rootRouter.use("/examenes", autenticarToken, examenRoutes);
rootRouter.use("/preguntas", autenticarToken, preguntaRoutes);
rootRouter.use("/opciones", autenticarToken, opcionRoutes);
rootRouter.use("/documentos", autenticarToken, documentoRoutes);

export default rootRouter;
