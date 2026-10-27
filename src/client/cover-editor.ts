import { getPdfDocument, renderPdfPage } from "./pdf-renderer.js";
import type { RepositoryDocument } from "./repository.js";
import type { PDFDocumentProxy } from "pdfjs-dist";

interface CoverEditorCallbacks {
    onSaved: (message: string) => void;
    onError: (message: string) => void;
}

function requireElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);

    if (!element) {
        throw new Error(`No se encontró el elemento requerido: ${selector}`);
    }

    return element;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

function getResponseMessage(payload: unknown, fallback: string): string {
    if (typeof payload !== "object" || payload === null || !("message" in payload)) {
        return fallback;
    }

    return typeof payload.message === "string" && payload.message ? payload.message : fallback;
}

export function setupCoverEditor(callbacks: CoverEditorCallbacks) {
    const dialog = requireElement<HTMLDialogElement>("#cover-editor-dialog");
    const title = requireElement<HTMLElement>("#cover-editor-title");
    const closeButton = requireElement<HTMLButtonElement>("#cover-editor-close");
    const pageCanvas = requireElement<HTMLCanvasElement>("#cover-page-canvas");
    const pageNumberInput = requireElement<HTMLInputElement>("#cover-page-number");
    const pageCount = requireElement<HTMLElement>("#cover-page-count");
    const pageStatus = requireElement<HTMLElement>("#cover-page-status");
    const pagePrevious = requireElement<HTMLButtonElement>("#cover-page-previous");
    const pageNext = requireElement<HTMLButtonElement>("#cover-page-next");
    const pageSave = requireElement<HTMLButtonElement>("#cover-page-save");
    const imageInput = requireElement<HTMLInputElement>("#cover-image-input");
    const imageStatus = requireElement<HTMLElement>("#cover-image-status");
    const imagePreviewContainer = requireElement<HTMLElement>("#cover-image-preview-container");
    const imagePreview = requireElement<HTMLImageElement>("#cover-image-preview");
    const imageClear = requireElement<HTMLButtonElement>("#cover-image-clear");
    const imageSave = requireElement<HTMLButtonElement>("#cover-image-save");
    let editingDocument: RepositoryDocument | null = null;
    let pageDocument: PDFDocumentProxy | null = null;
    let imagePreviewRequestId = 0;

    async function renderPage(): Promise<void> {
        const selectedPage = Number(pageNumberInput.value);

        if (!pageDocument || !Number.isInteger(selectedPage) ||
            selectedPage < 1 || selectedPage > pageDocument.numPages) {
            pageStatus.textContent = "Escribe un número de página válido.";
            pageSave.disabled = true;
            return;
        }

        pageStatus.textContent = "Preparando la vista de la página...";
        pageSave.disabled = true;

        try {
            await renderPdfPage(pageDocument, selectedPage, pageCanvas, 480, 500);
            pageStatus.textContent = `Vista previa de la página ${selectedPage}.`;
            pageSave.disabled = false;
        } catch {
            pageStatus.textContent = "No se pudo mostrar esta página del PDF.";
        }
    }

    async function open(item: RepositoryDocument): Promise<void> {
        editingDocument = item;
        pageDocument = null;
        title.textContent = `Portada de ${item.titulo}`;
        pageNumberInput.value = String(Math.max(1, Number(item.pagina_portada) || 1));
        pageCount.textContent = "de ...";
        pageStatus.textContent = "Cargando el PDF...";
        pageNumberInput.disabled = true;
        pagePrevious.disabled = true;
        pageNext.disabled = true;
        pageSave.disabled = true;
        imageInput.value = "";
        imagePreviewContainer.hidden = true;
        imagePreview.removeAttribute("src");
        imageSave.hidden = true;
        imageStatus.hidden = true;
        imagePreviewRequestId += 1;
        dialog.showModal();

        try {
            const pdfDocument = await getPdfDocument(item);

            if (editingDocument !== item) {
                return;
            }

            pageDocument = pdfDocument;
            pageNumberInput.max = String(pdfDocument.numPages);
            pageCount.textContent = `de ${pdfDocument.numPages}`;
            pageNumberInput.disabled = false;
            pagePrevious.disabled = false;
            pageNext.disabled = false;
            await renderPage();
        } catch {
            pageStatus.textContent = "No se pudo abrir el PDF. Puedes subir una imagen como portada.";
        }
    }

    async function savePage(): Promise<void> {
        const selectedPage = Number(pageNumberInput.value);

        if (!editingDocument || !pageDocument ||
            !Number.isInteger(selectedPage) || selectedPage < 1 ||
            selectedPage > pageDocument.numPages) {
            pageStatus.textContent = "Selecciona una página válida antes de guardar.";
            return;
        }

        pageSave.disabled = true;

        try {
            const response = await fetch(
                `/api/documentos/${encodeURIComponent(editingDocument.id_documento)}/portada`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ pagina: selectedPage })
                }
            );
            const payload: unknown = await response.json();

            if (!response.ok) {
                throw new Error(getResponseMessage(payload, "No se pudo cambiar la portada del PDF."));
            }

            dialog.close();
            callbacks.onSaved("Se actualizó la portada del PDF.");
        } catch (error) {
            callbacks.onError(getErrorMessage(error));
            pageSave.disabled = false;
        }
    }

    async function saveImage(): Promise<void> {
        const file = imageInput.files?.[0];
        const extension = file?.name.split(".").pop()?.toLowerCase() ?? "";
        const supportedExtensions = ["png", "jpg", "jpeg", "jpe", "webp"];

        if (!editingDocument || !file) {
            callbacks.onError("Selecciona una imagen PNG, JPEG o WebP para la portada.");
            return;
        }

        if (!supportedExtensions.includes(extension) || file.size > 5 * 1024 * 1024) {
            callbacks.onError("Selecciona una imagen PNG, JPEG o WebP de hasta 5 MB.");
            return;
        }

        imageSave.disabled = true;
        const formData = new FormData();
        formData.append("portada", file);

        try {
            const response = await fetch(
                `/api/documentos/${encodeURIComponent(editingDocument.id_documento)}/portada-imagen`,
                { method: "POST", body: formData }
            );
            const payload: unknown = await response.json();

            if (!response.ok) {
                throw new Error(getResponseMessage(payload, "No se pudo guardar la imagen de portada."));
            }

            dialog.close();
            callbacks.onSaved("Se actualizó la imagen de portada del PDF.");
        } catch (error) {
            callbacks.onError(getErrorMessage(error));
        } finally {
            imageSave.disabled = false;
        }
    }

    async function previewImage(): Promise<void> {
        const file = imageInput.files?.[0];
        const extension = file?.name.split(".").pop()?.toLowerCase() ?? "";
        const requestId = ++imagePreviewRequestId;
        imageSave.hidden = true;
        imagePreviewContainer.hidden = true;
        imagePreview.removeAttribute("src");
        imageStatus.hidden = true;

        if (!file) {
            return;
        }

        if (!["png", "jpg", "jpeg", "jpe", "webp"].includes(extension) ||
            file.size > 5 * 1024 * 1024) {
            imageStatus.textContent = "Selecciona una imagen PNG, JPEG o WebP de hasta 5 MB.";
            imageStatus.hidden = false;
            return;
        }

        imageStatus.textContent = "Preparando la vista previa...";
        imageStatus.hidden = false;

        try {
            const imageDataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.addEventListener("load", () => {
                    if (typeof reader.result === "string") {
                        resolve(reader.result);
                    } else {
                        reject(new Error("No se pudo leer el archivo de imagen."));
                    }
                });
                reader.addEventListener(
                    "error",
                    () => reject(new Error("No se pudo leer el archivo de imagen."))
                );
                reader.readAsDataURL(file);
            });

            if (requestId !== imagePreviewRequestId) {
                return;
            }

            const imageLoaded = new Promise<void>((resolve, reject) => {
                imagePreview.addEventListener("load", () => resolve(), { once: true });
                imagePreview.addEventListener(
                    "error",
                    () => reject(new Error("No se pudo cargar la vista previa de la imagen.")),
                    { once: true }
                );
            });

            imagePreviewContainer.hidden = false;
            imagePreview.src = imageDataUrl;
            await imageLoaded;

            if (requestId !== imagePreviewRequestId) {
                return;
            }

            imageSave.hidden = false;
            imageStatus.hidden = true;
        } catch {
            if (requestId === imagePreviewRequestId) {
                imagePreview.removeAttribute("src");
                imagePreviewContainer.hidden = true;
                imageStatus.textContent =
                    "No se pudo mostrar esta imagen. Selecciona un archivo PNG, JPEG o WebP válido.";
                imageStatus.hidden = false;
            }
        }
    }

    closeButton.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
        editingDocument = null;
        pageDocument = null;
        pageCanvas.width = 0;
        pageCanvas.height = 0;
        pageStatus.textContent = "";
        imagePreviewRequestId += 1;
        imagePreview.removeAttribute("src");
        imageStatus.hidden = true;
    });

    pageNumberInput.addEventListener("change", renderPage);
    pagePrevious.addEventListener("click", () => {
        pageNumberInput.value = String(Math.max(1, Number(pageNumberInput.value) - 1));
        void renderPage();
    });
    pageNext.addEventListener("click", () => {
        const lastPage = pageDocument?.numPages || Number(pageNumberInput.max) || 1;
        pageNumberInput.value = String(Math.min(lastPage, Number(pageNumberInput.value) + 1));
        void renderPage();
    });
    pageSave.addEventListener("click", savePage);
    imageInput.addEventListener("change", previewImage);
    imageClear.addEventListener("click", () => {
        imagePreviewRequestId += 1;
        imageInput.value = "";
        imagePreview.removeAttribute("src");
        imagePreviewContainer.hidden = true;
        imageSave.hidden = true;
        imageStatus.hidden = true;
    });
    imageSave.addEventListener("click", saveImage);

    return { open };
}
