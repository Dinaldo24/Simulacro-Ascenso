import { BACKEND_URL, authorizedFetch, downloadProtectedFile, fetchBlobUrl } from "./session.js";
import { populateSelect, sortYearsDesc } from "./year-select.js";

interface ExamenItem {
    anio: string;
    curso: string;
    tienePreguntasPdf: boolean;
    tieneRespuestasPdf: boolean;
    preguntasPdfUrl: string | null;
    respuestasPdfUrl: string | null;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

export function setupSimulation() {
    const simulationYear = document.querySelector<HTMLSelectElement>("#simulation-year");
    const simulationCourse = document.querySelector<HTMLSelectElement>("#simulation-course");
    const simulationActions = document.querySelector<HTMLElement>("#simulation-exam-actions");
    const rowPreguntas = document.querySelector<HTMLElement>("#simulation-row-preguntas");
    const rowRespuestas = document.querySelector<HTMLElement>("#simulation-row-respuestas");
    const btnPreguntas = document.querySelector<HTMLAnchorElement>("#simulation-btn-preguntas");
    const btnRespuestas = document.querySelector<HTMLAnchorElement>("#simulation-btn-respuestas");
    const btnViewPreguntas = document.querySelector<HTMLButtonElement>("#simulation-btn-view-preguntas");
    const btnViewRespuestas = document.querySelector<HTMLButtonElement>("#simulation-btn-view-respuestas");

    const simulationViewer = document.querySelector<HTMLElement>("#simulation-viewer");
    const simulationDocumentTitle = document.querySelector<HTMLElement>("#simulation-document-title");
    const simulationPreviewFrame = document.querySelector<HTMLIFrameElement>("#simulation-pdf-frame");
    const simulationDownload = document.querySelector<HTMLAnchorElement>("#simulation-download");
    const simulationMessage = document.querySelector<HTMLElement>("#simulation-message");
    const simulationEmptyState = document.querySelector<HTMLElement>("#simulation-empty-state");

    let examenesList: ExamenItem[] = [];

    function showMessage(message: string, type: "error" | "success" | "info"): void {
        if (!simulationMessage) return;
        simulationMessage.textContent = message;
        simulationMessage.className = `simulation-alert simulation-alert--${type}`;
        simulationMessage.hidden = false;
    }

    function clearMessage(): void {
        if (!simulationMessage) return;
        simulationMessage.textContent = "";
        simulationMessage.className = "simulation-alert";
        simulationMessage.hidden = true;
    }

    function updateCourseOptions(): void {
        if (!simulationYear || !simulationCourse) return;
        const selectedYear = simulationYear.value;
        const availableCourses = Array.from(
            new Set(
                examenesList
                    .filter((e) => !selectedYear || String(e.anio).trim() === selectedYear)
                    .map((e) => e.curso)
            )
        ).sort();

        populateSelect(simulationCourse, availableCourses, "Selecciona un curso");
        simulationCourse.disabled = availableCourses.length === 0;
        updateSelectedMaterial();
    }

    function updateSelectedMaterial(): void {
        if (!simulationYear || !simulationCourse) return;
        const selectedYear = simulationYear.value;
        const selectedCourse = simulationCourse.value;

        if (!selectedYear || !selectedCourse) {
            if (simulationActions) simulationActions.hidden = true;
            closeViewer();
            return;
        }

        const match = examenesList.find(
            (e) => String(e.anio).trim() === selectedYear && e.curso === selectedCourse
        );

        if (!match) {
            if (simulationActions) simulationActions.hidden = true;
            closeViewer();
            return;
        }

        const hasPreguntas = Boolean(match.tienePreguntasPdf && match.preguntasPdfUrl);
        const hasRespuestas = Boolean(match.tieneRespuestasPdf && match.respuestasPdfUrl);

        if (rowPreguntas) {
            rowPreguntas.hidden = !hasPreguntas;
        }
        if (rowRespuestas) {
            rowRespuestas.hidden = !hasRespuestas;
        }

        // Configurar botones de descarga y visualización
        if (btnPreguntas) {
            if (hasPreguntas && match.preguntasPdfUrl) {
                btnPreguntas.href = "#";
                btnPreguntas.onclick = (e) => {
                    e.preventDefault();
                    void descargar(match.preguntasPdfUrl, `${match.anio}_${match.curso}_Preguntas.pdf`);
                };
                btnPreguntas.hidden = false;
            } else {
                btnPreguntas.hidden = true;
            }
        }

        if (btnRespuestas) {
            if (hasRespuestas && match.respuestasPdfUrl) {
                btnRespuestas.href = "#";
                btnRespuestas.onclick = (e) => {
                    e.preventDefault();
                    void descargar(match.respuestasPdfUrl, `${match.anio}_${match.curso}_Respuestas.pdf`);
                };
                btnRespuestas.hidden = false;
            } else {
                btnRespuestas.hidden = true;
            }
        }

        if (btnViewPreguntas) {
            btnViewPreguntas.hidden = !hasPreguntas;
            btnViewPreguntas.onclick = () => {
                if (match.preguntasPdfUrl) {
                    void abrirVisor(
                        `Cuadernillo de Preguntas: ${match.curso} (${match.anio})`,
                        match.preguntasPdfUrl
                    );
                }
            };
        }

        if (btnViewRespuestas) {
            btnViewRespuestas.hidden = !hasRespuestas;
            btnViewRespuestas.onclick = () => {
                if (match.respuestasPdfUrl) {
                    void abrirVisor(
                        `Clave de Respuestas: ${match.curso} (${match.anio})`,
                        match.respuestasPdfUrl
                    );
                }
            };
        }

        if (simulationActions) {
            simulationActions.hidden = !hasPreguntas && !hasRespuestas;
        }
    }

    let viewerBlobUrl: string | null = null;
    let viewerPath: string | null = null;
    let viewerFilename = "documento.pdf";
    let viewerRequestId = 0;

    function revokeViewerBlob(): void {
        if (viewerBlobUrl) URL.revokeObjectURL(viewerBlobUrl);
        viewerBlobUrl = null;
    }

    async function descargar(path: string | null, filename: string): Promise<void> {
        if (!path) return;
        try {
            await downloadProtectedFile(`${BACKEND_URL}${path}`, filename);
        } catch (error) {
            showMessage(getErrorMessage(error), "error");
        }
    }

    async function abrirVisor(titulo: string, path: string): Promise<void> {
        const requestId = ++viewerRequestId;
        try {
            const blobUrl = await fetchBlobUrl(`${BACKEND_URL}${path}`);
            if (requestId !== viewerRequestId) {
                URL.revokeObjectURL(blobUrl);
                return;
            }
            revokeViewerBlob();
            viewerBlobUrl = blobUrl;
            viewerPath = path;
            viewerFilename = `${titulo}.pdf`;
            if (simulationDocumentTitle) simulationDocumentTitle.textContent = titulo;
            if (simulationDownload) {
                simulationDownload.href = "#";
                simulationDownload.hidden = false;
            }
            if (simulationPreviewFrame) simulationPreviewFrame.src = blobUrl;
            if (simulationViewer) {
                simulationViewer.hidden = false;
                simulationViewer.scrollIntoView({ behavior: "smooth" });
            }
        } catch (error) {
            if (requestId === viewerRequestId) {
                showMessage(getErrorMessage(error), "error");
            }
        }
    }

    simulationDownload?.addEventListener("click", (e) => {
        e.preventDefault();
        void descargar(viewerPath, viewerFilename);
    });

    function closeViewer(): void {
        viewerRequestId += 1;
        if (simulationPreviewFrame) simulationPreviewFrame.src = "about:blank";
        revokeViewerBlob();
        if (simulationViewer) simulationViewer.hidden = true;
        if (simulationEmptyState) simulationEmptyState.hidden = true;
    }

    async function loadDocuments(): Promise<void> {
        clearMessage();
        try {
            const response = await authorizedFetch(`${BACKEND_URL}/examenes-disponibles`);
            if (response.status === 401) return;

            if (!response.ok) {
                throw new Error("No se pudieron cargar los materiales disponibles.");
            }

            const data = await response.json();
            examenesList = data.examenes || [];

            const availableYears = sortYearsDesc(examenesList.map((e) => e.anio));

            populateSelect(simulationYear, availableYears, "Selecciona un año");
            if (simulationYear) simulationYear.disabled = availableYears.length === 0;
            populateSelect(simulationCourse, [], "Selecciona un curso");
            if (simulationCourse) simulationCourse.disabled = true;
            updateSelectedMaterial();

            if (availableYears.length === 0) {
                showMessage("No hay materiales PDF cargados actualmente.", "info");
            }
        } catch (error) {
            showMessage(getErrorMessage(error), "error");
        }
    }

    simulationYear?.addEventListener("change", updateCourseOptions);
    simulationCourse?.addEventListener("change", updateSelectedMaterial);

    return {
        loadDocuments,
        reset: () => {
            examenesList = [];
            closeViewer();
            if (simulationActions) simulationActions.hidden = true;
            clearMessage();
        }
    };
}
