import * as pdfjsLib from "/vendor/pdfjs/pdf.min.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";

export interface PdfDocumentReference {
    id_documento: string | number;
}

const pdfDocuments = new Map<string, Promise<PDFDocumentProxy>>();

export function getPdfDocument(document: PdfDocumentReference): Promise<PDFDocumentProxy> {
    const documentId = String(document.id_documento);

    if (!pdfDocuments.has(documentId)) {
        const loadingTask = pdfjsLib.getDocument({
            url: `/api/documentos/${encodeURIComponent(documentId)}/vista-previa`,
            withCredentials: true
        });
        pdfDocuments.set(documentId, loadingTask.promise.catch((error: unknown) => {
            pdfDocuments.delete(documentId);
            throw error;
        }));
    }

    return pdfDocuments.get(documentId)!;
}

export async function renderPdfPage(
    pdfDocument: PDFDocumentProxy,
    pageNumber: number,
    canvas: HTMLCanvasElement,
    maxWidth: number,
    maxHeight: number
): Promise<void> {
    const page = await pdfDocument.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(maxWidth / baseViewport.width, maxHeight / baseViewport.height);
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: scale * outputScale });
    const context = canvas.getContext("2d");

    if (!context) {
        throw new Error("El navegador no pudo preparar la vista previa del PDF.");
    }

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${Math.ceil(viewport.width / outputScale)}px`;
    canvas.style.height = `${Math.ceil(viewport.height / outputScale)}px`;
    await page.render({ canvasContext: context, viewport }).promise;
}
