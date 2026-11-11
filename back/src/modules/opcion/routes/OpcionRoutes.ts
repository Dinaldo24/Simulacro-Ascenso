import { Router } from "express";
import { asyncHandler } from "../../../middlewares/asyncHandler";
import { requerirAdminODirector } from "../../../middlewares/authMiddleware";
import {
    actualizarOpcionController,
    buscarOpcionController,
    crearOpcionController,
    eliminarOpcionController,
    listarOpcionesController,
} from "../controllers/OpcionController";

const opcionRoutes = Router();

opcionRoutes.post("/", requerirAdminODirector, asyncHandler(crearOpcionController));
opcionRoutes.get("/", asyncHandler(listarOpcionesController));
opcionRoutes.get("/:id", asyncHandler(buscarOpcionController));
opcionRoutes.put("/:id", requerirAdminODirector, asyncHandler(actualizarOpcionController));
opcionRoutes.delete("/:id", requerirAdminODirector, asyncHandler(eliminarOpcionController));

export default opcionRoutes;
