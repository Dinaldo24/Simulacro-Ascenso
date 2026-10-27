import { setupAuthentication, type AuthenticatedUser } from "./auth.js";
import { setupCoverEditor } from "./cover-editor.js";
import { setupRepository, type RepositoryDocument } from "./repository.js";
import { setupSimulation } from "./simulation.js";

type ModuleName = "repositorio" | "simulacion";

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
    return isRecord(payload) && typeof payload.message === "string" && payload.message
        ? payload.message
        : fallback;
}

function isModuleName(value: string | undefined): value is ModuleName {
    return value === "repositorio" || value === "simulacion";
}

const accountName = requireElement<HTMLElement>("#account-name");
const accountRole = requireElement<HTMLElement>("#account-role");
const accountAvatar = requireElement<HTMLElement>("#account-avatar");
const dashboardTitle = requireElement<HTMLElement>("#dashboard-title");
const dashboardDescription = requireElement<HTMLElement>("#dashboard-description");
const repositoryPanel = requireElement<HTMLElement>("#repository-panel");
const simulationPanel = requireElement<HTMLElement>("#simulation-panel");
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
    simulacion: {
        title: "Simulación",
        description: "Consulta los documentos PDF por año y curso."
    }
};

const roleNames: Record<string, string> = {
    administrador: "Administrador",
    director: "Director",
    profesor: "Profesor"
};

let canManageRepository = false;
const simulation = setupSimulation();
const repository = setupRepository({
    onPreview: openPdfPreview,
    onChangeCover: (item) => coverEditor.open(item),
    onRename: renameDocument,
    onDelete: deleteDocument,
    onCanManageChange: (canManage) => {
        canManageRepository = canManage;
        uploadToggle.hidden = !canManage;
    },
    onError: (message) => showRepositoryMessage(message, "error")
});
const coverEditor = setupCoverEditor({
    onSaved: (message) => {
        showRepositoryMessage(message, "success");
        void repository.loadDocuments();
    },
    onError: (message) => showRepositoryMessage(message, "error")
});

function showAuthenticatedUser(user: AuthenticatedUser): void {
    const fullName = `${user.nombres} ${user.apellidos}`.trim();

    accountName.textContent = fullName || user.username;
    accountRole.textContent = roleNames[user.role] || "Usuario";
    accountAvatar.textContent = (user.nombres || user.username).charAt(0).toLocaleUpperCase("es");
    canManageRepository = ["administrador", "director"].includes(user.role);
    uploadToggle.hidden = !canManageRepository;
    document.title = "Menú principal | Juan Pablo Vizcardo y Guzmán";
    selectModule("repositorio");
}

function selectModule(moduleName: ModuleName): void {
    const module = modules[moduleName];
    dashboardTitle.textContent = module.title;
    dashboardDescription.textContent = module.description;
    repositoryPanel.hidden = moduleName !== "repositorio";
    simulationPanel.hidden = moduleName !== "simulacion";

    if (moduleName === "repositorio") {
        void repository.loadDocuments();
    } else {
        simulation.loadDocuments();
    }

    document.querySelectorAll<HTMLElement>("[data-module]").forEach((button) => {
        const isSelected = button.dataset.module === moduleName;

        button.classList.toggle("is-active", isSelected && button.classList.contains("module-link"));
        button.classList.toggle("is-selected", isSelected && button.classList.contains("module-card"));

        if (button.classList.contains("module-link")) {
            if (isSelected) {
                button.setAttribute("aria-current", "page");
            } else {
                button.removeAttribute("aria-current");
            }
        }
    });
}

function showRepositoryMessage(message: string, type = ""): void {
    repositoryMessage.textContent = message;
    repositoryMessage.className =
        `repository-message${type ? ` repository-message--${type}` : ""}`;
    repositoryMessage.hidden = false;
}

function clearRepositoryMessage(): void {
    repositoryMessage.textContent = "";
    repositoryMessage.className = "repository-message";
    repositoryMessage.hidden = true;
}

function openPdfPreview(item: RepositoryDocument): void {
    pdfPreviewTitle.textContent = item.titulo;
    pdfPreviewFrame.src =
        `/api/documentos/${encodeURIComponent(item.id_documento)}/vista-previa`;
    pdfPreviewDialog.showModal();
}

async function deleteDocument(item: RepositoryDocument, button: HTMLButtonElement): Promise<void> {
    const confirmed = window.confirm(`¿Eliminar "${item.titulo}" del repositorio?`);

    if (!confirmed) {
        return;
    }

    clearRepositoryMessage();
    button.disabled = true;

    try {
        const response = await fetch(`/api/documentos/${encodeURIComponent(item.id_documento)}`, {
            method: "DELETE"
        });

        if (!response.ok) {
            const payload: unknown = await response.json();
            throw new Error(getResponseMessage(payload, "No se pudo eliminar el PDF."));
        }

        showRepositoryMessage("El PDF se eliminó del repositorio.", "success");
        await repository.loadDocuments();
    } catch (error) {
        showRepositoryMessage(getErrorMessage(error), "error");
        button.disabled = false;
    }
}

async function renameDocument(item: RepositoryDocument): Promise<void> {
    const requestedName = window.prompt(
        "Escribe el nuevo nombre del PDF (sin la extensión .pdf):",
        item.titulo
    );

    if (requestedName === null) {
        return;
    }

    const name = requestedName.trim().replace(/\.pdf$/i, "").trim();

    if (!name || name.length > 150 || /[\\/\u0000-\u001f\u007f]/.test(name)) {
        showRepositoryMessage(
            "Escribe un nombre válido de entre 1 y 150 caracteres, sin extensión ni separadores.",
            "error"
        );
        return;
    }

    clearRepositoryMessage();

    try {
        const response = await fetch(`/api/documentos/${encodeURIComponent(item.id_documento)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre: name })
        });
        const payload: unknown = await response.json();

        if (!response.ok) {
            throw new Error(getResponseMessage(payload, "No se pudo cambiar el nombre del PDF."));
        }

        showRepositoryMessage("Se cambió el nombre del PDF.", "success");
        await repository.loadDocuments();
    } catch (error) {
        showRepositoryMessage(getErrorMessage(error), "error");
    }
}

pdfPreviewClose.addEventListener("click", () => pdfPreviewDialog.close());
pdfPreviewDialog.addEventListener("close", () => {
    pdfPreviewFrame.src = "about:blank";
});

uploadToggle.addEventListener("click", () => {
    uploadForm.hidden = false;
    uploadToggle.hidden = true;
    documentTitleInput.focus();
});

uploadCancel.addEventListener("click", () => {
    uploadForm.reset();
    uploadForm.hidden = true;
    uploadToggle.hidden = !canManageRepository;
    clearRepositoryMessage();
});

uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearRepositoryMessage();

    const file = documentFileInput.files?.[0];

    if (!file) {
        showRepositoryMessage("Selecciona un archivo PDF.", "error");
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
        const response = await fetch("/api/documentos", {
            method: "POST",
            body: formData
        });
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
    onAuthenticated: showAuthenticatedUser,
    onLogout: () => {
        uploadForm.reset();
        uploadForm.hidden = true;
        uploadToggle.hidden = true;
        simulation.reset();
        canManageRepository = false;
        clearRepositoryMessage();
    }
});
