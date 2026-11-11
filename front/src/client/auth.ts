import {
    BACKEND_URL,
    clearLegacyLocalStorage,
    clearSession,
    getStoredUser,
    getToken,
    isTokenExpired,
    onSessionExpired,
    saveSession,
    type SessionUser,
} from "./session.js";

export type AuthenticatedUser = SessionUser;

interface AuthenticationCallbacks {
    onAuthenticated: (user: AuthenticatedUser) => void;
    onLogout: () => void;
}

function requireElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);

    if (!element) {
        throw new Error(`No se encontró el elemento requerido: ${selector}`);
    }

    return element;
}

function getFieldError(input: HTMLInputElement): HTMLElement {
    return requireElement<HTMLElement>(`#${input.id}-error`);
}

function getButtonLabel(button: HTMLButtonElement): HTMLSpanElement {
    const label = button.querySelector<HTMLSpanElement>("span");

    if (!label) {
        throw new Error("No se encontró el texto del botón de inicio de sesión.");
    }

    return label;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getAuthenticatedUser(payload: unknown): AuthenticatedUser | null {
    if (!isRecord(payload) || !isRecord(payload.user)) {
        return null;
    }

    const { id, username, nombres, apellidos, role } = payload.user;

    if (
        typeof username !== "string" ||
        typeof nombres !== "string" ||
        typeof apellidos !== "string" ||
        typeof role !== "string"
    ) {
        return null;
    }

    const numericId = typeof id === "number" ? id : (typeof id === "string" ? Number(id) : undefined);

    return { id: numericId, username, nombres, apellidos, role };
}

function getResponseMessage(payload: unknown, fallback: string): string {
    if (isRecord(payload)) {
        if (typeof payload.mensaje === "string" && payload.mensaje) return payload.mensaje;
        if (typeof payload.message === "string" && payload.message) return payload.message;
    }
    return fallback;
}

export function setupAuthentication(callbacks: AuthenticationCallbacks): void {
    const loginForm = requireElement<HTMLFormElement>("#login-form");
    const usernameInput = requireElement<HTMLInputElement>("#username");
    const passwordInput = requireElement<HTMLInputElement>("#password");
    const togglePasswordButton = requireElement<HTMLButtonElement>("#toggle-password");
    const formMessage = requireElement<HTMLElement>("#form-message");
    const loginButton = requireElement<HTMLButtonElement>("#login-button");
    const logoutButton = requireElement<HTMLButtonElement>("#logout-button");
    const loginPage = requireElement<HTMLElement>("#login-page");
    const dashboard = requireElement<HTMLElement>("#dashboard");
    const loginButtonLabel = getButtonLabel(loginButton);

    const showMessage = (message: string, type = ""): void => {
        formMessage.textContent = message;
        formMessage.className = `form-message${type ? ` form-message--${type}` : ""}`;
        formMessage.hidden = false;
    };

    const clearMessage = (): void => {
        formMessage.textContent = "";
        formMessage.className = "form-message";
        formMessage.hidden = true;
    };

    const clearFieldError = (input: HTMLInputElement): void => {
        getFieldError(input).textContent = "";
        input.removeAttribute("aria-invalid");
    };

    const showFieldError = (input: HTMLInputElement, message: string): void => {
        input.setAttribute("aria-invalid", "true");
        getFieldError(input).textContent = message;
    };

    togglePasswordButton.addEventListener("click", () => {
        const isPasswordVisible = passwordInput.type === "text";

        passwordInput.type = isPasswordVisible ? "password" : "text";
        togglePasswordButton.setAttribute("aria-pressed", String(!isPasswordVisible));
        togglePasswordButton.setAttribute(
            "aria-label",
            isPasswordVisible ? "Mostrar contraseña" : "Ocultar contraseña"
        );
    });

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

        let firstInvalidInput: HTMLInputElement | null = null;

        if (!usernameInput.value.trim()) {
            showFieldError(usernameInput, "Escribe tu usuario o email para continuar.");
            firstInvalidInput = usernameInput;
        }

        if (!passwordInput.value) {
            showFieldError(passwordInput, "Escribe tu contraseña para continuar.");
            firstInvalidInput ??= passwordInput;
        }

        if (firstInvalidInput) {
            firstInvalidInput.focus();
            return;
        }

        loginButton.disabled = true;
        loginButtonLabel.textContent = "Verificando...";

        try {
            const response = await fetch(`${BACKEND_URL}/usuarios/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: usernameInput.value.trim(),
                    username: usernameInput.value.trim(),
                    password: passwordInput.value
                })
            });
            const payload: unknown = await response.json();

            if (!response.ok) {
                showMessage(getResponseMessage(payload, "No se pudo iniciar sesión."), "error");
                return;
            }

            const user = getAuthenticatedUser(payload);

            if (!user) {
                showMessage("El servidor devolvió datos de sesión no válidos.", "error");
                return;
            }

            if (isRecord(payload) && typeof payload.token === "string") {
                saveSession(payload.token, user);
            }

            passwordInput.value = "";
            loginPage.hidden = true;
            dashboard.hidden = false;
            callbacks.onAuthenticated(user);
        } catch {
            showMessage(
                "No se pudo conectar con el servidor backend en http://localhost:3002.",
                "error"
            );
        } finally {
            loginButton.disabled = false;
            loginButtonLabel.textContent = "Ingresar";
        }
    });

    function cerrarVistaSesion(mensajeError?: string): void {
        clearSession();
        loginForm.reset();
        dashboard.hidden = true;
        loginPage.hidden = false;
        document.title = "Iniciar sesión | Juan Pablo Vizcardo y Guzmán";
        callbacks.onLogout();

        if (mensajeError) {
            showMessage(mensajeError, "error");
        } else {
            clearMessage();
        }
        usernameInput.focus();
    }

    logoutButton.addEventListener("click", () => cerrarVistaSesion());
    onSessionExpired((reason) => cerrarVistaSesion(reason));

    void restoreSession();

    async function restoreSession(): Promise<void> {
        clearLegacyLocalStorage();

        const storedToken = getToken();
        const storedUser = getStoredUser();

        if (!storedToken || !storedUser) {
            return;
        }

        if (isTokenExpired(storedToken)) {
            clearSession();
            showMessage("Tu sesión anterior ha expirado. Inicia sesión nuevamente.", "error");
            return;
        }

        try {
            const response = await fetch(`${BACKEND_URL}/usuarios/sesion`, {
                headers: { Authorization: `Bearer ${storedToken}` }
            });

            if (!response.ok) {
                clearSession();
                showMessage("Tu sesión expiró o dejó de ser válida. Inicia sesión nuevamente.", "error");
                return;
            }

            const payload: unknown = await response.json().catch(() => null);
            const freshUser = getAuthenticatedUser(payload) || storedUser;
            saveSession(storedToken, freshUser);
            loginPage.hidden = true;
            dashboard.hidden = false;
            callbacks.onAuthenticated(freshUser);
        } catch {
            clearSession();
            showMessage("No se pudo validar tu sesión con el servidor. Inicia sesión nuevamente.", "error");
        }
    }
}
