const loginForm = document.querySelector("#login-form");
const usernameInput = document.querySelector("#username");
const passwordInput = document.querySelector("#password");
const togglePasswordButton = document.querySelector("#toggle-password");
const formMessage = document.querySelector("#form-message");
const loginButton = document.querySelector("#login-button");
const logoutButton = document.querySelector("#logout-button");
const loginPage = document.querySelector("#login-page");
const dashboard = document.querySelector("#dashboard");
const accountName = document.querySelector("#account-name");
const accountRole = document.querySelector("#account-role");
const accountAvatar = document.querySelector("#account-avatar");
const dashboardTitle = document.querySelector("#dashboard-title");
const dashboardDescription = document.querySelector("#dashboard-description");
const repositoryPanel = document.querySelector("#repository-panel");
const simulationPanel = document.querySelector("#simulation-panel");
const uploadToggle = document.querySelector("#upload-toggle");
const uploadForm = document.querySelector("#upload-form");
const uploadCancel = document.querySelector("#upload-cancel");
const uploadSubmit = document.querySelector("#upload-submit");
const documentTitleInput = document.querySelector("#document-title");
const documentFileInput = document.querySelector("#document-file");
const documentList = document.querySelector("#document-list");
const repositoryMessage = document.querySelector("#repository-message");
const currentYear = document.querySelector("#current-year");

currentYear.textContent = new Date().getFullYear();

const modules = {
    repositorio: {
        title: "Repositorio",
        description: "Consulta y organiza los recursos educativos del colegio."
    },
    simulacion: {
        title: "Simulación",
        description: "El módulo de simulación estará disponible próximamente."
    }
};

const roleNames = {
    administrador: "Administrador",
    director: "Director",
    profesor: "Profesor"
};

let canManageRepository = false;

function showMessage(message, type = "") {
    formMessage.textContent = message;
    formMessage.className = `form-message${type ? ` form-message--${type}` : ""}`;
    formMessage.hidden = false;
}

function clearMessage() {
    formMessage.textContent = "";
    formMessage.className = "form-message";
    formMessage.hidden = true;
}

function showAuthenticatedUser(user) {
    const fullName = `${user.nombres} ${user.apellidos}`.trim();

    accountName.textContent = fullName || user.username;
    accountRole.textContent = roleNames[user.role] || "Usuario";
    accountAvatar.textContent = (user.nombres || user.username).charAt(0).toLocaleUpperCase("es");
    canManageRepository = ["administrador", "director"].includes(user.role);
    uploadToggle.hidden = !canManageRepository;
    loginPage.hidden = true;
    dashboard.hidden = false;
    document.title = "Menú principal | Juan Pablo Vizcardo y Guzmán";
    selectModule("repositorio");
}

function selectModule(moduleName) {
    const module = modules[moduleName];

    if (!module) {
        return;
    }

    dashboardTitle.textContent = module.title;
    dashboardDescription.textContent = module.description;
    repositoryPanel.hidden = moduleName !== "repositorio";
    simulationPanel.hidden = moduleName !== "simulacion";

    if (moduleName === "repositorio") {
        loadDocuments();
    }

    document.querySelectorAll("[data-module]").forEach((button) => {
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

function showRepositoryMessage(message, type = "") {
    repositoryMessage.textContent = message;
    repositoryMessage.className = `repository-message${type ? ` repository-message--${type}` : ""}`;
    repositoryMessage.hidden = false;
}

function clearRepositoryMessage() {
    repositoryMessage.textContent = "";
    repositoryMessage.className = "repository-message";
    repositoryMessage.hidden = true;
}

function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) {
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createDocumentRow(document) {
    const row = documentRef.createElement("article");
    row.className = "document-row";

    const icon = documentRef.createElement("span");
    icon.className = "document-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "PDF";

    const details = documentRef.createElement("span");
    details.className = "document-details";

    const title = documentRef.createElement("strong");
    title.textContent = document.titulo;

    const metadata = documentRef.createElement("span");
    const uploader = `${document.subido_por_nombres} ${document.subido_por_apellidos}`.trim();
    const uploadDate = new Date(document.fecha_subida).toLocaleDateString("es-PE");
    metadata.textContent =
        `${document.nombre_archivo} · ${formatFileSize(Number(document.tamano_bytes))} · ${uploader} · ${uploadDate}`;

    details.append(title, metadata);

    const actions = documentRef.createElement("span");
    actions.className = "document-actions";

    const download = documentRef.createElement("a");
    download.className = "document-download";
    download.href = `/api/documentos/${encodeURIComponent(document.id_documento)}/descargar`;
    download.textContent = "Descargar";
    actions.append(download);

    if (canManageRepository) {
        const deleteButton = documentRef.createElement("button");
        deleteButton.className = "document-delete";
        deleteButton.type = "button";
        deleteButton.textContent = "Eliminar";
        deleteButton.addEventListener("click", () => deleteDocument(document, deleteButton));
        actions.append(deleteButton);
    }

    row.append(icon, details, actions);
    return row;
}

const documentRef = document;

async function loadDocuments() {
    documentList.replaceChildren();
    const loading = documentRef.createElement("p");
    loading.className = "document-list-loading";
    loading.textContent = "Cargando documentos...";
    documentList.append(loading);

    try {
        const response = await fetch("/api/documentos");
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "No se pudieron cargar los documentos.");
        }

        canManageRepository = result.canManage;
        uploadToggle.hidden = !canManageRepository;
        documentList.replaceChildren();

        if (result.documents.length === 0) {
            const emptyState = documentRef.createElement("p");
            emptyState.className = "document-list-empty";
            emptyState.textContent = "Todavía no hay documentos PDF en el repositorio.";
            documentList.append(emptyState);
            return;
        }

        result.documents.forEach((document) => {
            documentList.append(createDocumentRow(document));
        });
    } catch (error) {
        documentList.replaceChildren();
        showRepositoryMessage(error.message, "error");
    }
}

async function deleteDocument(document, button) {
    const confirmed = window.confirm(`¿Eliminar "${document.titulo}" del repositorio?`);

    if (!confirmed) {
        return;
    }

    clearRepositoryMessage();
    button.disabled = true;

    try {
        const response = await fetch(`/api/documentos/${encodeURIComponent(document.id_documento)}`, {
            method: "DELETE"
        });

        if (!response.ok) {
            const result = await response.json();
            throw new Error(result.message || "No se pudo eliminar el PDF.");
        }

        showRepositoryMessage("El PDF se eliminó del repositorio.", "success");
        await loadDocuments();
    } catch (error) {
        showRepositoryMessage(error.message, "error");
        button.disabled = false;
    }
}

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

    const file = documentFileInput.files[0];

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
    formData.append("pdf", file);
    uploadSubmit.disabled = true;
    uploadSubmit.textContent = "Subiendo...";

    try {
        const response = await fetch("/api/documentos", {
            method: "POST",
            body: formData
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "No se pudo subir el PDF.");
        }

        uploadForm.reset();
        uploadForm.hidden = true;
        uploadToggle.hidden = !canManageRepository;
        showRepositoryMessage("El PDF se agregó al repositorio.", "success");
        await loadDocuments();
    } catch (error) {
        showRepositoryMessage(error.message, "error");
    } finally {
        uploadSubmit.disabled = false;
        uploadSubmit.textContent = "Guardar PDF";
    }
});

