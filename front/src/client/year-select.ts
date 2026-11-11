/** Ordena años de forma descendente numérica, dejando etiquetas no numéricas al final. */
export function compareYearsDesc(a: string, b: string): number {
    const cleanA = a.trim();
    const cleanB = b.trim();
    const numA = Number(cleanA);
    const numB = Number(cleanB);
    const finiteA = cleanA !== "" && Number.isFinite(numA);
    const finiteB = cleanB !== "" && Number.isFinite(numB);

    if (finiteA && finiteB) {
        return numB - numA;
    }
    if (finiteA !== finiteB) {
        return finiteA ? -1 : 1;
    }
    return cleanB.localeCompare(cleanA, "es", { numeric: true });
}

/** Deduplica y ordena una colección de años en orden cronológico descendente. */
export function sortYearsDesc(years: Iterable<string | number | null | undefined>): string[] {
    const unique = new Set<string>();
    for (const year of years) {
        const normalized = String(year ?? "").trim();
        if (normalized) {
            unique.add(normalized);
        }
    }
    return Array.from(unique).sort(compareYearsDesc);
}

/** Rellena un selector con la opción inicial vacía y las opciones indicadas. */
export function populateSelect(
    select: HTMLSelectElement | null,
    options: string[],
    placeholder: string
): void {
    if (!select) return;
    select.replaceChildren();

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = placeholder;
    select.append(defaultOption);

    options.forEach((opt) => {
        const option = document.createElement("option");
        option.value = opt;
        option.textContent = opt;
        select.append(option);
    });
}
