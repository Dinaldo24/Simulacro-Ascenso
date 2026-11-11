import { EspecialidadItem, fetchEspecialidades, fillEspecialidadSelect } from "./especialidades.js";
import { BACKEND_URL, authorizedFetch, getStoredUser } from "./session.js";

export interface UsuarioItem {
    id: number;
    nombre: string;
    email: string;
    role: "administrador" | "director" | "profesor" | "alumno";
    activo: boolean;
    especialidadId?: number | null;
    especialidad?: { id: number; nombre: string } | null;
    creadoEn: string;
}

function requireElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) {
        throw new Error(`No se encontró el elemento requerido: ${selector}`);
    }
    return element;
}

export function setupUsuarios() {
    const panel = requireElement<HTMLElement>("#usuarios-panel");
    const tablaCuerpo = requireElement<HTMLTableSectionElement>("#usuarios-table-body");
    const buscador = requireElement<HTMLInputElement>("#usuarios-search");
    const btnNuevoUsuario = requireElement<HTMLButtonElement>("#btn-nuevo-usuario");
    const modalUsuario = requireElement<HTMLElement>("#modal-usuario");
    const formUsuario = requireElement<HTMLFormElement>("#form-usuario");
    const modalTitulo = requireElement<HTMLElement>("#modal-usuario-titulo");
    const btnCerrarModal = requireElement<HTMLButtonElement>("#btn-cerrar-modal-usuario");
    const btnCancelarModal = requireElement<HTMLButtonElement>("#btn-cancelar-modal-usuario");
    const inputId = requireElement<HTMLInputElement>("#usuario-id");
    const inputNombre = requireElement<HTMLInputElement>("#usuario-nombre");
    const inputEmail = requireElement<HTMLInputElement>("#usuario-email");
    const selectRole = requireElement<HTMLSelectElement>("#usuario-role");
    const inputPassword = requireElement<HTMLInputElement>("#usuario-password");
    const passwordHelp = requireElement<HTMLElement>("#usuario-password-help");
    const alerta = requireElement<HTMLElement>("#usuarios-alert");

    const selectEspecialidad = requireElement<HTMLSelectElement>("#usuario-especialidad");
    const grupoEspecialidad = requireElement<HTMLElement>("#usuario-especialidad-group");
    const formEspecialidad = requireElement<HTMLFormElement>("#form-especialidad");
    const inputEspecialidad = requireElement<HTMLInputElement>("#especialidad-nombre");
    const listaEspecialidades = requireElement<HTMLUListElement>("#especialidades-lista");

    let usuariosCache: UsuarioItem[] = [];
    let especialidadesCache: EspecialidadItem[] = [];

    function actualizarCampoEspecialidad(): void {
        const esDocente = selectRole.value === "profesor";
        grupoEspecialidad.hidden = !esDocente;
        selectEspecialidad.required = esDocente;
    }

    function renderEspecialidades(): void {
        listaEspecialidades.replaceChildren();
        if (especialidadesCache.length === 0) {
            const vacio = document.createElement("li");
            vacio.className = "especialidades-vacio";
            vacio.textContent = "Aún no hay especialidades registradas.";
            listaEspecialidades.append(vacio);
        }
        for (const e of especialidadesCache) {
            const li = document.createElement("li");
            li.className = "especialidad-chip";
            const nombre = document.createElement("span");
            nombre.textContent = e.nombre;
            const quitar = document.createElement("button");
            quitar.type = "button";
            quitar.className = "especialidad-chip__remove";
            quitar.setAttribute("aria-label", `Eliminar especialidad ${e.nombre}`);
            quitar.textContent = "×";
            quitar.addEventListener("click", () => void eliminarEspecialidad(e));
            li.append(nombre, quitar);
            listaEspecialidades.append(li);
        }
    }

    async function cargarEspecialidades(): Promise<void> {
        try {
            especialidadesCache = await fetchEspecialidades();
            renderEspecialidades();
            fillEspecialidadSelect(selectEspecialidad, especialidadesCache, "Selecciona una especialidad");
        } catch (err: any) {
            mostrarMensaje(err.message, "error");
        }
    }

    async function eliminarEspecialidad(e: EspecialidadItem): Promise<void> {
        if (!window.confirm(`¿Eliminar la especialidad "${e.nombre}"?`)) return;
        const res = await authorizedFetch(`${BACKEND_URL}/especialidades/${e.id}`, { method: "DELETE" });
        if (res.status === 401) return;
        const data = await res.json();
        if (!res.ok) {
            mostrarMensaje(data.mensaje || "No se pudo eliminar la especialidad.", "error");
            return;
        }
        await cargarEspecialidades();
        mostrarMensaje("Especialidad eliminada.");
    }

    formEspecialidad.addEventListener("submit", async (event) => {
        event.preventDefault();
        const nombre = inputEspecialidad.value.trim();
        if (!nombre) return;
        const res = await authorizedFetch(`${BACKEND_URL}/especialidades`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre }),
        });
        if (res.status === 401) return;
        const data = await res.json();
        if (!res.ok) {
            mostrarMensaje(data.mensaje || "No se pudo agregar la especialidad.", "error");
            return;
        }
        inputEspecialidad.value = "";
        await cargarEspecialidades();
        mostrarMensaje("Especialidad agregada.");
    });

    selectRole.addEventListener("change", actualizarCampoEspecialidad);

    function mostrarMensaje(texto: string, tipo: "success" | "error" = "success") {
        alerta.textContent = texto;
        alerta.className = `repository-alert repository-alert--${tipo}`;
        alerta.hidden = false;
        setTimeout(() => {
            alerta.hidden = true;
        }, 5000);
    }

    function esUsuarioActual(user: UsuarioItem): boolean {
        const parsed = getStoredUser();
        if (!parsed) return false;
        const currentId = Number(parsed.id || 0);
        if (currentId > 0 && user.id === currentId) return true;
        const currentEmail = String(parsed.username || "").trim().toLowerCase();
        return Boolean(currentEmail && user.email.trim().toLowerCase() === currentEmail);
    }

    function renderTableState(texto: string, isError = false): void {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 5;
        td.className = isError ? "table-state-cell table-state-cell--error" : "table-state-cell";
        td.textContent = texto;
        tr.append(td);
        tablaCuerpo.replaceChildren(tr);
    }

    async function loadUsuarios(): Promise<void> {
        renderTableState("Cargando lista de usuarios...");

        try {
            const res = await authorizedFetch(`${BACKEND_URL}/usuarios`);
            if (res.status === 401) return;

            if (!res.ok) {
                if (res.status === 403) {
                    renderTableState("No tienes permisos de Administrador.", true);
                    return;
                }
                throw new Error("No se pudo obtener la lista de usuarios.");
            }

            const data = await res.json();
            usuariosCache = data.usuarios || [];
            renderizarTabla(usuariosCache);
        } catch (err: any) {
            renderTableState(`Error al cargar usuarios: ${err?.message || "Error inesperado"}`, true);
        }
    }

    function renderizarTabla(lista: UsuarioItem[]) {
        tablaCuerpo.replaceChildren();

        if (lista.length === 0) {
            renderTableState("No se encontraron usuarios registrados.");
            return;
        }

        const roleLabels: Record<string, { label: string; badgeClass: string }> = {
            administrador: { label: "Administrador", badgeClass: "role-badge--admin" },
            director: { label: "Director", badgeClass: "role-badge--director" },
            profesor: { label: "Docente / Profesor", badgeClass: "role-badge--profesor" },
            alumno: { label: "Estudiante / Alumno", badgeClass: "role-badge--alumno" },
        };

        const pencilSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
        const disableSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
        const enableSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;

        lista.forEach((user) => {
            const tr = document.createElement("tr");
            const roleInfo = roleLabels[user.role] || { label: user.role, badgeClass: "role-badge--default" };
            const esPropiaCuenta = esUsuarioActual(user);

            // Nombre
            const tdNombre = document.createElement("td");
            const nameWrap = document.createElement("div");
            nameWrap.className = "user-name-cell";
            const nameText = document.createElement("span");
            nameText.textContent = user.nombre;
            nameWrap.append(nameText);
            if (esPropiaCuenta) {
                const selfTag = document.createElement("span");
                selfTag.className = "user-self-tag";
                selfTag.textContent = "Tú";
                nameWrap.append(selfTag);
            }
            tdNombre.append(nameWrap);

            // Correo
            const tdEmail = document.createElement("td");
            const emailSpan = document.createElement("span");
            emailSpan.className = "user-email";
            emailSpan.textContent = user.email;
            tdEmail.append(emailSpan);

            // Rol
            const tdRole = document.createElement("td");
            const roleBadge = document.createElement("span");
            roleBadge.className = `role-badge ${roleInfo.badgeClass}`;
            roleBadge.textContent = roleInfo.label;
            tdRole.append(roleBadge);

            // Especialidad
            const tdEspecialidad = document.createElement("td");
            tdEspecialidad.textContent = user.role === "profesor" ? (user.especialidad?.nombre ?? "Sin asignar") : "—";

            // Estado
            const tdStatus = document.createElement("td");
            const statusBadge = document.createElement("span");
            statusBadge.className = `status-badge ${user.activo ? "status-badge--active" : "status-badge--inactive"}`;
            const dot = document.createElement("span");
            dot.className = "status-dot";
            dot.setAttribute("aria-hidden", "true");
            statusBadge.append(dot, document.createTextNode(user.activo ? "Habilitado" : "Deshabilitado"));
            tdStatus.append(statusBadge);

            // Acciones
            const tdActions = document.createElement("td");
            const actionsWrap = document.createElement("div");
            actionsWrap.className = "table-actions";

            const btnEditar = document.createElement("button");
            btnEditar.type = "button";
            btnEditar.className = "button button--secondary button--sm btn-editar-usuario";
            btnEditar.dataset.id = String(user.id);
            btnEditar.innerHTML = `${pencilSvg}<span>Editar</span>`;
            btnEditar.addEventListener("click", () => abrirModalEdicion(user));
            actionsWrap.append(btnEditar);

            if (esPropiaCuenta) {
                const selfPill = document.createElement("span");
                selfPill.className = "session-self-pill";
                selfPill.title = "No puedes deshabilitar tu propia cuenta en sesión";
                selfPill.textContent = "Activo (En uso)";
                actionsWrap.append(selfPill);
            } else {
                const btnToggle = document.createElement("button");
                btnToggle.type = "button";
                btnToggle.className = `button ${user.activo ? "button--danger" : "button--positive"} button--sm btn-toggle-usuario`;
                btnToggle.dataset.id = String(user.id);
                btnToggle.dataset.activo = String(user.activo);
                btnToggle.innerHTML = `${user.activo ? disableSvg : enableSvg}<span>${user.activo ? "Deshabilitar" : "Habilitar"}</span>`;
                btnToggle.addEventListener("click", () => alternarEstado(user));
                actionsWrap.append(btnToggle);
            }

            tdActions.append(actionsWrap);
            tr.append(tdNombre, tdEmail, tdRole, tdEspecialidad, tdStatus, tdActions);
            tablaCuerpo.appendChild(tr);
        });
    }

    function abrirModalNuevo() {
        modalTitulo.textContent = "Registrar Nuevo Usuario";
        formUsuario.reset();
        inputId.value = "";
        selectRole.disabled = false;
        passwordHelp.textContent = "Contraseña requerida (mínimo 6 caracteres).";
        inputPassword.required = true;
        fillEspecialidadSelect(selectEspecialidad, especialidadesCache, "Selecciona una especialidad");
        actualizarCampoEspecialidad();
        modalUsuario.hidden = false;
        inputNombre.focus();
    }

    function abrirModalEdicion(user: UsuarioItem) {
        modalTitulo.textContent = `Editar Usuario: ${user.nombre}`;
        inputId.value = String(user.id);
        inputNombre.value = user.nombre;
        inputEmail.value = user.email;
        selectRole.value = user.role;
        selectRole.disabled = esUsuarioActual(user);
        fillEspecialidadSelect(selectEspecialidad, especialidadesCache, "Selecciona una especialidad", user.especialidadId);
        actualizarCampoEspecialidad();
        inputPassword.value = "";
        inputPassword.required = false;
        passwordHelp.textContent = "Dejar en blanco si no deseas cambiar la contraseña.";
        modalUsuario.hidden = false;
        inputNombre.focus();
    }

    function cerrarModal() {
        modalUsuario.hidden = true;
        selectRole.disabled = false;
        formUsuario.reset();
    }

    async function alternarEstado(user: UsuarioItem) {
        if (esUsuarioActual(user)) {
            mostrarMensaje("Por seguridad, no puedes deshabilitar tu propia cuenta activa.", "error");
            return;
        }

        const nuevoEstado = !user.activo;
        const confirmMsg = nuevoEstado
            ? `¿Deseas habilitar la cuenta de ${user.nombre}? Podrá volver a ingresar al sistema.`
            : `¿Deseas deshabilitar la cuenta de ${user.nombre}? No podrá ingresar al sistema hasta que lo vuelvas a habilitar.`;

        if (!confirm(confirmMsg)) return;

        try {
            const res = await authorizedFetch(`${BACKEND_URL}/usuarios/${user.id}/estado`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ activo: nuevoEstado }),
            });
            if (res.status === 401) return;

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.mensaje || "Error al cambiar estado.");
            }

            user.activo = nuevoEstado;
            renderizarTabla(usuariosCache);
            mostrarMensaje(`Usuario ${user.nombre} ${nuevoEstado ? "habilitado" : "deshabilitado"} con éxito.`);
        } catch (err: any) {
            mostrarMensaje(err.message, "error");
        }
    }

    formUsuario.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = inputId.value.trim();
        const esNuevo = !id;

        const payload: any = {
            nombre: inputNombre.value.trim(),
            email: inputEmail.value.trim().toLowerCase(),
            role: selectRole.value,
        };
        if (selectRole.value === "profesor") {
            payload.especialidadId = Number(selectEspecialidad.value) || null;
        }

        if (inputPassword.value) {
            payload.password = inputPassword.value;
        }

        try {
            const url = esNuevo ? `${BACKEND_URL}/usuarios` : `${BACKEND_URL}/usuarios/${id}`;
            const method = esNuevo ? "POST" : "PATCH";

            const res = await authorizedFetch(url, {
                method,
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });
            if (res.status === 401) return;

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.mensaje || "Error al procesar la solicitud.");
            }

            cerrarModal();
            await loadUsuarios();
            mostrarMensaje(esNuevo ? "¡Usuario registrado con éxito!" : "¡Usuario actualizado correctamente!");
        } catch (err: any) {
            mostrarMensaje(err.message, "error");
        }
    });

    buscador.addEventListener("input", () => {
        const q = buscador.value.trim().toLowerCase();
        if (!q) {
            renderizarTabla(usuariosCache);
            return;
        }
        const filtrados = usuariosCache.filter(
            (u) => u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q)
        );
        renderizarTabla(filtrados);
    });

    btnNuevoUsuario.addEventListener("click", abrirModalNuevo);
    btnCerrarModal.addEventListener("click", cerrarModal);
    btnCancelarModal.addEventListener("click", cerrarModal);
    modalUsuario.addEventListener("click", (event) => {
        if (event.target === modalUsuario) {
            cerrarModal();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !modalUsuario.hidden) {
            cerrarModal();
        }
    });

    return {
        loadUsuarios: async () => {
            await cargarEspecialidades();
            await loadUsuarios();
        },
    };
}
