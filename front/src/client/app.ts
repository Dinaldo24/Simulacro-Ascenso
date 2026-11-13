import { setupAuthentication, type AuthenticatedUser } from "./auth.js";
import { setupCoverEditor } from "./cover-editor.js";
import { fetchEspecialidades, type EspecialidadItem } from "./especialidades.js";
import { setupRepository, type PdfTipo, type RepositoryDocument } from "./repository.js";
import { setupSimulation } from "./simulation.js";
import { setupExamenes } from "./examenes.js";
import { setupUsuarios } from "./usuarios.js";
import { BACKEND_URL, authorizedFetch, fetchBlobUrl } from "./session.js";

type ModuleName = "repositorio" | "examenes" | "simulacion" | "usuarios";

interface AppModule {
    title: string;
    description: string;
}

interface SelectWithCustomField {
    select: HTMLSelectElement;
    customInput: HTMLInputElement;
}

const CUSTOM_OPTION_VALUE = "__otro__";

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

function setAlert(element: HTMLElement, message: string, type: "error" | "success"): void {
    element.textContent = message;
    element.className = `repository-alert repository-alert--${type}`;
    element.hidden = false;
}

function clearAlert(element: HTMLElement): void {
    element.textContent = "";
    element.className = "repository-alert";
    element.hidden = true;
}

function syncCustomInputVisibility(field: SelectWithCustomField): void {
    const isCustom = field.select.value === CUSTOM_OPTION_VALUE;
    field.customInput.hidden = !isCustom;
    field.customInput.required = isCustom;
    if (!isCustom) {
        field.customInput.value = "";
    }
}

function bindSelectWithCustomField(field: SelectWithCustomField): void {
    syncCustomInputVisibility(field);
    field.select.addEventListener("change", () => {
        syncCustomInputVisibility(field);
        if (field.select.value === CUSTOM_OPTION_VALUE) {
            field.customInput.focus();
        }
    });
}

function resolveSelectOrCustomValue(field: SelectWithCustomField): string {
    return field.select.value === CUSTOM_OPTION_VALUE
        ? field.customInput.value.trim()
        : field.select.value.trim();
}

function applySelectOrCustomValue(field: SelectWithCustomField, value: string | null | undefined): void {
    const trimmed = (value || "").trim();
    if (!trimmed) {
        field.select.value = "";
        syncCustomInputVisibility(field);
        return;
    }

    const matchingOption = Array.from(field.select.options).find(
        (opt) =>
            opt.value !== "" &&
            opt.value !== CUSTOM_OPTION_VALUE &&
            opt.value.trim().toLowerCase() === trimmed.toLowerCase(),
    );

    if (matchingOption) {
        field.select.value = matchingOption.value;
        syncCustomInputVisibility(field);
    } else {
        field.select.value = CUSTOM_OPTION_VALUE;
        syncCustomInputVisibility(field);
        field.customInput.value = trimmed;
    }
}

