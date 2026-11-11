import { Router } from "express";
import { asyncHandler } from "../../../middlewares/asyncHandler";
import { requerirAdminODirector } from "../../../middlewares/authMiddleware";
import {
    crearEspecialidadController,
    eliminarEspecialidadController,
    listarEspecialidadesController,
} from "../controllers/EspecialidadController";

const especialidadRoutes = Router();

especialidadRoutes.get("/", asyncHandler(listarEspecialidadesController));
especialidadRoutes.post("/", requerirAdminODirector, asyncHandler(crearEspecialidadController));
especialidadRoutes.delete("/:id", requerirAdminODirector, asyncHandler(eliminarEspecialidadController));

export default especialidadRoutes;
