import { fetchEspecialidades, fillEspecialidadSelect } from "./especialidades.js";
import { BACKEND_URL, authorizedFetch, esGestorSession, fetchBlobUrl } from "./session.js";
import { populateSelect, sortYearsDesc } from "./year-select.js";

export interface PreguntaSimulador {
    anio: number | string;
    curso: string;
    numero: number;
    enunciado: string;
    alternativas: Record<string, string>;
    /** La clave no viene con las preguntas: se completa al verificar cada respuesta en el servidor. */
    correcta?: string;
    contexto?: string;
    /** Rutas (autenticadas) de las figuras recortadas del cuadernillo. */
    figuras?: string[];
}

export interface ExamenDisponible {
    anio: string;
    curso: string;
    tienePreguntasPdf: boolean;
    tieneRespuestasPdf: boolean;
    tieneJson: boolean;
    preguntasPdfUrl: string | null;
    respuestasPdfUrl: string | null;
    totalPreguntas: number;
}

function requireElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) {
        throw new Error(`No se encontró el elemento requerido: ${selector}`);
    }
    return element;
}

function setButtonLabel(button: HTMLButtonElement, text: string): void {
    const label = button.querySelector<HTMLElement>(".button-label");
    if (label) {
        label.textContent = text;
    } else {
        button.textContent = text;
    }
}

