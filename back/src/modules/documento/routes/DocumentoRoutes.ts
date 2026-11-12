import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../../middlewares/asyncHandler";
import { requerirAdminODirector } from "../../../middlewares/authMiddleware";
import { MAX_PDF_BYTES } from "../../../utils/storage";
import {
    actualizarDocumentoController,
    descargarDocumentoController,
    eliminarDocumentoController,
    listarDocumentosController,
    subirDocumentoController,
    verDocumentoController,
} from "../controllers/DocumentoController";

const documentoRoutes = Router();

const cargarDocumentos = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PDF_BYTES, files: 2 },
}).fields([
    { name: "pdfPreguntas", maxCount: 1 },
    { name: "pdfRespuestas", maxCount: 1 },
    { name: "pdf", maxCount: 1 },
]);

// Todo el módulo de Repositorio de documentos: SOLO Administrador o Director
documentoRoutes.use(requerirAdminODirector);

documentoRoutes.post("/", cargarDocumentos, asyncHandler(subirDocumentoController));
documentoRoutes.patch("/:id", cargarDocumentos, asyncHandler(actualizarDocumentoController));
documentoRoutes.delete("/:id", asyncHandler(eliminarDocumentoController));
documentoRoutes.get("/", asyncHandler(listarDocumentosController));
documentoRoutes.get("/:id", asyncHandler(descargarDocumentoController));
documentoRoutes.get("/:id/descargar", asyncHandler(descargarDocumentoController));
documentoRoutes.get("/:id/vista-previa", asyncHandler(verDocumentoController));

export default documentoRoutes;
