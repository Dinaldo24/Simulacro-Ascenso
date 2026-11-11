import { BACKEND_URL, authorizedFetch, downloadProtectedFile, esGestorSession } from "./session.js";

function requireElement<T extends Element>(selector: string): T {
    const el = document.querySelector<T>(selector);
    if (!el) {
        throw new Error(`No se encontró el elemento requerido: ${selector}`);
    }
    return el;
}

export interface RepositoryDocument {
    id_documento: number;
    titulo: string;
    nombre_archivo: string;
    ruta_archivo: string;
    tipo_mime: string;
    tamano_bytes: number;
    subido_por: number;
    curso: string | null;
    anio: string | null;
    fecha_subida: string;
    subido_por_nombres: string;
    subido_por_apellidos: string;
    pagina_portada: number;
    portada_personalizada: boolean;
}

export interface RepositoryCallbacks {
    onPreview: (doc: RepositoryDocument) => void;
    onChangeCover?: (doc: RepositoryDocument) => void;
    onRename?: (doc: RepositoryDocument) => void;
    onDelete: (doc: RepositoryDocument, button: HTMLButtonElement) => void;
    onError: (message: string) => void;
    onCanManageChange: (canManage: boolean) => void;
}

function normalizeDocument(raw: any): RepositoryDocument {
    return {
        id_documento: Number(raw.id ?? raw.id_documento ?? 0),
        titulo: String(raw.titulo || raw.nombre || "Documento sin título"),
        nombre_archivo: String(raw.nombreArchivo || raw.nombre_archivo || "archivo.pdf"),
        ruta_archivo: String(raw.rutaArchivo || raw.ruta_archivo || ""),
        tipo_mime: String(raw.tipoMime || raw.tipo_mime || "application/pdf"),
        tamano_bytes: Number(raw.tamanoBytes ?? raw.tamano_bytes ?? 0),
        subido_por: Number(raw.subidoPor ?? raw.subido_por ?? 0),
        curso: raw.curso || null,
        anio: raw.anio || null,
        fecha_subida: raw.creadoEn || raw.fecha_subida || new Date().toISOString(),
        subido_por_nombres: raw.subido_por_nombres || "Administrador",
        subido_por_apellidos: raw.subido_por_apellidos || "",
        pagina_portada: raw.paginaPortada || raw.pagina_portada || 1,
        portada_personalizada: Boolean(raw.portada_personalizada)
    };
}