export function setupExamenes() {
    const anioSelect = requireElement<HTMLSelectElement>("#examenes-year");
    const cursoSelect = requireElement<HTMLSelectElement>("#examenes-course");
    const infoCard = requireElement<HTMLElement>("#examenes-info-card");
    const infoTitle = requireElement<HTMLElement>("#examenes-selected-title");
    const infoDesc = document.querySelector<HTMLElement>("#examenes-selected-desc");
    const btnSimulador = requireElement<HTMLButtonElement>("#examenes-btn-simulador");
    const btnEliminarExamen = document.querySelector<HTMLButtonElement>("#examenes-btn-eliminar");
    const message = requireElement<HTMLElement>("#examenes-message");

    // Componentes para la subida y desglose automático de exámenes
    const btnToggleSubir = document.querySelector<HTMLButtonElement>("#btn-toggle-subir-examen");
    const formSubir = document.querySelector<HTMLFormElement>("#form-subir-examen");
    const btnCancelarSubir = document.querySelector<HTMLButtonElement>("#btn-cancelar-subir-examen");
    const btnEnviarSubir = document.querySelector<HTMLButtonElement>("#btn-enviar-subir-examen");
    const loadingSubir = document.querySelector<HTMLElement>("#subir-examen-loading");

    function aplicarPermisosRol(): void {
        const gestor = esGestorSession();
        if (btnToggleSubir) btnToggleSubir.hidden = !gestor;
        if (formSubir && !gestor) formSubir.hidden = true;
        if (btnEliminarExamen) btnEliminarExamen.hidden = !gestor;
    }
    aplicarPermisosRol();

    // Simulador interactivo
    const simuladorContainer = requireElement<HTMLElement>("#examenes-simulador-container");
    const simuladorHeader = requireElement<HTMLElement>("#examenes-simulador-header");
    const simuladorQuestions = requireElement<HTMLElement>("#examenes-simulador-questions");
    const simuladorResultado = requireElement<HTMLElement>("#examenes-simulador-resultado");
    const btnReiniciar = requireElement<HTMLButtonElement>("#examenes-btn-reiniciar");
    const btnCerrarSimulador = requireElement<HTMLButtonElement>("#examenes-btn-cerrar-simulador");

    // Scoreboard en vivo
    const progressText = document.querySelector<HTMLElement>("#scoreboard-progress-text");
    const progressBar = document.querySelector<HTMLElement>("#scoreboard-progress-bar");
    const correctCountElem = document.querySelector<HTMLElement>("#scoreboard-correct-count");
    const incorrectCountElem = document.querySelector<HTMLElement>("#scoreboard-incorrect-count");

    let listaExamenes: ExamenDisponible[] = [];
    let examenSeleccionado: ExamenDisponible | null = null;
    let preguntasActuales: PreguntaSimulador[] = [];
    let respuestasUsuario: Record<number, string> = {};

    function showMessage(msg: string, type: "error" | "success" | "info"): void {
        message.textContent = msg;
        message.className = `repository-alert repository-alert--${type}`;
        message.hidden = false;
    }

    function clearMessage(): void {
        message.textContent = "";
        message.className = "repository-alert";
        message.hidden = true;
    }

    function updateCursos(): void {
        const selectedYear = anioSelect.value;
        const availableCursos = Array.from(
            new Set(
                listaExamenes
                    .filter((e) => !selectedYear || String(e.anio).trim() === selectedYear)
                    .map((e) => e.curso)
            )
        ).sort();

        populateSelect(cursoSelect, availableCursos, "Selecciona un curso");
        cursoSelect.disabled = availableCursos.length === 0;
        updateExamenInfo();
    }

    function updateExamenInfo(): void {
        const selectedYear = anioSelect.value;
        const selectedCourse = cursoSelect.value;

        examenSeleccionado = listaExamenes.find(
            (e) => String(e.anio).trim() === selectedYear && e.curso === selectedCourse
        ) || null;

        if (!examenSeleccionado) {
            infoCard.hidden = true;
            simuladorContainer.hidden = true;
            return;
        }

        infoTitle.textContent = `Examen de ${examenSeleccionado.curso} (${examenSeleccionado.anio})`;
        if (infoDesc) {
            infoDesc.textContent = examenSeleccionado.tieneJson && examenSeleccionado.totalPreguntas > 0
                ? `${examenSeleccionado.totalPreguntas} preguntas disponibles. Calificación inmediata y retroalimentación interactiva.`
                : "Este examen aún no cuenta con preguntas procesadas en el simulador.";
        }

        if (examenSeleccionado.tieneJson && examenSeleccionado.totalPreguntas > 0) {
            btnSimulador.disabled = false;
            setButtonLabel(btnSimulador, `Iniciar Examen (${examenSeleccionado.totalPreguntas} preguntas)`);
        } else {
            btnSimulador.disabled = true;
            setButtonLabel(btnSimulador, "Sin preguntas transcritas aún");
        }

        infoCard.hidden = false;
        simuladorContainer.hidden = true;
        if (btnEliminarExamen) btnEliminarExamen.hidden = !esGestorSession();
    }

    async function abrirSimulador(): Promise<void> {
        if (!examenSeleccionado) return;
        clearMessage();
        btnSimulador.disabled = true;
        setButtonLabel(btnSimulador, "Cargando examen...");

        try {
            const response = await authorizedFetch(
                `${BACKEND_URL}/examenes-disponibles/${encodeURIComponent(examenSeleccionado.anio)}/${encodeURIComponent(examenSeleccionado.curso)}/preguntas`
            );
            if (response.status === 401) return;

            if (!response.ok) {
                throw new Error("No se pudieron cargar las preguntas del examen.");
            }

            preguntasActuales = await response.json();
            iniciarIntento();

            simuladorContainer.hidden = false;
            simuladorResultado.hidden = true;
            simuladorContainer.scrollIntoView({ behavior: "smooth" });
        } catch (error) {
            showMessage(error instanceof Error ? error.message : "Error al abrir el simulador", "error");
        } finally {
            btnSimulador.disabled = false;
            if (examenSeleccionado) {
                setButtonLabel(btnSimulador, `Iniciar Examen (${examenSeleccionado.totalPreguntas} preguntas)`);
            }
        }
    }

    function iniciarIntento(): void {
        respuestasUsuario = {};
        actualizarScoreboard();
        renderSimuladorPreguntas();
        simuladorResultado.hidden = true;
    }

    function actualizarScoreboard(): void {
        const total = preguntasActuales.length;
        const contestadas = Object.keys(respuestasUsuario).length;

        let aciertos = 0;
        let desaciertos = 0;

        preguntasActuales.forEach((q) => {
            const resp = respuestasUsuario[q.numero];
            if (resp) {
                const letraCorrecta = (q.correcta || "").trim().toUpperCase();
                if (letraCorrecta) {
                    if (resp.trim().toUpperCase() === letraCorrecta) {
                        aciertos++;
                    } else {
                        desaciertos++;
                    }
                }
            }
        });

        if (progressText) {
            progressText.textContent = `${contestadas} / ${total} respondidas`;
        }
        if (progressBar) {
            const pct = total > 0 ? (contestadas / total) * 100 : 0;
            progressBar.style.width = `${pct}%`;
        }
        if (correctCountElem) {
            correctCountElem.textContent = String(aciertos);
        }
        if (incorrectCountElem) {
            incorrectCountElem.textContent = String(desaciertos);
        }

        if (total > 0 && contestadas === total) {
            mostrarResumenFinal(aciertos, desaciertos, total);
        }
    }

    function mostrarResumenFinal(aciertos: number, desaciertos: number, total: number): void {
        const tieneClave = preguntasActuales.some((q) => (q.correcta || "").trim() !== "");
        if (!tieneClave) {
            simuladorResultado.replaceChildren();
            const aviso = document.createElement("p");
            aviso.className = "simulador-result-desc";
            aviso.textContent =
                "Examen finalizado. Este examen no tiene clave de respuestas, por lo que no se calcula calificación ni se guarda en el historial.";
            simuladorResultado.append(aviso);
            simuladorResultado.hidden = false;
            simuladorResultado.scrollIntoView({ behavior: "smooth" });
            return;
        }
        const porcentaje = Math.round((aciertos / total) * 100);
        const nota = ((aciertos / total) * 20).toFixed(1);
        const esAprobado = porcentaje >= 60;

        simuladorResultado.replaceChildren();

        const title = document.createElement("h3");
        title.className = `simulador-result-title ${esAprobado ? "simulador-result-title--pass" : "simulador-result-title--retry"}`;
        title.textContent = esAprobado
            ? "Excelente desempeño: examen completado con éxito"
            : "Examen finalizado: continúa practicando";

        const desc = document.createElement("p");
        desc.className = "simulador-result-desc";
        desc.textContent = `Has obtenido ${aciertos} de ${total} preguntas correctas (${porcentaje}% de efectividad). Calificación equivalente: ${nota} / 20.`;

        const badgesContainer = document.createElement("div");
        badgesContainer.className = "simulador-summary-badges";

        const badgeAciertos = document.createElement("span");
        badgeAciertos.className = "badge badge--success";
        badgeAciertos.textContent = `${aciertos} Correctas`;

        const badgeErrores = document.createElement("span");
        badgeErrores.className = "badge badge--danger";
        badgeErrores.textContent = `${desaciertos} Incorrectas`;

        const badgeNota = document.createElement("span");
        badgeNota.className = `badge ${esAprobado ? "badge--success" : "badge--warning"}`;
        badgeNota.textContent = `Puntaje: ${nota} / 20 (${porcentaje}%)`;

        badgesContainer.append(badgeAciertos, badgeErrores, badgeNota);

        const actions = document.createElement("div");
        actions.className = "simulador-result-actions";

        const btnReintentar = document.createElement("button");
        btnReintentar.className = "button button--primary";
        btnReintentar.type = "button";
        btnReintentar.textContent = "Volver a practicar este examen";
        btnReintentar.addEventListener("click", () => {
            iniciarIntento();
            simuladorQuestions.scrollIntoView({ behavior: "smooth" });
        });

        actions.append(btnReintentar);
        simuladorResultado.append(title, desc, badgesContainer, actions);
        simuladorResultado.hidden = false;
        simuladorResultado.scrollIntoView({ behavior: "smooth" });

        // Guardar automáticamente el resultado en el historial de la base de datos
        if (examenSeleccionado) {
            void authorizedFetch(`${BACKEND_URL}/examenes-disponibles/historial`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    // El servidor califica: solo se envían las respuestas elegidas.
                    curso: examenSeleccionado.curso,
                    anio: examenSeleccionado.anio,
                    detalleRespuestas: respuestasUsuario,
                }),
            }).catch((err) => console.error("No se pudo guardar en historial:", err));
        }
    }

    async function responderPregunta(q: PreguntaSimulador, alternativaElegida: string, card: HTMLElement): Promise<void> {
        if (!examenSeleccionado) return;
        card.querySelectorAll<HTMLInputElement>("input[type=radio]").forEach((r) => {
            r.disabled = true;
        });
        try {
            const response = await authorizedFetch(
                `${BACKEND_URL}/examenes-disponibles/${encodeURIComponent(examenSeleccionado.anio)}/${encodeURIComponent(examenSeleccionado.curso)}/preguntas/${q.numero}/verificar`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ alternativa: alternativaElegida }),
                },
            );
            if (!response.ok) throw new Error("No se pudo verificar la respuesta.");
            const resultado = (await response.json()) as { correcta?: string };
            q.correcta = resultado.correcta ?? "";
        } catch (error) {
            card.querySelectorAll<HTMLInputElement>("input[type=radio]").forEach((r) => {
                r.disabled = false;
                r.checked = false;
            });
            showMessage(error instanceof Error ? error.message : "No se pudo verificar la respuesta.", "error");
            return;
        }
        mostrarResultadoPregunta(q, alternativaElegida, card);
    }

    function mostrarResultadoPregunta(q: PreguntaSimulador, alternativaElegida: string, card: HTMLElement): void {
        respuestasUsuario[q.numero] = alternativaElegida;
        const letraElegida = alternativaElegida.trim().toUpperCase();
        const letraCorrecta = (q.correcta || "").trim().toUpperCase();
        const tieneClave = letraCorrecta.length > 0;
        const esCorrecta = tieneClave && letraElegida === letraCorrecta;

        card.classList.remove("is-correct", "is-incorrect", "is-unanswered");
        if (!tieneClave) {
            card.classList.add("is-unanswered");
        } else if (esCorrecta) {
            card.classList.add("is-correct");
        } else {
            card.classList.add("is-incorrect");
        }

        const labels = card.querySelectorAll<HTMLLabelElement>(".simulador-option-label");
        labels.forEach((lbl) => {
            lbl.classList.add("is-locked");
            const radio = lbl.querySelector<HTMLInputElement>("input[type=radio]");
            if (radio) {
                radio.disabled = true;
                const radioVal = (radio.value || "").trim().toUpperCase();

                if (radioVal === letraElegida) {
                    if (!tieneClave) {
                        lbl.classList.add("opt-expected");
                    } else if (esCorrecta) {
                        lbl.classList.add("opt-correct");
                    } else {
                        lbl.classList.add("opt-incorrect");
                    }
                } else if (tieneClave && !esCorrecta && radioVal === letraCorrecta) {
                    lbl.classList.add("opt-expected");
                }
            }
        });

        const oldFeedback = card.querySelector(".simulador-feedback-box");
        if (oldFeedback) oldFeedback.remove();

        const feedbackBox = document.createElement("div");
        feedbackBox.className = `simulador-feedback-box ${
            !tieneClave
                ? "simulador-feedback-box--info"
                : esCorrecta
                ? "simulador-feedback-box--correct"
                : "simulador-feedback-box--incorrect"
        }`;

        const fbHeader = document.createElement("div");
        fbHeader.className = "simulador-feedback-header";

        const fbIcon = document.createElement("span");
        fbIcon.className = "simulador-feedback-icon";
        fbIcon.setAttribute("aria-hidden", "true");
        fbIcon.innerHTML = !tieneClave
            ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
            : esCorrecta
            ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
            : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

        const fbTitle = document.createElement("strong");
        fbTitle.textContent = !tieneClave
            ? "Respuesta registrada"
            : esCorrecta
            ? "¡Respuesta correcta!"
            : "Respuesta incorrecta";

        fbHeader.append(fbIcon, fbTitle);

        function cleanQuote(text: string): string {
            let t = (text || "").trim();
            if (t.startsWith('"') && t.endsWith('"') && t.length > 1) {
                t = t.substring(1, t.length - 1).trim();
            }
            return t;
        }

        function getTextoOpcion(op: string): string {
            if (!op || !q.alternativas) return "";
            const key = Object.keys(q.alternativas).find((k) => k.toUpperCase() === op.toUpperCase());
            return cleanQuote(key ? q.alternativas[key] : (q.alternativas[op] || ""));
        }

        function appendFeedbackRow(container: HTMLElement, className: string, label: string, value: string): void {
            const row = document.createElement("div");
            row.className = className;
            const strong = document.createElement("strong");
            strong.textContent = label;
            row.append(strong, document.createTextNode(` ${value}`));
            container.append(row);
        }

        const fbText = document.createElement("div");
        fbText.className = "simulador-feedback-text";

        if (!tieneClave) {
            const textoElegido = getTextoOpcion(letraElegida);
            appendFeedbackRow(fbText, "simulador-feedback-row", "Tu respuesta:", `Opción ${letraElegida}: ${textoElegido}`);
            const note = document.createElement("div");
            note.className = "simulador-feedback-note";
            note.textContent = "Nota: Este examen aún no cuenta con clave oficial registrada para verificar automáticamente la respuesta.";
            fbText.append(note);
        } else if (esCorrecta) {
            const textoCorrecto = getTextoOpcion(letraCorrecta);
            appendFeedbackRow(fbText, "simulador-feedback-row", `Opción ${letraCorrecta}:`, textoCorrecto);
        } else {
            const textoElegido = getTextoOpcion(letraElegida);
            const textoCorrecto = getTextoOpcion(letraCorrecta);
            appendFeedbackRow(fbText, "simulador-feedback-row", "Tu respuesta:", `Opción ${letraElegida}: ${textoElegido}`);
            appendFeedbackRow(fbText, "simulador-feedback-correct", "Respuesta correcta:", `Opción ${letraCorrecta}: ${textoCorrecto}`);
        }

        feedbackBox.append(fbHeader, fbText);
        card.append(feedbackBox);
        actualizarScoreboard();
    }

    let figureBlobUrls: string[] = [];

    function crearFiguras(q: PreguntaSimulador): HTMLElement | null {
        if (!q.figuras || q.figuras.length === 0) return null;
        const box = document.createElement("div");
        box.className = "simulador-figures";
        q.figuras.forEach((ruta, i) => {
            const img = document.createElement("img");
            img.className = "simulador-figure";
            img.alt = `Figura ${i + 1} de la pregunta ${q.numero}`;
            img.loading = "lazy";
            box.append(img);
            fetchBlobUrl(`${BACKEND_URL}${ruta}`)
                .then((url) => {
                    figureBlobUrls.push(url);
                    img.src = url;
                })
                .catch(() => {
                    img.replaceWith(document.createTextNode("No se pudo cargar la figura."));
                });
        });
        return box;
    }

    function renderSimuladorPreguntas(): void {
        if (!examenSeleccionado) return;
        simuladorHeader.textContent = `Simulador: ${examenSeleccionado.curso} - Año ${examenSeleccionado.anio}`;
        simuladorQuestions.replaceChildren();
        figureBlobUrls.forEach((url) => URL.revokeObjectURL(url));
        figureBlobUrls = [];

        preguntasActuales.forEach((q) => {
            const card = document.createElement("article");
            card.className = "simulador-question-card";
            card.id = `pregunta-card-${q.numero}`;

            const qNum = document.createElement("span");
            qNum.className = "simulador-question-number";
            qNum.textContent = `Pregunta ${q.numero} de ${preguntasActuales.length}`;

            // Contexto compartido / escenario si existe
            if (q.contexto) {
                const ctxBox = document.createElement("div");
                ctxBox.className = "simulador-context-box";

                const ctxTag = document.createElement("span");
                ctxTag.className = "simulador-context-tag";
                ctxTag.textContent = "Situación / Contexto de la pregunta";

                const ctxText = document.createElement("p");
                ctxText.className = "simulador-context-text";
                ctxText.textContent = q.contexto;

                ctxBox.append(ctxTag, ctxText);
                card.append(ctxBox);
            }

            const qText = document.createElement("p");
            qText.className = "simulador-question-text";
            qText.textContent = q.enunciado;

            const optsContainer = document.createElement("div");
            optsContainer.className = "simulador-options";

            const letras = Object.keys(q.alternativas).sort();
            letras.forEach((letra) => {
                const optLabel = document.createElement("label");
                optLabel.className = "simulador-option-label";

                const radio = document.createElement("input");
                radio.type = "radio";
                radio.name = `pregunta_${q.numero}`;
                radio.value = letra;

                radio.addEventListener("change", () => {
                    if (radio.checked && !respuestasUsuario[q.numero]) {
                        void responderPregunta(q, letra, card);
                    }
                });

                const letterBadge = document.createElement("span");
                letterBadge.className = "simulador-option-badge";
                letterBadge.textContent = letra;

                const textSpan = document.createElement("span");
                textSpan.className = "simulador-option-text";
                textSpan.textContent = q.alternativas[letra] || "";

                optLabel.append(radio, letterBadge, textSpan);
                optsContainer.append(optLabel);
            });

            const figuras = crearFiguras(q);
            if (figuras) {
                card.append(qNum, qText, figuras, optsContainer);
            } else {
                card.append(qNum, qText, optsContainer);
            }
            simuladorQuestions.append(card);
        });
    }

    async function loadExamenes(preselectAnio?: string, preselectCurso?: string): Promise<void> {
        clearMessage();
        try {
            const response = await authorizedFetch(`${BACKEND_URL}/examenes-disponibles`);
            if (response.status === 401) return;

            if (!response.ok) {
                throw new Error("No se pudo cargar la lista de exámenes disponibles.");
            }

            const data = await response.json();
            listaExamenes = data.examenes || [];
            aplicarPermisosRol();

            const anios = sortYearsDesc(listaExamenes.map((e) => e.anio));

            populateSelect(anioSelect, anios, "Selecciona un año");
            anioSelect.disabled = anios.length === 0;

            const targetAnio = preselectAnio?.trim();
            if (targetAnio && anios.includes(targetAnio)) {
                anioSelect.value = targetAnio;
                updateCursos();
                if (preselectCurso) {
                    cursoSelect.value = preselectCurso;
                    updateExamenInfo();
                }
            } else {
                populateSelect(cursoSelect, [], "Selecciona un año primero");
                cursoSelect.disabled = true;
                updateExamenInfo();
            }
        } catch (error) {
            showMessage(error instanceof Error ? error.message : "Error al cargar exámenes", "error");
        }
    }

    async function handleSubirExamen(event: Event): Promise<void> {
        event.preventDefault();
        if (!formSubir) return;

        const formData = new FormData(formSubir);
        const anio = String(formData.get("anio") || "").trim();
        const especialidadSelect = formSubir.querySelector<HTMLSelectElement>("#subir-examen-curso");
        const especialidadId = String(formData.get("especialidadId") || "").trim();
        const curso = especialidadSelect?.selectedOptions[0]?.textContent?.trim() ?? "";

        if (!anio || !especialidadId) {
            showMessage("El año y la especialidad son requeridos.", "error");
            return;
        }

        clearMessage();
        if (loadingSubir) loadingSubir.hidden = false;
        if (btnEnviarSubir) btnEnviarSubir.disabled = true;

        try {
            const response = await authorizedFetch(`${BACKEND_URL}/examenes-disponibles/subir`, {
                method: "POST",
                body: formData
            });
            if (response.status === 401) return;

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.mensaje || "Error al procesar el examen.");
            }

            formSubir.reset();
            formSubir.hidden = true;
            showMessage(result.mensaje || "¡Examen desglosado con éxito!", "success");

            // Recargar lista y seleccionar automáticamente el nuevo examen
            await loadExamenes(anio, curso);
        } catch (error) {
            showMessage(error instanceof Error ? error.message : "Error al subir y desglosar el examen", "error");
        } finally {
            if (loadingSubir) loadingSubir.hidden = true;
            if (btnEnviarSubir) btnEnviarSubir.disabled = false;
        }
    }

    // Listeners
    anioSelect.addEventListener("change", updateCursos);
    cursoSelect.addEventListener("change", updateExamenInfo);
    btnSimulador.addEventListener("click", () => void abrirSimulador());

    btnEliminarExamen?.addEventListener("click", async () => {
        if (!examenSeleccionado) return;
        const confirmacion = window.confirm(
            `¿Seguro que deseas eliminar el examen de ${examenSeleccionado.curso} (${examenSeleccionado.anio}) y todas sus preguntas desglosadas? Esta acción no se puede deshacer.`
        );
        if (!confirmacion) return;

        try {
            btnEliminarExamen.disabled = true;
            setButtonLabel(btnEliminarExamen, "Eliminando...");

            const response = await authorizedFetch(
                `${BACKEND_URL}/examenes-disponibles/${encodeURIComponent(examenSeleccionado.anio)}/${encodeURIComponent(examenSeleccionado.curso)}`,
                {
                    method: "DELETE"
                }
            );
            if (response.status === 401) return;

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.mensaje || "No se pudo eliminar el examen.");
            }

            showMessage(`El examen de ${examenSeleccionado.curso} (${examenSeleccionado.anio}) y sus preguntas han sido eliminados por completo.`, "success");
            examenSeleccionado = null;
            infoCard.hidden = true;
            simuladorContainer.hidden = true;
            await loadExamenes();
        } catch (error) {
            showMessage(error instanceof Error ? error.message : "Error al eliminar el examen.", "error");
        } finally {
            if (btnEliminarExamen) {
                btnEliminarExamen.disabled = false;
                setButtonLabel(btnEliminarExamen, "Eliminar Examen");
            }
        }
    });

    btnReiniciar.addEventListener("click", () => {
        iniciarIntento();
        simuladorQuestions.scrollIntoView({ behavior: "smooth" });
    });

    btnCerrarSimulador.addEventListener("click", () => {
        simuladorContainer.hidden = true;
        infoCard.hidden = false;
        infoCard.scrollIntoView({ behavior: "smooth" });
    });

    async function cargarEspecialidadesSubida(): Promise<void> {
        const select = formSubir?.querySelector<HTMLSelectElement>("#subir-examen-curso");
        if (!select) return;
        try {
            fillEspecialidadSelect(select, await fetchEspecialidades(), "Selecciona una especialidad");
        } catch (error) {
            showMessage(error instanceof Error ? error.message : "No se pudieron cargar las especialidades.", "error");
        }
    }

    btnToggleSubir?.addEventListener("click", () => {
        void cargarEspecialidadesSubida();
        if (!formSubir) return;
        formSubir.hidden = !formSubir.hidden;
        btnToggleSubir.setAttribute("aria-expanded", String(!formSubir.hidden));
        if (!formSubir.hidden) {
            formSubir.scrollIntoView({ behavior: "smooth" });
        }
    });

    btnCancelarSubir?.addEventListener("click", () => {
        if (!formSubir) return;
        formSubir.reset();
        formSubir.hidden = true;
        btnToggleSubir?.setAttribute("aria-expanded", "false");
    });

    formSubir?.addEventListener("submit", (e) => void handleSubirExamen(e));

    return {
        loadExamenes,
        reset: () => {
            listaExamenes = [];
            examenSeleccionado = null;
            preguntasActuales = [];
            respuestasUsuario = {};
            infoCard.hidden = true;
            simuladorContainer.hidden = true;
            if (formSubir) {
                formSubir.reset();
                formSubir.hidden = true;
            }
            clearMessage();
        }
    };
}
