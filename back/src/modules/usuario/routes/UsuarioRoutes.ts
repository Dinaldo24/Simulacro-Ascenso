import { Router } from "express";
import { asyncHandler } from "../../../middlewares/asyncHandler";
import { autenticarToken, requerirAdminODirector } from "../../../middlewares/authMiddleware";
import {
    actualizarUsuarioController,
    alternarEstadoUsuarioController,
    crearUsuarioController,
    listarUsuariosController,
    loginUsuarioController,
    verificarSesionController,
} from "../controllers/UsuarioController";

const usuarioRoutes = Router();

// Login público y validación de sesión activa
usuarioRoutes.post("/login", asyncHandler(loginUsuarioController));
usuarioRoutes.get("/sesion", autenticarToken, asyncHandler(verificarSesionController));

// Rutas de administración de usuarios (Protegidas: Administrador y Director)
usuarioRoutes.get(
    "/",
    autenticarToken,
    requerirAdminODirector,
    asyncHandler(listarUsuariosController),
);
usuarioRoutes.post(
    "/",
    autenticarToken,
    requerirAdminODirector,
    asyncHandler(crearUsuarioController),
);
usuarioRoutes.patch(
    "/:id",
    autenticarToken,
    requerirAdminODirector,
    asyncHandler(actualizarUsuarioController),
);
usuarioRoutes.patch(
    "/:id/estado",
    autenticarToken,
    requerirAdminODirector,
    asyncHandler(alternarEstadoUsuarioController),
);

export default usuarioRoutes;
