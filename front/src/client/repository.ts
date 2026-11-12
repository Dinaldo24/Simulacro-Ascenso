import { BACKEND_URL, authorizedFetch, downloadProtectedFile, esGestorSession } from "./session.js";

function requireElement<T extends Element>(selector: string): T {
    const el = document.querySelector<T>(selector);
    if (!el) {
        throw new Error(`No se encontró el elemento requerido: ${selector}`);
    }
    return el;
}

export type PdfTipo = "preguntas" | "respuestas";

export interface RepositoryDocument {
    id_documento: number;
    titulo: string;
    nombre_archivo: string;
    ruta_archivo: string;
    tipo_mime: string;
    tamano_bytes: number;
    tiene_respuestas: boolean;
    respuestas_nombre_archivo: string | null;
    respuestas_tipo_mime: string | null;
    respuestas_tamano_bytes: number | null;
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
    onPreview: (doc: RepositoryDocument, tipo: PdfTipo) => void;
    onChangeCover?: (doc: RepositoryDocument) => void;
    onEdit?: (doc: RepositoryDocument, focusTarget?: PdfTipo) => void;
    onDelete: (doc: RepositoryDocument, button: HTMLButtonElement) => void;
    onError: (message: string) => void;
    onCanManageChange: (canManage: boolean) => void;
}

const EYE_ICON = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
    </svg>
`;

const DOWNLOAD_ICON = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
`;

