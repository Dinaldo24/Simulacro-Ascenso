import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../../middlewares/asyncHandler";
import { requerirAdminODirector } from "../../../middlewares/authMiddleware";
import {
    descargarDocumentoController,
    eliminarDocumentoController,
    listarDocumentosController,
    renombrarDocumentoController,
    subirDocumentoController,
    verDocumentoController,
} from "../controllers/DocumentoController";

const documentoRoutes = Router();

const cargarPdf = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
    fileFilter: (_req, archivo, callback) => {
        const esPdf =
            archivo.mimetype === "application/pdf" &&
            archivo.originalname.toLowerCase().endsWith(".pdf");
        callback(null, esPdf);
    },
});

// Todo el módulo de Repositorio de documentos: SOLO Administrador o Director
documentoRoutes.use(requerirAdminODirector);

documentoRoutes.post("/", cargarPdf.single("pdf"), asyncHandler(subirDocumentoController));
documentoRoutes.patch("/:id", asyncHandler(renombrarDocumentoController));
documentoRoutes.delete("/:id", asyncHandler(eliminarDocumentoController));
documentoRoutes.get("/", asyncHandler(listarDocumentosController));
documentoRoutes.get("/:id", asyncHandler(descargarDocumentoController));
documentoRoutes.get("/:id/descargar", asyncHandler(descargarDocumentoController));
documentoRoutes.get("/:id/vista-previa", asyncHandler(verDocumentoController));

export default documentoRoutes;
