import { Router } from "express";
import { asyncHandler } from "../../../middlewares/asyncHandler";
import { requerirAdminODirector } from "../../../middlewares/authMiddleware";
import {
    actualizarAnioController,
    buscarAnioController,
    crearAnioController,
    eliminarAnioController,
    listarAniosController,
} from "../controllers/AnioController";

const anioRoutes = Router();

anioRoutes.post("/", requerirAdminODirector, asyncHandler(crearAnioController));
anioRoutes.get("/", asyncHandler(listarAniosController));
anioRoutes.get("/:id", asyncHandler(buscarAnioController));
anioRoutes.put("/:id", requerirAdminODirector, asyncHandler(actualizarAnioController));
anioRoutes.delete("/:id", requerirAdminODirector, asyncHandler(eliminarAnioController));

export default anioRoutes;
