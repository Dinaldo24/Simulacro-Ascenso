import { Router } from "express";
import { asyncHandler } from "../../../middlewares/asyncHandler";
import { requerirAdminODirector } from "../../../middlewares/authMiddleware";
import {
    actualizarPreguntaController,
    buscarPreguntaController,
    crearPreguntaController,
    eliminarPreguntaController,
    listarPreguntasController,
} from "../controllers/PreguntaController";

const preguntaRoutes = Router();

preguntaRoutes.post("/", requerirAdminODirector, asyncHandler(crearPreguntaController));
preguntaRoutes.get("/", asyncHandler(listarPreguntasController));
preguntaRoutes.get("/:id", asyncHandler(buscarPreguntaController));
preguntaRoutes.put("/:id", requerirAdminODirector, asyncHandler(actualizarPreguntaController));
preguntaRoutes.delete("/:id", requerirAdminODirector, asyncHandler(eliminarPreguntaController));

export default preguntaRoutes;
