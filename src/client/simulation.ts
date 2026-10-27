interface SimulationDocument {
    id_documento: string | number;
    titulo: string;
    curso: string | null;
    anio: string | null;
}

interface FilterableSimulationDocument extends SimulationDocument {
    curso: string;
    anio: string;
}

interface SimulationDocumentsResponse {
    documents: SimulationDocument[];
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

function isSimulationDocument(value: unknown): value is SimulationDocument {
    return isRecord(value) &&
        (typeof value.id_documento === "string" || typeof value.id_documento === "number") &&
        typeof value.titulo === "string" &&
        (typeof value.curso === "string" || value.curso === null) &&
        (typeof value.anio === "string" || value.anio === null);
}

function parseDocumentsResponse(payload: unknown): SimulationDocumentsResponse {
    if (!isRecord(payload) || !Array.isArray(payload.documents) ||
        !payload.documents.every(isSimulationDocument)) {
        throw new Error("El servidor devolvió una lista de documentos no válida.");
    }

    return { documents: payload.documents };
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

function getResponseMessage(payload: unknown, fallback: string): string {
    return isRecord(payload) && typeof payload.message === "string" && payload.message
        ? payload.message
        : fallback;
}

export function setupSimulation() {
    const simulationYear = requireElement<HTMLSelectElement>("#simulation-year");
    const simulationCourse = requireElement<HTMLSelectElement>("#simulation-course");
    const simulationDocumentFilter = requireElement<HTMLElement>("#simulation-document-filter");
    const simulationDocumentSelect = requireElement<HTMLSelectElement>("#simulation-document");
    const simulationMessage = requireElement<HTMLElement>("#simulation-message");
    const simulationViewer = requireElement<HTMLElement>("#simulation-viewer");
    const simulationDocumentTitle = requireElement<HTMLElement>("#simulation-document-title");
    const simulationDownload = requireElement<HTMLAnchorElement>("#simulation-download");
    const simulationPdfFrame = requireElement<HTMLIFrameElement>("#simulation-pdf-frame");
    let simulationDocuments: FilterableSimulationDocument[] = [];
    let simulationMatchingDocuments: SimulationDocument[] = [];
    let simulationQueryId = 0;

    function setSimulationMessage(message: string): void {
        simulationMessage.textContent = message;
        simulationMessage.hidden = false;
    }

    function resetSimulationSelect(select: HTMLSelectElement, placeholder: string): void {
        select.replaceChildren();
        const option = document.createElement("option");
        option.value = "";
        option.textContent = placeholder;
        select.append(option);
        select.value = "";
    }

    function closeSimulationDocument(): void {
        simulationViewer.hidden = true;
        simulationDocumentTitle.textContent = "";
        simulationDownload.removeAttribute("href");
        simulationPdfFrame.src = "about:blank";
    }

    async function loadSimulationDocuments(): Promise<void> {
        const queryId = ++simulationQueryId;
        simulationYear.disabled = true;
        simulationCourse.disabled = true;
        simulationDocumentSelect.disabled = true;
        simulationDocumentFilter.hidden = true;
        simulationDocuments = [];
        simulationMatchingDocuments = [];
        resetSimulationSelect(simulationYear, "Selecciona un año");
        resetSimulationSelect(simulationCourse, "Selecciona un curso");
        resetSimulationSelect(simulationDocumentSelect, "Selecciona un documento");
        closeSimulationDocument();
        setSimulationMessage("Cargando cursos y años...");

        try {
            const response = await fetch("/api/documentos");
            const payload: unknown = await response.json();

            if (!response.ok) {
                throw new Error(getResponseMessage(payload, "No se pudieron cargar los documentos."));
            }

            if (queryId !== simulationQueryId) {
                return;
            }

            const result = parseDocumentsResponse(payload);
            simulationDocuments = result.documents.filter(
                (item): item is FilterableSimulationDocument => Boolean(item.curso && item.anio)
            );
            const years = [...new Set(simulationDocuments.map((item) => item.anio))]
                .sort((left, right) => left.localeCompare(right, "es", { numeric: true }));

            years.forEach((year) => {
                const option = document.createElement("option");
                option.value = year;
                option.textContent = year;
                simulationYear.append(option);
            });

            simulationYear.disabled = years.length === 0;
            if (years.length === 0) {
                setSimulationMessage("Todavía no hay documentos asociados a un año y curso.");
                return;
            }

            simulationMessage.hidden = true;
        } catch (error) {
            if (queryId === simulationQueryId) {
                simulationDocuments = [];
                setSimulationMessage(getErrorMessage(error));
            }
        }
    }

    function updateSimulationCourses(): void {
        simulationQueryId += 1;
        simulationMatchingDocuments = [];
        const selectedYear = simulationYear.value;
        resetSimulationSelect(simulationCourse, "Selecciona un curso");
        resetSimulationSelect(simulationDocumentSelect, "Selecciona un documento");
        simulationDocumentFilter.hidden = true;
        simulationCourse.disabled = !selectedYear;
        simulationDocumentSelect.disabled = true;
        closeSimulationDocument();

        if (!selectedYear) {
            simulationMessage.hidden = true;
            return;
        }

        const courses = [...new Set(
            simulationDocuments
                .filter((item) => item.anio === selectedYear)
                .map((item) => item.curso)
        )].sort((left, right) => left.localeCompare(right, "es"));

        courses.forEach((course) => {
            const option = document.createElement("option");
            option.value = course;
            option.textContent = course;
            simulationCourse.append(option);
        });

        simulationCourse.disabled = courses.length === 0;
        setSimulationMessage(courses.length === 0
            ? "No hay cursos disponibles para el año seleccionado."
            : "Selecciona un curso para ver sus documentos.");
    }

    function showSimulationDocument(item: SimulationDocument): void {
        const documentId = encodeURIComponent(item.id_documento);
        const previewUrl = `/api/documentos/${documentId}/vista-previa`;
        simulationDocumentTitle.textContent = item.titulo;
        simulationDownload.href = `/api/documentos/${documentId}/descargar`;
        simulationPdfFrame.src = previewUrl;
        simulationViewer.hidden = false;
    }

    async function updateSimulationDocuments(): Promise<void> {
        const selectedYear = simulationYear.value;
        const selectedCourse = simulationCourse.value;
        resetSimulationSelect(simulationDocumentSelect, "Selecciona un documento");
        const queryId = ++simulationQueryId;
        simulationDocumentFilter.hidden = !selectedYear || !selectedCourse;
        simulationDocumentSelect.disabled = true;
        simulationMatchingDocuments = [];
        closeSimulationDocument();

        if (!selectedYear || !selectedCourse) {
            simulationMessage.hidden = true;
            return;
        }

        simulationMessage.hidden = false;
        setSimulationMessage("Buscando documentos para el año y curso seleccionados...");

        try {
            const search = new URLSearchParams({ anio: selectedYear, curso: selectedCourse });
            const response = await fetch(`/api/documentos?${search.toString()}`);
            const payload: unknown = await response.json();

            if (!response.ok) {
                throw new Error(getResponseMessage(payload, "No se pudieron buscar los documentos."));
            }

            if (queryId !== simulationQueryId) {
                return;
            }

            simulationMatchingDocuments = parseDocumentsResponse(payload).documents;

            simulationMatchingDocuments.forEach((item) => {
                const option = document.createElement("option");
                option.value = String(item.id_documento);
                option.textContent = item.titulo;
                simulationDocumentSelect.append(option);
            });

            simulationDocumentSelect.disabled = simulationMatchingDocuments.length === 0;

            if (simulationMatchingDocuments.length === 0) {
                setSimulationMessage("No hay documentos para el curso y año seleccionados.");
                return;
            }

            simulationMessage.hidden = true;
            simulationDocumentSelect.value = String(simulationMatchingDocuments[0].id_documento);
            showSimulationDocument(simulationMatchingDocuments[0]);
        } catch (error) {
            if (queryId === simulationQueryId) {
                setSimulationMessage(getErrorMessage(error));
            }
        }
    }

    simulationYear.addEventListener("change", updateSimulationCourses);
    simulationCourse.addEventListener("change", updateSimulationDocuments);
    simulationDocumentSelect.addEventListener("change", () => {
        const selectedDocument = simulationMatchingDocuments.find(
            (item) => String(item.id_documento) === simulationDocumentSelect.value
        );

        if (selectedDocument) {
            showSimulationDocument(selectedDocument);
            simulationMessage.hidden = true;
        } else {
            closeSimulationDocument();
        }
    });

    return {
        loadDocuments: loadSimulationDocuments,
        reset: () => {
            simulationQueryId += 1;
            simulationDocuments = [];
            simulationMatchingDocuments = [];
            closeSimulationDocument();
        }
    };
}
