import { Router } from "express";
import { asyncHandler } from "../../../middlewares/asyncHandler";
import { requerirAdminODirector } from "../../../middlewares/authMiddleware";
import {
    actualizarExamenController,
    buscarExamenController,
    crearExamenController,
    eliminarExamenController,
    listarExamenesController,
} from "../controllers/ExamenController";

const examenRoutes = Router();

examenRoutes.post("/", requerirAdminODirector, asyncHandler(crearExamenController));
examenRoutes.get("/", asyncHandler(listarExamenesController));
examenRoutes.get("/:id", asyncHandler(buscarExamenController));
examenRoutes.put("/:id", requerirAdminODirector, asyncHandler(actualizarExamenController));
examenRoutes.delete("/:id", requerirAdminODirector, asyncHandler(eliminarExamenController));

export default examenRoutes;
