import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import express, {
    type ErrorRequestHandler,
    type RequestHandler
} from "express";
import session from "express-session";
import MySQLStoreFactory from "express-mysql-session";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import multer from "multer";
import {
    createAuthRouter,
    requireAuthenticated,
    requireRepositoryManager
} from "./auth-routes.js";
import { createDocumentFileRouter } from "./document-file-routes.js";
import { createDocumentListRouter } from "./document-list-route.js";
import { createDocumentMutationRouter } from "./document-mutation-routes.js";
import { createDocumentUploadRouter } from "./document-upload-route.js";

const requiredEnvironment = ["DB_HOST", "DB_USER", "DB_NAME", "SESSION_SECRET"] as const;
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);

if (missingEnvironment.length > 0) {
    throw new Error(`Faltan variables requeridas en .env: ${missingEnvironment.join(", ")}`);
}

function requiredEnv(name: typeof requiredEnvironment[number]): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Falta la variable requerida ${name} en .env.`);
    }
    return value;
}

const sessionSecret = requiredEnv("SESSION_SECRET");
if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET debe tener al menos 32 caracteres.");
}

if (sessionSecret === "cambia-esto-por-una-clave-aleatoria-larga") {
    throw new Error("Genera una SESSION_SECRET aleatoria; no uses el valor de ejemplo.");
}

const projectDirectory = path.resolve(__dirname, "../..");
const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const pdfStorageDirectory = path.resolve(
    projectDirectory,
    process.env.PDF_STORAGE_DIR || "storage/pdfs"
);
const maxPdfSize = 25 * 1024 * 1024;
const maxCoverImageSize = 5 * 1024 * 1024;

mkdirSync(pdfStorageDirectory, { recursive: true });

const pool = mysql.createPool({
    host: requiredEnv("DB_HOST"),
    port: Number(process.env.DB_PORT || 3306),
    user: requiredEnv("DB_USER"),
    password: process.env.DB_PASSWORD || "",
    database: requiredEnv("DB_NAME"),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: 8 * 60 * 60 * 1000,
    createDatabaseTable: true
}, pool);

sessionStore.on("error", (error) => {
    console.error("Error en el almacenamiento de sesiones:", error.message);
});

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "10kb" }));
app.use(session({
    name: "simulador.sid",
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        maxAge: 8 * 60 * 60 * 1000
    }
}));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { message: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." }
});

const pdfUpload = multer({
    storage: multer.diskStorage({
        destination: pdfStorageDirectory,
        filename: (_request, _file, callback) => {
            callback(null, `${randomUUID()}.pdf`);
        }
    }),
    limits: {
        fileSize: maxPdfSize,
        files: 1
    },
    fileFilter: (_request, file, callback) => {
        const isPdfName = path.extname(file.originalname).toLowerCase() === ".pdf";

        if (!isPdfName || file.mimetype !== "application/pdf") {
            callback(new Error("Selecciona un archivo PDF válido."));
            return;
        }

        callback(null, true);
    }
});

const coverImageUpload = multer({
    storage: multer.diskStorage({
        destination: pdfStorageDirectory,
        filename: (_request, file, callback) => {
            const originalExtension = path.extname(file.originalname).toLowerCase();
            const extension = originalExtension === ".png"
                ? "png"
                : originalExtension === ".webp"
                    ? "webp"
                    : "jpg";
            callback(null, `${randomUUID()}.cover.${extension}`);
        }
    }),
    limits: {
        fileSize: maxCoverImageSize,
        files: 1
    },
    fileFilter: (_request, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase();
        if (![".png", ".jpg", ".jpeg", ".jpe", ".webp"].includes(extension)) {
            callback(new Error(
                "Selecciona una imagen PNG, JPEG (.jpg, .jpeg, .jpe) o WebP válida para la portada."
            ));
            return;
        }

        callback(null, true);
    }
});

function createUploadHandler(
    upload: multer.Multer,
    fieldName: string,
    maxSizeMessage: string,
    multerErrorMessage: string,
    invalidFileMessage: string
): RequestHandler {
    return (request, response, next): void => {
        upload.single(fieldName)(request, response, (error: unknown) => {
            if (!error) {
                next();
                return;
            }

            if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
                response.status(413).json({ message: maxSizeMessage });
                return;
            }

            if (error instanceof multer.MulterError) {
                response.status(400).json({ message: multerErrorMessage });
                return;
            }

            if (error instanceof Error && error.message === invalidFileMessage) {
                response.status(400).json({ message: error.message });
                return;
            }

            next(error);
        });
    };
}

const handlePdfUpload = createUploadHandler(
    pdfUpload,
    "pdf",
    "El PDF no puede superar los 25 MB.",
    "No se pudo recibir el PDF seleccionado.",
    "Selecciona un archivo PDF válido."
);
const handleCoverImageUpload = createUploadHandler(
    coverImageUpload,
    "portada",
    "La imagen de portada no puede superar los 5 MB.",
    "No se pudo recibir la imagen seleccionada.",
    "Selecciona una imagen PNG, JPEG (.jpg, .jpeg, .jpe) o WebP válida para la portada."
);

app.get("/", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.sendFile(path.join(projectDirectory, "index.html"));
});

app.use("/css", express.static(path.join(projectDirectory, "css")));
app.use("/js", express.static(path.join(projectDirectory, "js"), {
    setHeaders: (response) => response.set("Cache-Control", "no-store")
}));
app.use(
    "/vendor/pdfjs",
    express.static(path.join(projectDirectory, "node_modules", "pdfjs-dist", "build"))
);
app.use("/recursos", express.static(path.join(projectDirectory, "recursos")));
app.use("/api/auth", createAuthRouter(pool, loginLimiter, isProduction));

const authenticate = requireAuthenticated(pool);
app.use("/api/documentos", createDocumentListRouter(pool, authenticate));
app.use(
    "/api/documentos",
    createDocumentUploadRouter(pool, authenticate, requireRepositoryManager, handlePdfUpload)
);
app.use(
    "/api/documentos",
    createDocumentFileRouter(pool, authenticate, pdfStorageDirectory)
);
app.use(
    "/api/documentos",
    createDocumentMutationRouter(
        pool,
        authenticate,
        requireRepositoryManager,
        handleCoverImageUpload,
        pdfStorageDirectory
    )
);

const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    const status = isRecord(error) && typeof error.status === "number"
        ? error.status
        : 500;
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error en la solicitud:", message);

    if (response.headersSent) {
        next(error);
        return;
    }

    response.status(status).json({
        message: status === 404
            ? message
            : "Ocurrió un error interno. Inténtalo más tarde."
    });
};

app.use(errorHandler);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

interface DocumentColumn extends RowDataPacket {
    COLUMN_NAME: string;
}

async function initializeSchema(databasePool: Pool): Promise<void> {
    await databasePool.query("SELECT 1");
    await sessionStore.onReady();
    await databasePool.execute("SELECT id_usuario FROM usuarios LIMIT 0");
    await databasePool.execute("SELECT id_documento FROM documentos LIMIT 0");
    const [documentColumns] = await databasePool.execute<DocumentColumn[]>(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'documentos'
           AND COLUMN_NAME IN ('curso', 'anio')`
    );
    const existingDocumentColumns = new Set(documentColumns.map((column) => column.COLUMN_NAME));

    if (!existingDocumentColumns.has("curso")) {
        await databasePool.execute("ALTER TABLE documentos ADD COLUMN curso VARCHAR(150) NULL");
    }
    if (!existingDocumentColumns.has("anio")) {
        await databasePool.execute("ALTER TABLE documentos ADD COLUMN anio VARCHAR(50) NULL");
    }

    await databasePool.execute(
        `CREATE TABLE IF NOT EXISTS portadas_documentos (
            id_documento INT UNSIGNED NOT NULL,
            pagina_pdf INT UNSIGNED NOT NULL DEFAULT 1,
            archivo_imagen VARCHAR(100) NULL,
            PRIMARY KEY (id_documento),
            CONSTRAINT fk_portadas_documento
                FOREIGN KEY (id_documento)
                REFERENCES documentos (id_documento)
                ON UPDATE CASCADE
                ON DELETE CASCADE
        ) ENGINE = InnoDB`
    );
}

async function startServer(): Promise<void> {
    await initializeSchema(pool);
    app.listen(port, () => {
        console.log(`Aplicación disponible en http://localhost:${port}`);
    });
}

startServer().catch((error: unknown) => {
    console.error(
        "No se pudo iniciar el servidor. Revisa MySQL y el archivo .env:",
        error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
    pool.end().catch((closeError: unknown) => {
        console.error(
            "No se pudo cerrar el pool de MySQL:",
            closeError instanceof Error ? closeError.message : closeError
        );
    });
});
