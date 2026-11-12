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
    /** Mapa de letra de alternativa ("A".."E") -> ruta autenticada de su figura. */
    figurasAlternativas?: Record<string, string>;
}

export interface ResultadoFinalizacionApi {
    tieneClave: boolean;
    totalPreguntas: number;
    aciertos: number;
    desaciertos: number;
    sinResponder: number;
    puntaje: number;
    claves: Record<string, string>;
    intentoId: number | null;
}

const RE_PLACEHOLDER_FIG_ALT = /^\(Ver imagen:\s*Alternativa\s+[A-E]\)$/i;

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

export interface ExamenesCallbacks {
    onSyncChange?: () => void;
}

export function setupExamenes(callbacks?: ExamenesCallbacks) {
    const anioSelect = requireElement<HTMLSelectElement>("#examenes-year");
    const cursoSelect = requireElement<HTMLSelectElement>("#examenes-course");
    const infoCard = requireElement<HTMLElement>("#examenes-info-card");
    const infoTitle = requireElement<HTMLElement>("#examenes-selected-title");
    const infoDesc = document.querySelector<HTMLElement>("#examenes-selected-desc");
    const btnSimulador = requireElement<HTMLButtonElement>("#examenes-btn-simulador");
    const btnEliminarExamen = document.querySelector<HTMLButtonElement>("#examenes-btn-eliminar");
    const message = requireElement<HTMLElement>("#examenes-message");

    function aplicarPermisosRol(): void {
        const gestor = esGestorSession();
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
    const footerActions = document.querySelector<HTMLElement>("#simulador-footer-actions");
    const footerStatus = document.querySelector<HTMLElement>("#simulador-footer-status");
    const btnFinalizar = document.querySelector<HTMLButtonElement>("#examenes-btn-finalizar");
    const btnVerResumen = document.querySelector<HTMLButtonElement>("#examenes-btn-ver-resumen");

    // Scoreboard en vivo
    const progressText = document.querySelector<HTMLElement>("#scoreboard-progress-text");
    const progressBar = document.querySelector<HTMLElement>("#scoreboard-progress-bar");
    const scoreboardStats = document.querySelector<HTMLElement>("#scoreboard-stats");
    const correctCountElem = document.querySelector<HTMLElement>("#scoreboard-correct-count");
    const incorrectCountElem = document.querySelector<HTMLElement>("#scoreboard-incorrect-count");

    let listaExamenes: ExamenDisponible[] = [];
    let examenSeleccionado: ExamenDisponible | null = null;
    let preguntasActuales: PreguntaSimulador[] = [];
    let respuestasUsuario: Record<number, string> = {};
    let simulacroFinalizado = false;
    let calificandoSimulacro = false;
    let inicioSimulacroMs = Date.now();
    let resultadoFinalServidor: ResultadoFinalizacionApi | null = null;

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
        simulacroFinalizado = false;
        calificandoSimulacro = false;
        inicioSimulacroMs = Date.now();
        resultadoFinalServidor = null;
        preguntasActuales.forEach((q) => {
            delete q.correcta;
        });
        respuestasUsuario = {};
        if (scoreboardStats) scoreboardStats.hidden = true;
        if (footerActions) footerActions.hidden = preguntasActuales.length === 0;
        if (btnVerResumen) btnVerResumen.hidden = true;
        if (btnFinalizar) {
            btnFinalizar.hidden = false;
            btnFinalizar.disabled = false;
            setButtonLabel(btnFinalizar, "Finalizar simulacro");
        }
        actualizarScoreboard();
        renderSimuladorPreguntas();
        simuladorResultado.hidden = true;
    }

    function actualizarScoreboard(): void {
        const total = preguntasActuales.length;
        const contestadas = Object.keys(respuestasUsuario).length;

        if (progressText) {
            progressText.textContent = `${contestadas} / ${total} respondidas`;
        }
        if (progressBar) {
            const pct = total > 0 ? (contestadas / total) * 100 : 0;
            progressBar.style.width = `${pct}%`;
        }
        if (footerStatus) {
            if (simulacroFinalizado) {
                footerStatus.textContent = resultadoFinalServidor?.tieneClave
                    ? `Simulacro finalizado: ${resultadoFinalServidor.aciertos} correctas de ${resultadoFinalServidor.totalPreguntas} (Nota: ${resultadoFinalServidor.puntaje.toFixed(1)} / 20)`
                    : "Simulacro finalizado (este examen no tiene clave oficial registrada).";
            } else {
                footerStatus.textContent = total > 0 && contestadas === total
                    ? `Todas las ${total} preguntas respondidas. Listo para finalizar.`
                    : `${contestadas} / ${total} respondidas`;
            }
        }

        if (!simulacroFinalizado || !resultadoFinalServidor?.tieneClave) {
            if (scoreboardStats) scoreboardStats.hidden = true;
            return;
        }

        if (scoreboardStats) scoreboardStats.hidden = false;
        if (correctCountElem) {
            correctCountElem.textContent = String(resultadoFinalServidor.aciertos);
        }
        if (incorrectCountElem) {
            incorrectCountElem.textContent = String(resultadoFinalServidor.desaciertos);
        }
    }

    function mostrarResumenFinal(res: ResultadoFinalizacionApi): void {
        if (!res.tieneClave) {
            simuladorResultado.replaceChildren();
            const aviso = document.createElement("p");
            aviso.className = "simulador-result-desc";
            aviso.textContent =
                "Simulacro finalizado. Este examen aún no tiene clave oficial de respuestas, por lo que no se calcula calificación ni se guarda en el historial.";
            simuladorResultado.append(aviso);
            simuladorResultado.hidden = false;
            simuladorResultado.scrollIntoView({ behavior: "smooth" });
            return;
        }

        const total = res.totalPreguntas;
        const porcentaje = total > 0 ? Math.round((res.aciertos / total) * 100) : 0;
        const nota = res.puntaje.toFixed(1);
        const esAprobado = porcentaje >= 60;

        simuladorResultado.replaceChildren();

        const title = document.createElement("h3");
        title.className = `simulador-result-title ${esAprobado ? "simulador-result-title--pass" : "simulador-result-title--retry"}`;
        title.textContent = esAprobado
            ? "Excelente desempeño: simulacro completado con éxito"
            : "Simulacro finalizado: revisa tus respuestas abajo";

        const desc = document.createElement("p");
        desc.className = "simulador-result-desc";
        desc.textContent = `Has obtenido ${res.aciertos} de ${total} preguntas correctas (${porcentaje}% de efectividad). Calificación equivalente: ${nota} / 20.`;

        const badgesContainer = document.createElement("div");
        badgesContainer.className = "simulador-summary-badges";

        const badgeAciertos = document.createElement("span");
        badgeAciertos.className = "badge badge--success";
        badgeAciertos.textContent = `${res.aciertos} Correctas`;

        const badgeErrores = document.createElement("span");
        badgeErrores.className = "badge badge--danger";
        badgeErrores.textContent = `${res.desaciertos} Incorrectas`;

        badgesContainer.append(badgeAciertos, badgeErrores);

        if (res.sinResponder > 0) {
            const badgeSinResp = document.createElement("span");
            badgeSinResp.className = "badge badge--warning";
            badgeSinResp.textContent = `${res.sinResponder} Sin responder`;
            badgesContainer.append(badgeSinResp);
        }

        const badgeNota = document.createElement("span");
        badgeNota.className = `badge ${esAprobado ? "badge--success" : "badge--warning"}`;
        badgeNota.textContent = `Puntaje: ${nota} / 20 (${porcentaje}%)`;
        badgesContainer.append(badgeNota);

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
    }

    function seleccionarAlternativa(q: PreguntaSimulador, alternativaElegida: string, card: HTMLElement): void {
        if (simulacroFinalizado || calificandoSimulacro) return;
        respuestasUsuario[q.numero] = alternativaElegida;
        card.classList.add("is-answered");
        card.querySelectorAll<HTMLLabelElement>(".simulador-option-label").forEach((lbl) => {
            const radio = lbl.querySelector<HTMLInputElement>("input[type=radio]");
            lbl.classList.toggle("is-selected", Boolean(radio && radio.value === alternativaElegida));
        });
        actualizarScoreboard();
    }

    async function finalizarSimulacroActual(): Promise<void> {
        if (!examenSeleccionado || simulacroFinalizado || calificandoSimulacro) return;
        const total = preguntasActuales.length;
        const contestadas = Object.keys(respuestasUsuario).length;
        if (total === 0) return;

        if (contestadas === 0) {
            showMessage("Marca al menos una respuesta antes de finalizar el simulacro.", "info");
            return;
        }
        if (contestadas < total) {
            const confirmar = window.confirm(
                `Has respondido ${contestadas} de ${total} preguntas. ¿Deseas finalizar y calificar el simulacro ahora?`,
            );
            if (!confirmar) return;
        }

        clearMessage();
        calificandoSimulacro = true;
        if (btnFinalizar) {
            btnFinalizar.disabled = true;
            setButtonLabel(btnFinalizar, "Calificando simulacro...");
        }

        try {
            const tiempoSegundos = Math.max(0, Math.round((Date.now() - inicioSimulacroMs) / 1000));
            const response = await authorizedFetch(
                `${BACKEND_URL}/examenes-disponibles/${encodeURIComponent(examenSeleccionado.anio)}/${encodeURIComponent(examenSeleccionado.curso)}/finalizar`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        tiempoSegundos,
                        detalleRespuestas: respuestasUsuario,
                    }),
                },
            );
            if (response.status === 401) return;
            if (!response.ok) {
                throw new Error("No se pudo calificar el simulacro. Inténtalo nuevamente.");
            }

            const resultado = (await response.json()) as ResultadoFinalizacionApi;
            simulacroFinalizado = true;
            resultadoFinalServidor = resultado;

            preguntasActuales.forEach((q) => {
                q.correcta = resultado.claves?.[String(q.numero)] ?? "";
                const card = document.getElementById(`pregunta-card-${q.numero}`);
                if (card) {
                    mostrarResultadoPregunta(q, respuestasUsuario[q.numero] || "", card);
                }
            });

            if (btnFinalizar) btnFinalizar.hidden = true;
            if (btnVerResumen) btnVerResumen.hidden = false;
            actualizarScoreboard();
            mostrarResumenFinal(resultado);
        } catch (error) {
            showMessage(error instanceof Error ? error.message : "No se pudo finalizar el simulacro.", "error");
            if (btnFinalizar) {
                btnFinalizar.disabled = false;
                setButtonLabel(btnFinalizar, "Finalizar simulacro");
            }
        } finally {
            calificandoSimulacro = false;
        }
    }

    function mostrarResultadoPregunta(q: PreguntaSimulador, alternativaElegida: string, card: HTMLElement): void {
        const letraElegida = alternativaElegida.trim().toUpperCase();
        const letraCorrecta = (q.correcta || "").trim().toUpperCase();
        const tieneClave = letraCorrecta.length > 0;
        const respondida = letraElegida.length > 0;
        const esCorrecta = tieneClave && respondida && letraElegida === letraCorrecta;

        card.classList.remove("is-answered", "is-correct", "is-incorrect", "is-unanswered");
        if (!tieneClave || !respondida) {
            card.classList.add("is-unanswered");
        } else if (esCorrecta) {
            card.classList.add("is-correct");
        } else {
            card.classList.add("is-incorrect");
        }

        const labels = card.querySelectorAll<HTMLLabelElement>(".simulador-option-label");
        labels.forEach((lbl) => {
            lbl.classList.remove("is-selected", "opt-correct", "opt-incorrect", "opt-expected");
            lbl.classList.add("is-locked");
            const radio = lbl.querySelector<HTMLInputElement>("input[type=radio]");
            if (radio) {
                radio.disabled = true;
                const radioVal = (radio.value || "").trim().toUpperCase();

                if (respondida && radioVal === letraElegida) {
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
                : !respondida
                ? "simulador-feedback-box--unanswered"
                : esCorrecta
                ? "simulador-feedback-box--correct"
                : "simulador-feedback-box--incorrect"
        }`;

        const fbHeader = document.createElement("div");
        fbHeader.className = "simulador-feedback-header";

        const fbIcon = document.createElement("span");
        fbIcon.className = "simulador-feedback-icon";
        fbIcon.setAttribute("aria-hidden", "true");
        fbIcon.innerHTML = !tieneClave || !respondida
            ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
            : esCorrecta
            ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
            : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

        const fbTitle = document.createElement("strong");
        fbTitle.textContent = !tieneClave
            ? respondida
                ? "Respuesta registrada"
                : "Pregunta sin responder"
            : !respondida
            ? "Pregunta sin responder"
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

        function formatOpcionResumen(op: string, conPrefijoOpcion: boolean): string {
            const texto = getTextoOpcion(op);
            const esGrafica = !texto || RE_PLACEHOLDER_FIG_ALT.test(texto);
            if (!conPrefijoOpcion) {
                return esGrafica ? "Alternativa gráfica" : texto;
            }
            return esGrafica ? `Opción ${op} (imagen)` : `Opción ${op}: ${texto}`;
        }

        if (!tieneClave) {
            if (respondida) {
                appendFeedbackRow(fbText, "simulador-feedback-row", "Tu respuesta:", formatOpcionResumen(letraElegida, true));
            }
            const note = document.createElement("div");
            note.className = "simulador-feedback-note";
            note.textContent = "Nota: Este examen aún no cuenta con clave oficial registrada para verificar automáticamente la respuesta.";
            fbText.append(note);
        } else if (!respondida) {
            appendFeedbackRow(fbText, "simulador-feedback-correct", "Respuesta correcta:", formatOpcionResumen(letraCorrecta, true));
        } else if (esCorrecta) {
            appendFeedbackRow(fbText, "simulador-feedback-row", `Opción ${letraCorrecta}:`, formatOpcionResumen(letraCorrecta, false));
        } else {
            appendFeedbackRow(fbText, "simulador-feedback-row", "Tu respuesta:", formatOpcionResumen(letraElegida, true));
            appendFeedbackRow(fbText, "simulador-feedback-correct", "Respuesta correcta:", formatOpcionResumen(letraCorrecta, true));
        }

        feedbackBox.append(fbHeader, fbText);
        card.append(feedbackBox);
    }

    let figureBlobUrls: string[] = [];

    function cargarImagenFigura(ruta: string, alt: string, className: string, errorText: string): HTMLImageElement {
        const img = document.createElement("img");
        img.className = className;
        img.alt = alt;
        img.loading = "lazy";
        fetchBlobUrl(`${BACKEND_URL}${ruta}`)
            .then((url) => {
                figureBlobUrls.push(url);
                img.src = url;
            })
            .catch(() => {
                img.replaceWith(document.createTextNode(errorText));
            });
        return img;
    }

    function obtenerRutaFiguraAlternativa(q: PreguntaSimulador, letra: string): string | undefined {
        const mapa = q.figurasAlternativas;
        if (!mapa) return undefined;
        if (mapa[letra]) return mapa[letra];
        const encontrada = Object.entries(mapa).find(([k]) => k.toUpperCase() === letra.toUpperCase());
        return encontrada?.[1];
    }

    function crearFiguras(q: PreguntaSimulador): HTMLElement | null {
        if (!q.figuras || q.figuras.length === 0) return null;
        const box = document.createElement("div");
        box.className = "simulador-figures";
        q.figuras.forEach((ruta, i) => {
            box.append(
                cargarImagenFigura(
                    ruta,
                    `Figura ${i + 1} de la pregunta ${q.numero}`,
                    "simulador-figure",
                    "No se pudo cargar la figura.",
                ),
            );
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
                    if (radio.checked) {
                        seleccionarAlternativa(q, letra, card);
                    }
                });

                const letterBadge = document.createElement("span");
                letterBadge.className = "simulador-option-badge";
                letterBadge.textContent = letra;

                const rutaFigAlt = obtenerRutaFiguraAlternativa(q, letra);
                const textoOpcion = (q.alternativas[letra] || "").trim();

                if (rutaFigAlt) {
                    optLabel.classList.add("is-visual");
                    const contentWrap = document.createElement("span");
                    contentWrap.className = "simulador-option-content";
                    if (textoOpcion && !RE_PLACEHOLDER_FIG_ALT.test(textoOpcion)) {
                        const textSpan = document.createElement("span");
                        textSpan.className = "simulador-option-text";
                        textSpan.textContent = textoOpcion;
                        contentWrap.append(textSpan);
                    }
                    contentWrap.append(
                        cargarImagenFigura(
                            rutaFigAlt,
                            `Alternativa ${letra} de la pregunta ${q.numero}`,
                            "simulador-option-figure",
                            `No se pudo cargar la figura de la alternativa ${letra}.`,
                        ),
                    );
                    optLabel.append(radio, letterBadge, contentWrap);
                } else {
                    const textSpan = document.createElement("span");
                    textSpan.className = "simulador-option-text";
                    textSpan.textContent = q.alternativas[letra] || "";
                    optLabel.append(radio, letterBadge, textSpan);
                }
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
                    const matchingCourse = Array.from(cursoSelect.options).find(
                        (opt) => opt.value.trim().toLowerCase() === preselectCurso.trim().toLowerCase()
                    );
                    if (matchingCourse) {
                        cursoSelect.value = matchingCourse.value;
                        updateExamenInfo();
                    }
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

            const deletedLabel = `${examenSeleccionado.curso} (${examenSeleccionado.anio})`;
            examenSeleccionado = null;
            infoCard.hidden = true;
            simuladorContainer.hidden = true;
            await loadExamenes();
            showMessage(`El examen de ${deletedLabel} y sus preguntas han sido eliminados por completo.`, "success");
            callbacks?.onSyncChange?.();
        } catch (error) {
            showMessage(error instanceof Error ? error.message : "Error al eliminar el examen.", "error");
        } finally {
            if (btnEliminarExamen) {
                btnEliminarExamen.disabled = false;
                setButtonLabel(btnEliminarExamen, "Eliminar Examen");
            }
        }
    });

    btnFinalizar?.addEventListener("click", () => {
        void finalizarSimulacroActual();
    });

    btnVerResumen?.addEventListener("click", () => {
        simuladorResultado.scrollIntoView({ behavior: "smooth" });
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

    return {
        loadExamenes,
        reset: () => {
            listaExamenes = [];
            examenSeleccionado = null;
            preguntasActuales = [];
            respuestasUsuario = {};
            simulacroFinalizado = false;
            calificandoSimulacro = false;
            resultadoFinalServidor = null;
            infoCard.hidden = true;
            simuladorContainer.hidden = true;
            if (scoreboardStats) scoreboardStats.hidden = true;
            if (footerActions) footerActions.hidden = true;
            clearMessage();
        }
    };
}