function populateCourseSelect(
    select: HTMLSelectElement,
    especialidades: EspecialidadItem[],
    preserveCurrent = true,
): void {
    const previousValue = preserveCurrent ? select.value : "";
    select.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Selecciona una especialidad";
    select.append(placeholder);

    for (const esp of especialidades) {
        const option = document.createElement("option");
        option.value = esp.nombre;
        option.textContent = esp.nombre;
        select.append(option);
    }

    const customOption = document.createElement("option");
    customOption.value = CUSTOM_OPTION_VALUE;
    customOption.textContent = "Otro curso / especialidad...";
    select.append(customOption);

    if (previousValue && Array.from(select.options).some((opt) => opt.value === previousValue)) {
        select.value = previousValue;
    } else {
        select.value = "";
    }
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
const repositoryMessage = requireElement<HTMLElement>("#repository-message");
const pdfPreviewDialog = requireElement<HTMLDialogElement>("#pdf-preview-dialog");
const pdfPreviewTitle = requireElement<HTMLElement>("#pdf-preview-title");
const pdfPreviewFrame = requireElement<HTMLIFrameElement>("#pdf-preview-frame");
const pdfPreviewClose = requireElement<HTMLButtonElement>("#pdf-preview-close");
const documentEditDialog = requireElement<HTMLDialogElement>("#document-edit-dialog");
const documentEditForm = requireElement<HTMLFormElement>("#document-edit-form");
const documentEditClose = requireElement<HTMLButtonElement>("#document-edit-close");
const documentEditCancel = requireElement<HTMLButtonElement>("#document-edit-cancel");
const documentEditSubmit = requireElement<HTMLButtonElement>("#document-edit-submit");
const documentEditAlert = requireElement<HTMLElement>("#document-edit-alert");
const editTitleInput = requireElement<HTMLInputElement>("#edit-document-title");
const editYearSelect = requireElement<HTMLSelectElement>("#edit-document-year-select");
const editYearInput = requireElement<HTMLInputElement>("#edit-document-year");
const editCourseSelect = requireElement<HTMLSelectElement>("#edit-document-course-select");
const editCourseInput = requireElement<HTMLInputElement>("#edit-document-course");
const currentYear = requireElement<HTMLElement>("#current-year");

const editYearField: SelectWithCustomField = { select: editYearSelect, customInput: editYearInput };
const editCourseField: SelectWithCustomField = { select: editCourseSelect, customInput: editCourseInput };

bindSelectWithCustomField(editYearField);
bindSelectWithCustomField(editCourseField);

currentYear.textContent = String(new Date().getFullYear());

const modules: Record<ModuleName, AppModule> = {
    repositorio: {
        title: "Repositorio",
        description: "Consulta y vista general de todos los recursos educativos del colegio."
    },
    examenes: {
        title: "Simulación",
        description: "Simulador interactivo de exámenes MINEDU con corrección al finalizar el intento."
    },
    simulacion: {
        title: "Materiales",
        description: "Sube exámenes en PDF para sincronizarlos o consulta y descarga los cuadernillos oficiales."
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
let especialidadesCache: EspecialidadItem[] = [];
let editingDocument: RepositoryDocument | null = null;
let editDialogOpenToken = 0;

const examenes = setupExamenes({
    onSyncChange: () => {
        void simulation.loadDocuments();
        if (currentUserEsGestor) {
            void repository.loadDocuments();
        }
    }
});
const simulation = setupSimulation({
    onSyncChange: (anio: string, curso: string) => {
        void examenes.loadExamenes(anio, curso);
        if (currentUserEsGestor) {
            void repository.loadDocuments();
        }
    }
});
const usuarios = setupUsuarios();
const repository = setupRepository({
    onPreview: openPdfPreview,
    onChangeCover: (item: RepositoryDocument) => coverEditor.open(item),
    onEdit: openEditDialog,
    onDelete: deleteDocument,
    onCanManageChange: (canManage: boolean) => {
        canManageRepository = canManage;
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

async function loadEspecialidadesForRepo(): Promise<EspecialidadItem[]> {
    try {
        especialidadesCache = await fetchEspecialidades();
    } catch {
        especialidadesCache = [];
    }
    return especialidadesCache;
}

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

    // 2. Ocultar subida y eliminación de exámenes para Docentes y Alumnos
    const btnToggleSubirExamen = document.querySelector<HTMLElement>("#btn-toggle-subir-examen");
    if (btnToggleSubirExamen) {
        btnToggleSubirExamen.hidden = !esGestor;
        if (!esGestor) btnToggleSubirExamen.setAttribute("aria-expanded", "false");
    }
    const formSubirExamen = document.querySelector<HTMLFormElement>("#form-subir-examen");
    if (formSubirExamen && !esGestor) {
        formSubirExamen.reset();
        formSubirExamen.hidden = true;
    }
    const btnEliminarExamen = document.querySelector<HTMLElement>("#examenes-btn-eliminar");
    if (btnEliminarExamen) btnEliminarExamen.hidden = !esGestor;

    if (esGestor) {
        void loadEspecialidadesForRepo();
    }

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
        if (currentUserEsGestor) {
            void loadEspecialidadesForRepo();
        }
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
    setAlert(repositoryMessage, message, type);
}

function clearRepositoryMessage(): void {
    clearAlert(repositoryMessage);
}

let pdfPreviewBlobUrl: string | null = null;
let pdfPreviewRequestId = 0;

function revokePdfPreviewBlob(): void {
    if (pdfPreviewBlobUrl) {
        URL.revokeObjectURL(pdfPreviewBlobUrl);
        pdfPreviewBlobUrl = null;
    }
}

function clearPdfPreviewState(): void {
    pdfPreviewRequestId += 1;
    pdfPreviewFrame.src = "about:blank";
    revokePdfPreviewBlob();
}

async function openPdfPreview(item: RepositoryDocument, tipo: PdfTipo = "preguntas"): Promise<void> {
    const requestId = ++pdfPreviewRequestId;
    const tipoLabel = tipo === "respuestas" ? "Hoja de Respuestas" : "Cuadernillo de Preguntas";

    try {
        const blobUrl = await fetchBlobUrl(
            `${BACKEND_URL}/documentos/${encodeURIComponent(item.id_documento)}/vista-previa?tipo=${tipo}`,
        );
        if (requestId !== pdfPreviewRequestId) {
            URL.revokeObjectURL(blobUrl);
            return;
        }
        revokePdfPreviewBlob();
        pdfPreviewBlobUrl = blobUrl;
        pdfPreviewTitle.textContent = `${item.titulo} — ${tipoLabel}`;
        pdfPreviewFrame.src = blobUrl;
        if (!pdfPreviewDialog.open) {
            pdfPreviewDialog.showModal();
        }
    } catch (error) {
        if (requestId === pdfPreviewRequestId) {
            showRepositoryMessage(
                error instanceof Error ? error.message : "No se pudo abrir la vista previa.",
                "error",
            );
        }
    }
}

function closePdfPreview(): void {
    if (pdfPreviewDialog.open) {
        pdfPreviewDialog.close();
    } else {
        clearPdfPreviewState();
    }
}

async function openEditDialog(item: RepositoryDocument): Promise<void> {
    const token = ++editDialogOpenToken;
    const especialidades = await loadEspecialidadesForRepo();
    if (token !== editDialogOpenToken) {
        return;
    }

    editingDocument = item;
    clearAlert(documentEditAlert);
    documentEditForm.reset();

    editTitleInput.value = item.titulo;
    populateCourseSelect(editCourseSelect, especialidades, false);
    applySelectOrCustomValue(editYearField, item.anio);
    applySelectOrCustomValue(editCourseField, item.curso);

    if (!documentEditDialog.open) {
        documentEditDialog.showModal();
    }
    editTitleInput.focus();
}

function syncMaterialsAndExams(): void {
    void simulation.loadDocuments();
    void examenes.loadExamenes();
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
        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok) {
            throw new Error(getResponseMessage(payload, "No se pudo eliminar el documento."));
        }

        showRepositoryMessage(getResponseMessage(payload, "El documento se eliminó del repositorio."), "success");
        await repository.loadDocuments();
        syncMaterialsAndExams();
    } catch (error) {
        showRepositoryMessage(getErrorMessage(error), "error");
        button.disabled = false;
    }
}

pdfPreviewClose.addEventListener("click", closePdfPreview);
pdfPreviewDialog.addEventListener("click", (event) => {
    if (event.target === pdfPreviewDialog) {
        closePdfPreview();
    }
});
pdfPreviewDialog.addEventListener("close", clearPdfPreviewState);

documentEditClose.addEventListener("click", () => documentEditDialog.close());
documentEditCancel.addEventListener("click", () => documentEditDialog.close());
documentEditDialog.addEventListener("click", (event) => {
    if (event.target === documentEditDialog) {
        documentEditDialog.close();
    }
});
documentEditDialog.addEventListener("close", () => {
    editingDocument = null;
    documentEditForm.reset();
    syncCustomInputVisibility(editYearField);
    syncCustomInputVisibility(editCourseField);
    clearAlert(documentEditAlert);
});

documentEditForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!editingDocument) return;
    clearAlert(documentEditAlert);

    const titulo = editTitleInput.value.trim();
    const anio = resolveSelectOrCustomValue(editYearField);
    const curso = resolveSelectOrCustomValue(editCourseField);

    if (!titulo) {
        setAlert(documentEditAlert, "El título del documento es obligatorio.", "error");
        editTitleInput.focus();
        return;
    }
    if (titulo.length > 150) {
        setAlert(documentEditAlert, "El título no puede superar los 150 caracteres.", "error");
        editTitleInput.focus();
        return;
    }
    if (!anio) {
        setAlert(documentEditAlert, "Selecciona o ingresa el año o grado.", "error");
        return;
    }
    if (!curso) {
        setAlert(documentEditAlert, "Selecciona o ingresa el curso o especialidad.", "error");
        return;
    }

    documentEditSubmit.disabled = true;
    documentEditSubmit.textContent = "Guardando...";

    try {
        const response = await authorizedFetch(
            `${BACKEND_URL}/documentos/${encodeURIComponent(editingDocument.id_documento)}`,
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    titulo,
                    curso,
                    anio
                })
            },
        );
        if (response.status === 401) return;
        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok) {
            throw new Error(getResponseMessage(payload, "No se pudo actualizar el documento."));
        }

        documentEditDialog.close();
        showRepositoryMessage(getResponseMessage(payload, "Documento actualizado correctamente."), "success");
        await repository.loadDocuments();
        syncMaterialsAndExams();
    } catch (error) {
        setAlert(documentEditAlert, getErrorMessage(error), "error");
    } finally {
        documentEditSubmit.disabled = false;
        documentEditSubmit.textContent = "Guardar cambios";
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
        especialidadesCache = [];
        if (moduleBtnRepositorio) moduleBtnRepositorio.hidden = true;
        if (moduleBtnUsuarios) moduleBtnUsuarios.hidden = true;
        repositoryPanel.hidden = true;
        closePdfPreview();
        ++editDialogOpenToken;
        if (documentEditDialog.open) documentEditDialog.close();
        simulation.reset();
        examenes.reset();
        canManageRepository = false;
        clearRepositoryMessage();
    }
});