function normalizeDocument(raw: any): RepositoryDocument {
    const respuestasNombre = raw.respuestas_nombre_archivo || raw.respuestasNombreOriginal || null;
    return {
        id_documento: Number(raw.id ?? raw.id_documento ?? 0),
        titulo: String(raw.titulo || raw.nombre || "Documento sin título"),
        nombre_archivo: String(raw.nombreArchivo || raw.nombre_archivo || "archivo.pdf"),
        ruta_archivo: String(raw.rutaArchivo || raw.ruta_archivo || ""),
        tipo_mime: String(raw.tipoMime || raw.tipo_mime || "application/pdf"),
        tamano_bytes: Number(raw.tamanoBytes ?? raw.tamano_bytes ?? 0),
        tiene_respuestas: Boolean(raw.tiene_respuestas ?? respuestasNombre),
        respuestas_nombre_archivo: respuestasNombre,
        respuestas_tipo_mime: raw.respuestas_tipo_mime || raw.respuestasTipoMime || null,
        respuestas_tamano_bytes: raw.respuestas_tamano_bytes != null
            ? Number(raw.respuestas_tamano_bytes)
            : raw.respuestasTamanio != null
                ? Number(raw.respuestasTamanio)
                : null,
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
    const actionsHeader = document.querySelector<HTMLTableCellElement>("#repo-col-actions-header");
    let canManageRepository = esGestorSession();

    function createPdfCell(options: {
        className: string;
        tipo: PdfTipo;
        titleText: string;
        filename: string;
        downloadFilename: string;
        item: RepositoryDocument;
    }): HTMLTableCellElement {
        const td = document.createElement("td");
        td.className = options.className;

        const cell = document.createElement("div");
        cell.className = "repo-pdf-cell";

        const meta = document.createElement("div");
        meta.className = "repo-pdf-meta";

        const titleBtn = document.createElement("button");
        titleBtn.className = "doc-title-link";
        titleBtn.type = "button";
        titleBtn.textContent = options.titleText;
        titleBtn.title = options.titleText;
        titleBtn.addEventListener("click", () => callbacks.onPreview(options.item, options.tipo));

        const filenameSpan = document.createElement("span");
        filenameSpan.className = "doc-filename-text";
        filenameSpan.textContent = options.filename;
        filenameSpan.title = options.filename;

        meta.append(titleBtn, filenameSpan);

        const actions = document.createElement("div");
        actions.className = "repo-pdf-actions";

        const viewBtn = document.createElement("button");
        viewBtn.className = "button button--secondary button--xs";
        viewBtn.type = "button";
        viewBtn.title = `Vista previa (${options.tipo === "respuestas" ? "hoja de respuestas" : "cuadernillo de preguntas"})`;
        viewBtn.setAttribute("aria-label", `Ver ${options.tipo} de ${options.item.titulo}`);
        viewBtn.innerHTML = `${EYE_ICON}<span>Ver</span>`;
        viewBtn.addEventListener("click", () => callbacks.onPreview(options.item, options.tipo));

        const downloadBtn = document.createElement("button");
        downloadBtn.className = "button button--primary button--xs";
        downloadBtn.type = "button";
        downloadBtn.title = `Descargar PDF (${options.tipo === "respuestas" ? "hoja de respuestas" : "cuadernillo de preguntas"})`;
        downloadBtn.setAttribute("aria-label", `Descargar ${options.tipo} de ${options.item.titulo}`);
        downloadBtn.innerHTML = `${DOWNLOAD_ICON}<span>Descargar</span>`;
        downloadBtn.addEventListener("click", () => {
            void downloadProtectedFile(
                `${BACKEND_URL}/documentos/${encodeURIComponent(options.item.id_documento)}/descargar?tipo=${options.tipo}`,
                options.downloadFilename,
            ).catch(() => {
                callbacks.onError("No se pudo descargar el documento.");
            });
        });

        actions.append(viewBtn, downloadBtn);
        cell.append(meta, actions);
        td.append(cell);
        return td;
    }

    function createEmptyRespuestasCell(item: RepositoryDocument): HTMLTableCellElement {
        const td = document.createElement("td");
        td.className = "col-pdf-respuestas";

        const emptyWrap = document.createElement("div");
        emptyWrap.className = "repo-pdf-empty";

        const muted = document.createElement("span");
        muted.className = "repo-pdf-missing";
        muted.textContent = "Sin archivo";
        emptyWrap.append(muted);

        if (canManageRepository && callbacks.onEdit) {
            const attachBtn = document.createElement("button");
            attachBtn.className = "button button--secondary button--xs";
            attachBtn.type = "button";
            attachBtn.textContent = "Adjuntar";
            attachBtn.title = "Adjuntar hoja de respuestas PDF";
            attachBtn.setAttribute("aria-label", `Adjuntar hoja de respuestas para ${item.titulo}`);
            attachBtn.addEventListener("click", () => callbacks.onEdit!(item, "respuestas"));
            emptyWrap.append(attachBtn);
        }

        td.append(emptyWrap);
        return td;
    }

    function createDocumentRow(item: RepositoryDocument): HTMLTableRowElement {
        const row = document.createElement("tr");
        row.className = "repo-row";

        const tdPreguntas = createPdfCell({
            className: "col-pdf-preguntas",
            tipo: "preguntas",
            titleText: item.titulo,
            filename: item.nombre_archivo || "preguntas.pdf",
            downloadFilename: item.nombre_archivo || `${item.titulo}_Preguntas.pdf`,
            item,
        });

        const tdRespuestas = item.tiene_respuestas
            ? createPdfCell({
                className: "col-pdf-respuestas",
                tipo: "respuestas",
                titleText: "Hoja de respuestas",
                filename: item.respuestas_nombre_archivo || "respuestas.pdf",
                downloadFilename: item.respuestas_nombre_archivo || `${item.titulo}_Respuestas.pdf`,
                item,
            })
            : createEmptyRespuestasCell(item);

        const tdCourse = document.createElement("td");
        tdCourse.className = "col-course";
        const courseSpan = document.createElement("span");
        courseSpan.className = "repo-text-plain repo-text-course";
        courseSpan.textContent = item.curso || "—";
        if (item.curso) courseSpan.title = item.curso;
        tdCourse.append(courseSpan);

        const tdYear = document.createElement("td");
        tdYear.className = "col-year";
        const yearSpan = document.createElement("span");
        yearSpan.className = "repo-text-plain repo-text-year";
        yearSpan.textContent = item.anio || "—";
        tdYear.append(yearSpan);

        row.append(tdPreguntas, tdRespuestas, tdCourse, tdYear);

        if (canManageRepository) {
            const tdActions = document.createElement("td");
            tdActions.className = "col-actions";

            const actionsGroup = document.createElement("div");
            actionsGroup.className = "repo-actions-group";

            if (callbacks.onEdit) {
                const btnEdit = document.createElement("button");
                btnEdit.className = "repo-icon-btn repo-icon-btn--edit";
                btnEdit.type = "button";
                btnEdit.title = "Editar documento y archivos PDF";
                btnEdit.setAttribute("aria-label", `Editar ${item.titulo}`);
                btnEdit.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                `;
                btnEdit.addEventListener("click", () => callbacks.onEdit!(item));
                actionsGroup.append(btnEdit);
            }

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

            tdActions.append(actionsGroup);
            row.append(tdActions);
        }

        return row;
    }

    async function loadDocuments(): Promise<void> {
        canManageRepository = esGestorSession();
        if (actionsHeader) {
            actionsHeader.hidden = !canManageRepository;
        }
        const colCount = canManageRepository ? 5 : 4;

        documentList.replaceChildren();
        const loadingTr = document.createElement("tr");
        loadingTr.innerHTML = `<td colspan="${colCount}" class="repo-table-loading">Cargando documentos...</td>`;
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
            if (actionsHeader) {
                actionsHeader.hidden = !canManageRepository;
            }
            callbacks.onCanManageChange(canManageRepository);
            documentList.replaceChildren();

            if (documents.length === 0) {
                const emptyTr = document.createElement("tr");
                emptyTr.innerHTML = `<td colspan="${canManageRepository ? 5 : 4}" class="repo-table-empty">Todavía no hay documentos PDF en el repositorio.</td>`;
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