export function setupRepository(callbacks: RepositoryCallbacks) {
    const documentList = requireElement<HTMLTableSectionElement>("#document-list");
    const repositoryDocuments = new Map<string, RepositoryDocument>();
    let canManageRepository = esGestorSession();

    function createDocumentRow(item: RepositoryDocument): HTMLTableRowElement {
        repositoryDocuments.set(String(item.id_documento), item);

        const row = document.createElement("tr");
        row.className = "repo-row";

        // Columna 1: Ícono PDF
        const tdIcon = document.createElement("td");
        tdIcon.className = "col-icon";
        const iconBtn = document.createElement("button");
        iconBtn.type = "button";
        iconBtn.className = "pdf-file-icon";
        iconBtn.title = "Ver documento PDF";
        iconBtn.setAttribute("aria-label", `Vista previa de ${item.titulo}`);
        iconBtn.innerHTML = `
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#eef4fa" stroke="#12345a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M14 2v6h6" stroke="#12345a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                <text x="12" y="16.5" font-size="6.2" font-weight="800" fill="#12345a" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif">PDF</text>
            </svg>
        `;
        iconBtn.addEventListener("click", () => callbacks.onPreview(item));
        tdIcon.append(iconBtn);

        // Columna 2: Título y Nombre de Archivo
        const tdDoc = document.createElement("td");
        tdDoc.className = "col-doc";

        const docContainer = document.createElement("div");
        docContainer.className = "doc-info-cell";

        const titleBtn = document.createElement("button");
        titleBtn.className = "doc-title-link";
        titleBtn.type = "button";
        titleBtn.textContent = item.titulo;
        titleBtn.title = item.titulo;
        titleBtn.addEventListener("click", () => callbacks.onPreview(item));

        const filenameSpan = document.createElement("span");
        filenameSpan.className = "doc-filename-text";
        filenameSpan.textContent = item.nombre_archivo || "archivo.pdf";
        filenameSpan.title = item.nombre_archivo || "";

        docContainer.append(titleBtn, filenameSpan);
        tdDoc.append(docContainer);

        // Columna 3: Curso (Texto plano sin globo/borde)
        const tdCourse = document.createElement("td");
        tdCourse.className = "col-course";
        const courseSpan = document.createElement("span");
        courseSpan.className = "repo-text-plain repo-text-course";
        courseSpan.textContent = item.curso || "—";
        if (item.curso) courseSpan.title = item.curso;
        tdCourse.append(courseSpan);

        // Columna 4: Año (Texto plano sin globo/borde)
        const tdYear = document.createElement("td");
        tdYear.className = "col-year";
        const yearSpan = document.createElement("span");
        yearSpan.className = "repo-text-plain repo-text-year";
        yearSpan.textContent = item.anio || "—";
        tdYear.append(yearSpan);

        // Columna 5: Descargar (Columna propia para descarga)
        const tdDownload = document.createElement("td");
        tdDownload.className = "col-download";

        const btnDownload = document.createElement("a");
        btnDownload.className = "button button--primary button--sm repo-btn-download";
        btnDownload.href = "#";
        btnDownload.addEventListener("click", (event) => {
            event.preventDefault();
            void downloadProtectedFile(
                `${BACKEND_URL}/documentos/${encodeURIComponent(item.id_documento)}/descargar`,
                item.nombre_archivo || `${item.titulo}.pdf`,
            ).catch(() => {
                const msg = document.querySelector<HTMLElement>("#repository-message");
                if (msg) {
                    msg.textContent = "No se pudo descargar el documento.";
                    msg.className = "repository-alert repository-alert--error";
                    msg.hidden = false;
                }
            });
        });
        btnDownload.title = "Descargar archivo PDF";
        btnDownload.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Descargar</span>
        `;
        tdDownload.append(btnDownload);

        // Columna 6: Acciones (Íconos de Ojo, Lápiz y Tacho)
        const tdActions = document.createElement("td");
        tdActions.className = "col-actions";

        const actionsGroup = document.createElement("div");
        actionsGroup.className = "repo-actions-group";

        // 1. Ícono de Ojo (Ver)
        const btnView = document.createElement("button");
        btnView.className = "repo-icon-btn repo-icon-btn--view";
        btnView.type = "button";
        btnView.title = "Ver documento (Vista previa)";
        btnView.setAttribute("aria-label", `Vista previa de ${item.titulo}`);
        btnView.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            </svg>
        `;
        btnView.addEventListener("click", () => callbacks.onPreview(item));
        actionsGroup.append(btnView);

        // 2. Ícono de Lápiz (Editar título/nombre)
        if (canManageRepository && callbacks.onRename) {
            const btnEdit = document.createElement("button");
            btnEdit.className = "repo-icon-btn repo-icon-btn--edit";
            btnEdit.type = "button";
            btnEdit.title = "Editar título del documento";
            btnEdit.setAttribute("aria-label", `Editar título de ${item.titulo}`);
            btnEdit.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            `;
            btnEdit.addEventListener("click", () => callbacks.onRename!(item));
            actionsGroup.append(btnEdit);
        }

        // 3. Ícono de Tacho (Eliminar)
        if (canManageRepository) {
            const btnDelete = document.createElement("button");
            btnDelete.className = "repo-icon-btn repo-icon-btn--delete";
            btnDelete.type = "button";
            btnDelete.title = "Eliminar del repositorio";
            btnDelete.setAttribute("aria-label", `Eliminar ${item.titulo}`);
            btnDelete.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
            `;
            btnDelete.addEventListener("click", () => callbacks.onDelete(item, btnDelete));
            actionsGroup.append(btnDelete);
        }

        tdActions.append(actionsGroup);

        row.append(tdIcon, tdDoc, tdCourse, tdYear, tdDownload, tdActions);
        return row;
    }

    async function loadDocuments(): Promise<void> {
        documentList.replaceChildren();
        const loadingTr = document.createElement("tr");
        loadingTr.innerHTML = `<td colspan="6" class="repo-table-loading">Cargando documentos...</td>`;
        documentList.append(loadingTr);

        try {
            const response = await authorizedFetch(`${BACKEND_URL}/documentos`);
            if (response.status === 401) {
                documentList.replaceChildren();
                return;
            }

            if (!response.ok) {
                throw new Error("No se pudieron cargar los documentos del servidor.");
            }

            const rawData = await response.json();
            const docsArray = Array.isArray(rawData) ? rawData : (rawData.documents || []);
            const documents = docsArray.map(normalizeDocument);

            canManageRepository = esGestorSession();
            callbacks.onCanManageChange(canManageRepository);
            documentList.replaceChildren();
            repositoryDocuments.clear();

            if (documents.length === 0) {
                const emptyTr = document.createElement("tr");
                emptyTr.innerHTML = `<td colspan="6" class="repo-table-empty">Todavía no hay documentos PDF en el repositorio.</td>`;
                documentList.append(emptyTr);
                return;
            }

            documents.forEach((item: RepositoryDocument) => {
                documentList.append(createDocumentRow(item));
            });
        } catch (error) {
            documentList.replaceChildren();
            callbacks.onError(error instanceof Error ? error.message : "Error desconocido");
        }
    }

    return {
        loadDocuments,
        closeMenus: () => {}
    };
}
