import dotenv from "dotenv";
import path from "path";

const BACK_ROOT = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.resolve(BACK_ROOT, ".env") });

function parseNumber(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCorsOrigins(value: string | undefined): string | string[] {
    if (!value || value.trim() === "*") {
        return "*";
    }
    const origins = value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
    return origins.length > 0 ? origins : "*";
}

export const env = {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: parseNumber(process.env.PORT, 3002),
    corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
    db: {
        host: process.env.DB_HOST ?? "localhost",
        port: parseNumber(process.env.DB_PORT, 3306),
        user: process.env.DB_USER ?? "root",
        password: process.env.DB_PASSWORD ?? "",
        name: process.env.DB_NAME ?? "proyectodirector",
        poolSize: parseNumber(process.env.DB_POOL_SIZE, 10),
        synchronize: process.env.DB_SYNCHRONIZE === "true",
        logging: process.env.DB_LOGGING === "true",
    },
    storage: {
        backRoot: BACK_ROOT,
        documentosDir: path.resolve(BACK_ROOT, "uploads", "documentos"),
        examenesDir: path.resolve(BACK_ROOT, "..", "storage", "examenes"),
        pdfExtractorScript: path.resolve(BACK_ROOT, "..", "pdf_a_preguntas.py"),
    },
} as const;

export function requireJwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error("JWT_SECRET no está configurado.");
    }
    return secret;
}
