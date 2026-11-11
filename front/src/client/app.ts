import { setupAuthentication, type AuthenticatedUser } from "./auth.js";
import { setupCoverEditor } from "./cover-editor.js";
import { setupRepository, type RepositoryDocument } from "./repository.js";
import { setupSimulation } from "./simulation.js";
import { setupExamenes } from "./examenes.js";
import { setupUsuarios } from "./usuarios.js";
import { BACKEND_URL, authorizedFetch, fetchBlobUrl } from "./session.js";

type ModuleName = "repositorio" | "examenes" | "simulacion" | "usuarios";

interface AppModule {
    title: string;
    description: string;
}

function requireElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);

    if (!element) {
        throw new Error(`No se encontró el elemento requerido: ${selector}`);
    }

    return element;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

function getResponseMessage(payload: unknown, fallback: string): string {
    if (isRecord(payload)) {
        if (typeof payload.mensaje === "string" && payload.mensaje) return payload.mensaje;
        if (typeof payload.message === "string" && payload.message) return payload.message;
    }
    return fallback;
}

function isModuleName(value: string | undefined): value is ModuleName {
    return value === "repositorio" || value === "examenes" || value === "simulacion" || value === "usuarios";
}

const accountName = requireElement<HTMLElement>("#account-name");
const accountRole = requireElement<HTMLElement>("#account-role");
const accountAvatar = requireElement<HTMLElement>("#account-avatar");
const dashboardTitle = requireElement<HTMLElement>("#dashboard-title");
const dashboardDescription = requireElement<HTMLElement>("#dashboard-description");
const repositoryPanel = requireElement<HTMLElement>("#repository-panel");
const examenesPanel = requireElement<HTMLElement>("#examenes-panel");
const simulationPanel = requireElement<HTMLElement>("#simulation-panel");
const usuariosPanel = requireElement<HTMLElement>("#usuarios-panel");
const moduleBtnRepositorio = document.querySelector<HTMLElement>("#module-btn-repositorio");
const moduleBtnUsuarios = document.querySelector<HTMLElement>("#module-btn-usuarios");
const uploadToggle = requireElement<HTMLButtonElement>("#upload-toggle");
const uploadForm = requireElement<HTMLFormElement>("#upload-form");
const uploadCancel = requireElement<HTMLButtonElement>("#upload-cancel");
const uploadSubmit = requireElement<HTMLButtonElement>("#upload-submit");
const documentTitleInput = requireElement<HTMLInputElement>("#document-title");
const documentCourseInput = requireElement<HTMLInputElement>("#document-course");
const documentYearInput = requireElement<HTMLInputElement>("#document-year");
const documentFileInput = requireElement<HTMLInputElement>("#document-file");
const repositoryMessage = requireElement<HTMLElement>("#repository-message");
const pdfPreviewDialog = requireElement<HTMLDialogElement>("#pdf-preview-dialog");
const pdfPreviewTitle = requireElement<HTMLElement>("#pdf-preview-title");
const pdfPreviewFrame = requireElement<HTMLIFrameElement>("#pdf-preview-frame");
const pdfPreviewClose = requireElement<HTMLButtonElement>("#pdf-preview-close");
const currentYear = requireElement<HTMLElement>("#current-year");

currentYear.textContent = String(new Date().getFullYear());

const modules: Record<ModuleName, AppModule> = {
    repositorio: {
        title: "Repositorio",
        description: "Consulta y organiza los recursos educativos del colegio."
    },
    examenes: {
        title: "Exámenes",
        description: "Simulador interactivo de exámenes MINEDU con retroalimentación inmediata."
    },
    simulacion: {
        title: "Simulación y Materiales",
        description: "Consulta y descarga de cuadernillos oficiales de preguntas y respuestas en PDF."
    },
    usuarios: {
        title: "Gestión de Usuarios",
        description: "Administra el acceso de docentes y alumnos a la plataforma educativa."
    }
};

const roleNames: Record<string, string> = {
    administrador: "Administrador",
    director: "Director",
    profesor: "Docente / Profesor",
    alumno: "Estudiante / Alumno"
};

let canManageRepository = true;
let currentUserEsGestor = false;
const examenes = setupExamenes();
const simulation = setupSimulation();
const usuarios = setupUsuarios();
const repository = setupRepository({
    onPreview: openPdfPreview,
    onChangeCover: (item: RepositoryDocument) => coverEditor.open(item),
    onRename: renameDocument,
    onDelete: deleteDocument,
    onCanManageChange: (canManage: boolean) => {
        canManageRepository = canManage;
        uploadToggle.hidden = !canManage;
    },
    onError: (message: string) => showRepositoryMessage(message, "error")
});
const coverEditor = setupCoverEditor({
    onSaved: (message: string) => {
        showRepositoryMessage(message, "success");
        void repository.loadDocuments();
    },
    onError: (message: string) => showRepositoryMessage(message, "error")
});

function getInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);

    if (parts.length === 0) {
        return "U";
    }

    if (parts.length === 1) {
        return parts[0].slice(0, 2).toUpperCase();
    }

    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function showAuthenticatedUser(user: AuthenticatedUser): void {
    const fullName = `${user.nombres} ${user.apellidos}`.trim() || user.username;
    accountName.textContent = fullName;
    accountRole.textContent = roleNames[user.role] || user.role;
    accountAvatar.textContent = getInitials(fullName);
    document.title = "Menú principal | Juan Pablo Vizcardo y Guzmán";

    const esGestor = user.role === "administrador" || user.role === "director";
    currentUserEsGestor = esGestor;

    // 1. Mostrar los módulos de Repositorio y Usuarios solo a Administrador o Director
    if (moduleBtnRepositorio) {
        moduleBtnRepositorio.hidden = !esGestor;
    }
    if (moduleBtnUsuarios) {
        moduleBtnUsuarios.hidden = !esGestor;
    }

    // 2. Ocultar subida de PDFs en Repositorio para Docentes y Alumnos
    if (uploadToggle) {
        uploadToggle.hidden = !esGestor;
    }
    if (uploadForm && !esGestor) {
        uploadForm.hidden = true;
    }

    // 3. Ocultar subida y eliminación de exámenes para Docentes y Alumnos
    const btnToggleSubirExamen = document.querySelector<HTMLElement>("#btn-toggle-subir-examen");
    if (btnToggleSubirExamen) btnToggleSubirExamen.hidden = !esGestor;
    const formSubirExamen = document.querySelector<HTMLElement>("#form-subir-examen");
    if (formSubirExamen && !esGestor) formSubirExamen.hidden = true;
    const btnEliminarExamen = document.querySelector<HTMLElement>("#examenes-btn-eliminar");
    if (btnEliminarExamen && !esGestor) btnEliminarExamen.hidden = true;

    selectModule(esGestor ? "repositorio" : "examenes");
}

function selectModule(moduleName: ModuleName): void {
    if (!currentUserEsGestor && (moduleName === "repositorio" || moduleName === "usuarios")) {
        moduleName = "examenes";
    }
    document.querySelectorAll<HTMLElement>("[data-module]").forEach((button) => {
        const isActive = button.dataset.module === moduleName;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-current", isActive ? "page" : "false");
    });

    const currentModule = modules[moduleName];
    dashboardTitle.textContent = currentModule.title;
    dashboardDescription.textContent = currentModule.description;
    repositoryPanel.hidden = moduleName !== "repositorio";
    examenesPanel.hidden = moduleName !== "examenes";
    simulationPanel.hidden = moduleName !== "simulacion";
    usuariosPanel.hidden = moduleName !== "usuarios";

    if (moduleName === "repositorio") {
        void repository.loadDocuments();
    } else if (moduleName === "examenes") {
        void examenes.loadExamenes();
    } else if (moduleName === "simulacion") {
        void simulation.loadDocuments();
    } else if (moduleName === "usuarios") {
        void usuarios.loadUsuarios();
    }
}

function showRepositoryMessage(message: string, type: "error" | "success"): void {
    repositoryMessage.textContent = message;
    repositoryMessage.className = `repository-alert repository-alert--${type}`;
    repositoryMessage.hidden = false;
}

function clearRepositoryMessage(): void {
    repositoryMessage.textContent = "";
    repositoryMessage.className = "repository-alert";
    repositoryMessage.hidden = true;
}

let pdfPreviewBlobUrl: string | null = null;

function revokePdfPreviewBlob(): void {
    if (pdfPreviewBlobUrl) {
        URL.revokeObjectURL(pdfPreviewBlobUrl);
        pdfPreviewBlobUrl = null;
    }
}

async function openPdfPreview(item: RepositoryDocument): Promise<void> {
    try {
        const blobUrl = await fetchBlobUrl(
            `${BACKEND_URL}/documentos/${encodeURIComponent(item.id_documento)}/vista-previa`,
        );
        revokePdfPreviewBlob();
        pdfPreviewBlobUrl = blobUrl;
        pdfPreviewTitle.textContent = item.titulo;
        pdfPreviewFrame.src = blobUrl;
        pdfPreviewDialog.showModal();
    } catch (error) {
        showRepositoryMessage(
            error instanceof Error ? error.message : "No se pudo abrir la vista previa.",
            "error",
        );
    }
}

function closePdfPreview(): void {
    pdfPreviewDialog.close();
    pdfPreviewFrame.src = "about:blank";
    revokePdfPreviewBlob();
}

