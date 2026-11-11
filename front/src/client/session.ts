export const BACKEND_URL = "http://localhost:3002";

const SESSION_EXPIRED_EVENT = "auth:session-expired";

export interface SessionUser {
    id?: number;
    username: string;
    nombres: string;
    apellidos: string;
    role: string;
}

/** Elimina restos antiguos de sesión en localStorage para evitar perfiles cacheados al reiniciar la PC. */
export function clearLegacyLocalStorage(): void {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
}

export function getToken(): string {
    return sessionStorage.getItem("token") || "";
}

export function getStoredUser(): SessionUser | null {
    try {
        const raw = sessionStorage.getItem("user");
        if (!raw) return null;
        return JSON.parse(raw) as SessionUser;
    } catch {
        return null;
    }
}

export function saveSession(token: string, user: SessionUser): void {
    clearLegacyLocalStorage();
    sessionStorage.setItem("token", token);
    sessionStorage.setItem("user", JSON.stringify(user));
}

export function clearSession(): void {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("user");
    clearLegacyLocalStorage();
}

export function esGestorSession(): boolean {
    const user = getStoredUser();
    return Boolean(user && (user.role === "administrador" || user.role === "director"));
}

/** Comprueba localmente si el token JWT superó su fecha de expiración (`exp`). */
export function isTokenExpired(token: string): boolean {
    try {
        const parts = token.split(".");
        if (parts.length !== 3 || !parts[1]) return true;
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
        const payload = JSON.parse(atob(padded)) as { exp?: unknown };
        if (typeof payload.exp !== "number") return false;
        return Date.now() >= payload.exp * 1000;
    } catch {
        return true;
    }
}

export function notifySessionExpired(reason?: string): void {
    window.dispatchEvent(
        new CustomEvent(SESSION_EXPIRED_EVENT, {
            detail: { reason: reason || "Tu sesión expiró. Inicia sesión nuevamente." },
        })
    );
}

export function onSessionExpired(handler: (reason: string) => void): void {
    window.addEventListener(SESSION_EXPIRED_EVENT, (event) => {
        const customEvent = event as CustomEvent<{ reason?: string }>;
        handler(customEvent.detail?.reason || "Tu sesión expiró. Inicia sesión nuevamente.");
    });
}

/** Ejecuta fetch con Authorization Bearer actual y cierra sesión si el backend responde 401. */
export async function authorizedFetch(input: string, init: RequestInit = {}): Promise<Response> {
    const token = getToken();
    const headers = new Headers(init.headers);
    if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(input, { ...init, headers });
    if (response.status === 401) {
        notifySessionExpired("Tu sesión expiró o dejó de ser válida. Inicia sesión nuevamente.");
    }
    return response;
}

/** Descarga un recurso protegido con Bearer y devuelve una Blob URL (revocar con URL.revokeObjectURL). */
export async function fetchBlobUrl(url: string): Promise<string> {
    const response = await authorizedFetch(url);
    if (!response.ok) {
        throw new Error("No se pudo obtener el archivo solicitado.");
    }
    return URL.createObjectURL(await response.blob());
}

/** Descarga un recurso protegido y dispara la descarga del navegador. */
export async function downloadProtectedFile(url: string, filename: string): Promise<void> {
    const blobUrl = await fetchBlobUrl(url);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}
