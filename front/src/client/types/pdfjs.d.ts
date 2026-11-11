declare module "*/vendor/pdfjs/pdf.min.mjs" {
    export const GlobalWorkerOptions: {
        workerSrc: string;
    };

    export function getDocument(options: {
        url: string;
        withCredentials: boolean;
    }): {
        promise: Promise<import("pdfjs-dist").PDFDocumentProxy>;
    };
}
