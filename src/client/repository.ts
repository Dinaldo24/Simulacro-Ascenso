import { getPdfDocument, renderPdfPage } from "./pdf-renderer.js";

export interface RepositoryDocument {
    id_documento: string | number;
    titulo: string;
    nombre_archivo: string;
    tamano_bytes: number | string;
    curso: string | null;
    anio: string | null;
    fecha_subida: string;
    subido_por_nombres: string;
    subido_por_apellidos: string;
    pagina_portada: number | string;
    portada_personalizada: boolean | number;
}

interface RepositoryResponse {
    documents: RepositoryDocument[];
    canManage: boolean;
}

interface RepositoryCallbacks {
    onPreview: (item: RepositoryDocument) => void;
    onChangeCover: (item: RepositoryDocument) => void;
    onRename: (item: RepositoryDocument) => void;
    onDelete: (item: RepositoryDocument, button: HTMLButtonElement) => void;
    onCanManageChange: (canManage: boolean) => void;
    onError: (message: string) => void;
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

function isRepositoryDocument(value: unknown): value is RepositoryDocument {
    return isRecord(value) &&
        (typeof value.id_documento === "string" || typeof value.id_documento === "number") &&
        typeof value.titulo === "string" &&
        typeof value.nombre_archivo === "string" &&
        (typeof value.tamano_bytes === "number" || typeof value.tamano_bytes === "string") &&
        (typeof value.curso === "string" || value.curso === null) &&
        (typeof value.anio === "string" || value.anio === null) &&
        typeof value.fecha_subida === "string" &&
        typeof value.subido_por_nombres === "string" &&
        typeof value.subido_por_apellidos === "string" &&
        (typeof value.pagina_portada === "number" || typeof value.pagina_portada === "string") &&
        (typeof value.portada_personalizada === "boolean" ||
            typeof value.portada_personalizada === "number");
}

function parseRepositoryResponse(payload: unknown): RepositoryResponse {
    if (!isRecord(payload) ||
        typeof payload.canManage !== "boolean" ||
        !Array.isArray(payload.documents) ||
        !payload.documents.every(isRepositoryDocument)) {
        throw new Error("El servidor devolvió datos del repositorio no válidos.");
    }

    return {
        documents: payload.documents,
        canManage: payload.canManage
    };
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024 * 1024) {
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function setupRepository(callbacks: RepositoryCallbacks) {
    const documentList = requireElement<HTMLElement>("#document-list");
    const repositoryDocuments = new Map<string, RepositoryDocument>();
    let canManageRepository = false;

    function closeDocumentMenus(): void {
        documentList.querySelectorAll<HTMLElement>(".document-menu:not([hidden])").forEach((menu) => {
            menu.hidden = true;
            menu.parentElement
                ?.querySelector<HTMLButtonElement>(".document-menu-toggle")
                ?.setAttribute("aria-expanded", "false");
        });
    }

    async function renderDocumentCover(cover: HTMLElement): Promise<void> {
        const item = repositoryDocuments.get(cover.dataset.documentId ?? "");
        const coverCanvas = cover.querySelector<HTMLCanvasElement>(".document-cover-canvas");
        const placeholder = cover.querySelector<HTMLElement>(".document-cover-placeholder");

        if (!item || !coverCanvas || !placeholder) {
            return;
        }

        try {
            const pdfDocument = await getPdfDocument(item);
            const pageNumber = Math.min(
                Math.max(1, Number(item.pagina_portada) || 1),
                pdfDocument.numPages
            );

            await renderPdfPage(pdfDocument, pageNumber, coverCanvas, 280, 380);
            coverCanvas.hidden = false;
            placeholder.hidden = true;
        } catch {
            placeholder.textContent = "No se pudo cargar la portada";
        }
    }

    const coverObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                coverObserver.unobserve(entry.target);
                void renderDocumentCover(entry.target as HTMLElement);
            }
        });
    });

    function createDocumentRow(item: RepositoryDocument): HTMLElement {
        repositoryDocuments.set(String(item.id_documento), item);

        const row = document.createElement("article");
        row.className = "document-card";

        const coverButton = document.createElement("button");
        coverButton.className = "document-cover-button";
        coverButton.type = "button";
        coverButton.setAttribute("aria-label", `Abrir ${item.titulo}`);
        coverButton.addEventListener("click", () => callbacks.onPreview(item));

        const cover = document.createElement("div");
        cover.className = "document-cover";
        cover.dataset.documentId = String(item.id_documento);

        const coverPlaceholder = document.createElement("span");
        coverPlaceholder.className = "document-cover-placeholder";
        coverPlaceholder.textContent = "Cargando portada...";

        const coverCanvas = document.createElement("canvas");
        coverCanvas.className = "document-cover-canvas";
        coverCanvas.dataset.documentId = String(item.id_documento);
        coverCanvas.hidden = true;
        cover.append(coverPlaceholder, coverCanvas);

        if (item.portada_personalizada) {
            const coverImage = document.createElement("img");
            coverImage.className = "document-cover-image";
            coverImage.alt = `Portada de ${item.titulo}`;
            coverImage.src = `/api/documentos/${encodeURIComponent(item.id_documento)}/portada-imagen`;
            coverImage.addEventListener("load", () => {
                coverPlaceholder.hidden = true;
            });
            coverImage.addEventListener("error", () => {
                coverImage.remove();
                coverObserver.observe(cover);
            });
            cover.append(coverImage);
        } else {
            coverObserver.observe(cover);
        }

        const details = document.createElement("div");
        details.className = "document-details";

        const title = document.createElement("button");
        title.className = "document-preview-trigger";
        title.type = "button";
        title.setAttribute("aria-label", `Ver vista previa de ${item.titulo}`);
        title.textContent = item.titulo;
        title.addEventListener("click", () => callbacks.onPreview(item));

        const metadata = document.createElement("span");
        const uploader = `${item.subido_por_nombres} ${item.subido_por_apellidos}`.trim();
        const uploadDate = new Date(item.fecha_subida).toLocaleDateString("es-PE");
        metadata.textContent =
            `${item.curso ? `${item.curso} · ` : ""}${item.anio ? `${item.anio} · ` : ""}${item.nombre_archivo} · ${formatFileSize(Number(item.tamano_bytes))} · ${uploader} · ${uploadDate}`;

        details.append(title, metadata);

        const actions = document.createElement("div");
        actions.className = "document-actions";

        const menuId = `document-menu-${item.id_documento}`;
        const menuToggle = document.createElement("button");
        menuToggle.className = "document-menu-toggle";
        menuToggle.type = "button";
        menuToggle.textContent = "⋯";
        menuToggle.setAttribute("aria-label", `Más opciones para ${item.titulo}`);
        menuToggle.setAttribute("aria-haspopup", "true");
        menuToggle.setAttribute("aria-expanded", "false");
        menuToggle.setAttribute("aria-controls", menuId);

        const menu = document.createElement("div");
        menu.className = "document-menu";
        menu.id = menuId;
        menu.setAttribute("aria-label", `Acciones para ${item.titulo}`);
        menu.hidden = true;

        const download = document.createElement("a");
        download.className = "document-menu-item";
        download.href = `/api/documentos/${encodeURIComponent(item.id_documento)}/descargar`;
        download.textContent = "Descargar";
        download.addEventListener("click", closeDocumentMenus);
        menu.append(download);

        if (canManageRepository) {
            const changeCoverButton = document.createElement("button");
            changeCoverButton.className = "document-menu-item";
            changeCoverButton.type = "button";
            changeCoverButton.textContent = "Cambiar portada";
            changeCoverButton.addEventListener("click", () => {
                closeDocumentMenus();
                callbacks.onChangeCover(item);
            });

            const renameButton = document.createElement("button");
            renameButton.className = "document-menu-item";
            renameButton.type = "button";
            renameButton.textContent = "Cambiar nombre";
            renameButton.addEventListener("click", () => {
                closeDocumentMenus();
                callbacks.onRename(item);
            });

            const deleteButton = document.createElement("button");
            deleteButton.className = "document-menu-item document-menu-item--danger";
            deleteButton.type = "button";
            deleteButton.textContent = "Eliminar";
            deleteButton.addEventListener("click", () => {
                closeDocumentMenus();
                callbacks.onDelete(item, deleteButton);
            });
            menu.append(changeCoverButton, renameButton, deleteButton);
        }

        menuToggle.addEventListener("click", () => {
            const shouldOpen = menu.hidden;
            closeDocumentMenus();
            menu.hidden = !shouldOpen;
            menuToggle.setAttribute("aria-expanded", String(shouldOpen));
        });

        actions.append(menuToggle, menu);
        coverButton.append(cover);
        row.append(coverButton, details, actions);
        return row;
    }

    async function loadDocuments(): Promise<void> {
        documentList.replaceChildren();
        const loading = document.createElement("p");
        loading.className = "document-list-loading";
        loading.textContent = "Cargando documentos...";
        documentList.append(loading);

        try {
            const response = await fetch("/api/documentos");
            const payload: unknown = await response.json();

            if (!response.ok) {
                const message = isRecord(payload) && typeof payload.message === "string"
                    ? payload.message
                    : "No se pudieron cargar los documentos.";
                throw new Error(message);
            }

            const result = parseRepositoryResponse(payload);
            canManageRepository = result.canManage;
            callbacks.onCanManageChange(canManageRepository);
            documentList.replaceChildren();
            repositoryDocuments.clear();

            if (result.documents.length === 0) {
                const emptyState = document.createElement("p");
                emptyState.className = "document-list-empty";
                emptyState.textContent = "Todavía no hay documentos PDF en el repositorio.";
                documentList.append(emptyState);
                return;
            }

            result.documents.forEach((item) => {
                documentList.append(createDocumentRow(item));
            });
        } catch (error) {
            documentList.replaceChildren();
            callbacks.onError(getErrorMessage(error));
        }
    }

    document.addEventListener("click", (event) => {
        const target = event.target;

        if (!(target instanceof Element) || !target.closest(".document-actions")) {
            closeDocumentMenus();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeDocumentMenus();
        }
    });

    return {
        loadDocuments,
        closeMenus: closeDocumentMenus
    };
}
