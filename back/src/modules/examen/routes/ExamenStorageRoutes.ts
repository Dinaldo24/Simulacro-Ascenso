import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../../middlewares/asyncHandler";
import { requerirAdminODirector } from "../../../middlewares/authMiddleware";
import { MAX_PDF_BYTES } from "../../../utils/storage";
import {
    eliminarExamenStorageController,
    finalizarSimulacroController,
    listarExamenesDisponiblesController,
    listarHistorialController,
    obtenerFiguraExamenController,
    obtenerPdfExamenController,
    obtenerPreguntasExamenController,
    registrarHistorialController,
    verificarRespuestaController,
    subirExamenStorageController,
} from "../controllers/ExamenStorageController";

const examenStorageRoutes = Router();

const uploadExamen = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PDF_BYTES },
});

examenStorageRoutes.get("/", asyncHandler(listarExamenesDisponiblesController));
examenStorageRoutes.get("/historial", asyncHandler(listarHistorialController));
examenStorageRoutes.post("/historial", asyncHandler(registrarHistorialController));
examenStorageRoutes.post(
    "/subir",
    requerirAdminODirector,
    uploadExamen.fields([
        { name: "pdfPreguntas", maxCount: 1 },
        { name: "pdfRespuestas", maxCount: 1 },
    ]),
    asyncHandler(subirExamenStorageController),
);
examenStorageRoutes.get("/:anio/:curso/figuras/:archivo", asyncHandler(obtenerFiguraExamenController));
examenStorageRoutes.get("/:anio/:curso/pdf/:tipo", asyncHandler(obtenerPdfExamenController));
examenStorageRoutes.get("/:anio/:curso/preguntas", asyncHandler(obtenerPreguntasExamenController));
examenStorageRoutes.post(
    "/:anio/:curso/preguntas/:numero/verificar",
    asyncHandler(verificarRespuestaController),
);
examenStorageRoutes.post("/:anio/:curso/finalizar", asyncHandler(finalizarSimulacroController));
examenStorageRoutes.delete(
    "/:anio/:curso",
    requerirAdminODirector,
    asyncHandler(eliminarExamenStorageController),
);

export default examenStorageRoutes;
