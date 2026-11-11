import { Request } from "express";

export function obtenerIdPositivo(req: Request, paramName: string = "id"): number | null {
    const raw = req.params[paramName];
    const valor = Array.isArray(raw) ? raw[0] : raw;
    const id = Number(valor);
    return Number.isInteger(id) && id > 0 ? id : null;
}

export function esIdPositivo(id: unknown): id is number {
    return typeof id === "number" && Number.isInteger(id) && id > 0;
}

export function obtenerParametroTexto(req: Request, paramName: string): string {
    const raw = req.params[paramName];
    const valor = Array.isArray(raw) ? raw[0] : raw;
    return typeof valor === "string" ? valor.trim() : "";
}
