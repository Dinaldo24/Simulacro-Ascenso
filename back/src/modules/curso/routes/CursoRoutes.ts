import { Router } from "express";
import { asyncHandler } from "../../../middlewares/asyncHandler";
import { requerirAdminODirector } from "../../../middlewares/authMiddleware";
import {
    actualizarCursoController,
    buscarCursoController,
    crearCursoController,
    eliminarCursoController,
    listarCursosController,
} from "../controllers/CursoController";

const cursoRoutes = Router();

cursoRoutes.post("/", requerirAdminODirector, asyncHandler(crearCursoController));
cursoRoutes.get("/", asyncHandler(listarCursosController));
cursoRoutes.get("/:id", asyncHandler(buscarCursoController));
cursoRoutes.put("/:id", requerirAdminODirector, asyncHandler(actualizarCursoController));
cursoRoutes.delete("/:id", requerirAdminODirector, asyncHandler(eliminarCursoController));

export default cursoRoutes;