async function renameDocument(item: RepositoryDocument): Promise<void> {
    const nextTitle = window.prompt("Escribe el nuevo título para este PDF:", item.titulo);

    if (nextTitle === null) {
        return;
    }

    const trimmedTitle = nextTitle.trim();

    if (!trimmedTitle || trimmedTitle === item.titulo) {
        return;
    }

    if (trimmedTitle.length > 150) {
        showRepositoryMessage("El título no puede superar los 150 caracteres.", "error");
        return;
    }

    try {
        const response = await authorizedFetch(`${BACKEND_URL}/documentos/${encodeURIComponent(item.id_documento)}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ titulo: trimmedTitle })
        });
        if (response.status === 401) return;
        const payload: unknown = await response.json();

        if (!response.ok) {
            throw new Error(getResponseMessage(payload, "No se pudo cambiar el nombre del documento."));
        }

        showRepositoryMessage("Se actualizó el nombre del PDF.", "success");
        await repository.loadDocuments();
    } catch (error) {
        showRepositoryMessage(getErrorMessage(error), "error");
    }
}

async function deleteDocument(item: RepositoryDocument, button: HTMLButtonElement): Promise<void> {
    const confirmation = window.confirm(`¿Seguro que deseas eliminar "${item.titulo}" del repositorio?`);

    if (!confirmation) {
        return;
    }

    button.disabled = true;

    try {
        const response = await authorizedFetch(`${BACKEND_URL}/documentos/${encodeURIComponent(item.id_documento)}`, {
            method: "DELETE"
        });
        if (response.status === 401) return;

        if (!response.ok) {
            const payload: unknown = await response.json().catch(() => null);
            throw new Error(getResponseMessage(payload, "No se pudo eliminar el documento."));
        }

        showRepositoryMessage("El PDF se eliminó del repositorio.", "success");
        await repository.loadDocuments();
    } catch (error) {
        showRepositoryMessage(getErrorMessage(error), "error");
        button.disabled = false;
    }
}

uploadToggle.addEventListener("click", () => {
    const shouldOpen = uploadForm.hidden;
    uploadForm.hidden = !shouldOpen;
    uploadToggle.setAttribute("aria-expanded", String(shouldOpen));

    if (shouldOpen) {
        clearRepositoryMessage();
        documentTitleInput.focus();
    }
});

uploadCancel.addEventListener("click", () => {
    uploadForm.reset();
    uploadForm.hidden = true;
    uploadToggle.setAttribute("aria-expanded", "false");
    clearRepositoryMessage();
});

pdfPreviewClose.addEventListener("click", closePdfPreview);
pdfPreviewDialog.addEventListener("click", (event) => {
    if (event.target === pdfPreviewDialog) {
        closePdfPreview();
    }
});

uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearRepositoryMessage();

    const file = documentFileInput.files?.[0];

    if (!file) {
        showRepositoryMessage("Selecciona un archivo PDF para subir.", "error");
        return;
    }

    if (!file.name.toLowerCase().endsWith(".pdf") || file.type !== "application/pdf") {
        showRepositoryMessage("El archivo seleccionado debe ser un PDF.", "error");
        return;
    }

    if (file.size > 25 * 1024 * 1024) {
        showRepositoryMessage("El PDF no puede superar los 25 MB.", "error");
        return;
    }

    const formData = new FormData();
    formData.append("titulo", documentTitleInput.value.trim());
    formData.append("curso", documentCourseInput.value.trim());
    formData.append("anio", documentYearInput.value.trim());
    formData.append("pdf", file);
    uploadSubmit.disabled = true;
    uploadSubmit.textContent = "Subiendo...";

    try {
        const response = await authorizedFetch(`${BACKEND_URL}/documentos`, {
            method: "POST",
            body: formData
        });
        if (response.status === 401) return;
        const payload: unknown = await response.json();

        if (!response.ok) {
            throw new Error(getResponseMessage(payload, "No se pudo subir el PDF."));
        }

        uploadForm.reset();
        uploadForm.hidden = true;
        uploadToggle.hidden = !canManageRepository;
        showRepositoryMessage("El PDF se agregó al repositorio.", "success");
        await repository.loadDocuments();
    } catch (error) {
        showRepositoryMessage(getErrorMessage(error), "error");
    } finally {
        uploadSubmit.disabled = false;
        uploadSubmit.textContent = "Guardar PDF";
    }
});

document.querySelectorAll<HTMLElement>("[data-module]").forEach((button) => {
    button.addEventListener("click", () => {
        const moduleName = button.dataset.module;

        if (isModuleName(moduleName)) {
            selectModule(moduleName);
        }
    });
});

setupAuthentication({
    onAuthenticated: (u: AuthenticatedUser) => {
        showAuthenticatedUser(u);
    },
    onLogout: () => {
        currentUserEsGestor = false;
        if (moduleBtnRepositorio) moduleBtnRepositorio.hidden = true;
        if (moduleBtnUsuarios) moduleBtnUsuarios.hidden = true;
        repositoryPanel.hidden = true;
        uploadForm.reset();
        uploadForm.hidden = true;
        uploadToggle.hidden = true;
        simulation.reset();
        examenes.reset();
        canManageRepository = false;
        clearRepositoryMessage();
    }
});