togglePasswordButton.addEventListener("click", () => {
    const isPasswordVisible = passwordInput.type === "text";

    passwordInput.type = isPasswordVisible ? "password" : "text";
    togglePasswordButton.setAttribute("aria-pressed", String(!isPasswordVisible));
    togglePasswordButton.setAttribute(
        "aria-label",
        isPasswordVisible ? "Mostrar contraseña" : "Ocultar contraseña"
    );
});

document.querySelectorAll("[data-module]").forEach((button) => {
    button.addEventListener("click", () => selectModule(button.dataset.module));
});

function clearFieldError(input) {
    const errorMessage = document.querySelector(`#${input.id}-error`);

    input.removeAttribute("aria-invalid");
    errorMessage.textContent = "";
}

function showFieldError(input, message) {
    const errorMessage = document.querySelector(`#${input.id}-error`);

    input.setAttribute("aria-invalid", "true");
    errorMessage.textContent = message;
}

[usernameInput, passwordInput].forEach((input) => {
    input.addEventListener("input", () => {
        clearFieldError(input);
        clearMessage();
    });
});

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldError(usernameInput);
    clearFieldError(passwordInput);
    clearMessage();

    let firstInvalidInput = null;

    if (!usernameInput.value.trim()) {
        showFieldError(usernameInput, "Escribe tu usuario para continuar.");
        firstInvalidInput = usernameInput;
    }

    if (!passwordInput.value) {
        showFieldError(passwordInput, "Escribe tu contraseña para continuar.");
        if (!firstInvalidInput) {
            firstInvalidInput = passwordInput;
        }
    }

    if (firstInvalidInput) {
        firstInvalidInput.focus();
        return;
    }

    loginButton.disabled = true;
    loginButton.querySelector("span").textContent = "Verificando...";

    try {
        const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: usernameInput.value.trim(),
                password: passwordInput.value
            })
        });
        const result = await response.json();

        if (!response.ok) {
            showMessage(result.message || "No se pudo iniciar sesión.", "error");
            return;
        }

        passwordInput.value = "";
        showAuthenticatedUser(result.user);
    } catch {
        showMessage(
            "No se pudo conectar con el servidor. Inícialo y abre la aplicación en http://localhost:3000.",
            "error"
        );
    } finally {
        loginButton.disabled = false;
        loginButton.querySelector("span").textContent = "Ingresar";
    }
});

logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;

    try {
        const response = await fetch("/api/auth/logout", { method: "POST" });

        if (!response.ok) {
            showMessage("No se pudo cerrar la sesión. Inténtalo nuevamente.", "error");
            return;
        }

        loginForm.reset();
        dashboard.hidden = true;
        loginPage.hidden = false;
        document.title = "Iniciar sesión | Juan Pablo Vizcardo y Guzmán";
        uploadForm.reset();
        uploadForm.hidden = true;
        uploadToggle.hidden = true;
        canManageRepository = false;
        clearMessage();
        clearRepositoryMessage();
        usernameInput.focus();
    } catch {
        showMessage("No se pudo conectar con el servidor para cerrar la sesión.", "error");
    } finally {
        logoutButton.disabled = false;
    }
});

async function restoreSession() {
    try {
        const response = await fetch("/api/auth/me");

        if (response.ok) {
            const result = await response.json();
            showAuthenticatedUser(result.user);
        } else if (response.status !== 401) {
            showMessage("No se pudo comprobar la sesión con el servidor.", "error");
        }
    } catch {
        showMessage(
            "Inicia el servidor con npm start y abre la aplicación en http://localhost:3000.",
            "error"
        );
    }
}

restoreSession();