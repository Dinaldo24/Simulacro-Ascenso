import { BACKEND_URL, authorizedFetch } from "./session.js";

export interface EspecialidadItem {
    id: number;
    nombre: string;
}

/** Catálogo de especialidades definido por el colegio (GET /especialidades). */
export async function fetchEspecialidades(): Promise<EspecialidadItem[]> {
    const response = await authorizedFetch(`${BACKEND_URL}/especialidades`);
    if (!response.ok) {
        throw new Error("No se pudieron cargar las especialidades.");
    }
    const data = (await response.json()) as { especialidades?: EspecialidadItem[] };
    return data.especialidades ?? [];
}

/** Rellena un <select> con las especialidades; conserva `selectedId` si existe. */
export function fillEspecialidadSelect(
    select: HTMLSelectElement,
    especialidades: EspecialidadItem[],
    placeholder: string,
    selectedId?: number | null,
): void {
    select.replaceChildren();
    const first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    select.append(first);
    for (const e of especialidades) {
        const option = document.createElement("option");
        option.value = String(e.id);
        option.textContent = e.nombre;
        select.append(option);
    }
    select.value = selectedId ? String(selectedId) : "";
}
