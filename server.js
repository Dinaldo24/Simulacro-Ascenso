require("dotenv").config();

const path = require("node:path");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const crypto = require("node:crypto");
const express = require("express");
const session = require("express-session");
const MySQLStoreFactory = require("express-mysql-session");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const multer = require("multer");

const requiredEnvironment = ["DB_HOST", "DB_USER", "DB_NAME", "SESSION_SECRET"];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);

if (missingEnvironment.length > 0) {
    throw new Error(`Faltan variables requeridas en .env: ${missingEnvironment.join(", ")}`);
}

if (process.env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET debe tener al menos 32 caracteres.");
}

if (process.env.SESSION_SECRET === "cambia-esto-por-una-clave-aleatoria-larga") {
    throw new Error("Genera una SESSION_SECRET aleatoria; no uses el valor de ejemplo.");
}

const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const pdfStorageDirectory = path.resolve(
    __dirname,
    process.env.PDF_STORAGE_DIR || "storage/pdfs"
);
const maxPdfSize = 25 * 1024 * 1024;

fs.mkdirSync(pdfStorageDirectory, { recursive: true });

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME,
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
    secret: process.env.SESSION_SECRET,
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
        filename: (request, file, callback) => {
            callback(null, `${crypto.randomUUID()}.pdf`);
        }
    }),
    limits: {
        fileSize: maxPdfSize,
        files: 1
    },
    fileFilter: (request, file, callback) => {
        const isPdfName = path.extname(file.originalname).toLowerCase() === ".pdf";

        if (!isPdfName || file.mimetype !== "application/pdf") {
            callback(new Error("Selecciona un archivo PDF válido."));
            return;
        }

        callback(null, true);
    }
});

async function requireAuthenticated(request, response, next) {
    try {
        if (!request.session.userId) {
            return response.status(401).json({ message: "Inicia sesión para continuar." });
        }

        const [users] = await pool.execute(
            `SELECT id_usuario, nombre_usuario, nombres, apellidos, rol
             FROM usuarios
             WHERE id_usuario = ? AND activo = TRUE
             LIMIT 1`,
            [request.session.userId]
        );
        const user = users[0];

        if (!user) {
            await new Promise((resolve, reject) => {
                request.session.destroy((error) => error ? reject(error) : resolve());
            });
            return response.status(401).json({ message: "La cuenta no está activa." });
        }

        request.currentUser = user;
        return next();
    } catch (error) {
        return next(error);
    }
}

function requireRepositoryManager(request, response, next) {
    if (!["administrador", "director"].includes(request.currentUser.rol)) {
        return response.status(403).json({
            message: "Solo el Administrador y el Director pueden modificar el repositorio."
        });
    }

    return next();
}

function handlePdfUpload(request, response, next) {
    pdfUpload.single("pdf")(request, response, (error) => {
        if (!error) {
            return next();
        }

        if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
            return response.status(413).json({ message: "El PDF no puede superar los 25 MB." });
        }

        if (error instanceof multer.MulterError) {
            return response.status(400).json({ message: "No se pudo recibir el PDF seleccionado." });
        }

        if (error.message === "Selecciona un archivo PDF válido.") {
            return response.status(400).json({ message: error.message });
        }

        return next(error);
    });
}

async function removeUploadedFile(filePath) {
    try {
        await fsPromises.unlink(filePath);
    } catch (error) {
        console.error("No se pudo limpiar un archivo PDF temporal:", error.message);
    }
}

async function hasPdfSignature(filePath) {
    const handle = await fsPromises.open(filePath, "r");

    try {
        const header = Buffer.alloc(5);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        return bytesRead === header.length && header.toString("ascii") === "%PDF-";
    } finally {
        await handle.close();
    }
}

app.get("/", (request, response) => {
    response.sendFile(path.join(__dirname, "index.html"));
});

app.use("/css", express.static(path.join(__dirname, "css")));
app.use("/js", express.static(path.join(__dirname, "js")));
app.use("/recursos", express.static(path.join(__dirname, "recursos")));

app.post("/api/auth/login", loginLimiter, async (request, response, next) => {
    try {
        const { username, password } = request.body || {};

        if (
            typeof username !== "string" ||
            typeof password !== "string" ||
            !username.trim() ||
            !password ||
            username.length > 50 ||
            Buffer.byteLength(password, "utf8") > 72
        ) {
            return response.status(400).json({ message: "Revisa el usuario y la contraseña." });
        }

        const [users] = await pool.execute(
            `SELECT id_usuario, nombre_usuario, hash_contrasena, nombres, apellidos, rol
             FROM usuarios
             WHERE nombre_usuario = ? AND activo = TRUE
             LIMIT 1`,
            [username.trim()]
        );
        const user = users[0];

        if (!user || !(await bcrypt.compare(password, user.hash_contrasena))) {
            return response.status(401).json({ message: "Usuario o contraseña incorrectos." });
        }

        await new Promise((resolve, reject) => {
            request.session.regenerate((error) => error ? reject(error) : resolve());
        });
        request.session.userId = user.id_usuario;
        await new Promise((resolve, reject) => {
            request.session.save((error) => error ? reject(error) : resolve());
        });

        return response.json({
            user: {
                username: user.nombre_usuario,
                nombres: user.nombres,
                apellidos: user.apellidos,
                role: user.rol
            }
        });
    } catch (error) {
        return next(error);
    }
});

app.get("/api/auth/me", requireAuthenticated, (request, response) => {
    const user = request.currentUser;

    return response.json({
        user: {
            username: user.nombre_usuario,
            nombres: user.nombres,
            apellidos: user.apellidos,
            role: user.rol
        }
    });
});

app.get("/api/documentos", requireAuthenticated, async (request, response, next) => {
    try {
        const [documents] = await pool.execute(
            `SELECT d.id_documento, d.titulo, d.nombre_archivo, d.tamano_bytes,
                    d.fecha_subida, u.nombres AS subido_por_nombres,
                    u.apellidos AS subido_por_apellidos
             FROM documentos AS d
             INNER JOIN usuarios AS u ON u.id_usuario = d.subido_por
             ORDER BY d.fecha_subida DESC, d.id_documento DESC`
        );

        return response.json({
            documents,
            canManage: ["administrador", "director"].includes(request.currentUser.rol)
        });
    } catch (error) {
        return next(error);
    }
});

app.post(
    "/api/documentos",
    requireAuthenticated,
    requireRepositoryManager,
    handlePdfUpload,
    async (request, response, next) => {
        if (!request.file) {
            return response.status(400).json({ message: "Selecciona un archivo PDF." });
        }

        const title = typeof request.body?.titulo === "string"
            ? request.body.titulo.trim()
            : "";

        if (!title || title.length > 150) {
            await removeUploadedFile(request.file.path);
            return response.status(400).json({
                message: "Escribe un título de entre 1 y 150 caracteres."
            });
        }

        try {
            if (!(await hasPdfSignature(request.file.path))) {
                await removeUploadedFile(request.file.path);
                return response.status(400).json({
                    message: "El archivo seleccionado no parece ser un PDF válido."
                });
            }

            const originalName = path.win32.basename(request.file.originalname)
                .replace(/[\u0000-\u001f\u007f]/g, "")
                .slice(0, 255);

            if (!originalName) {
                await removeUploadedFile(request.file.path);
                return response.status(400).json({
                    message: "El PDF debe tener un nombre de archivo válido."
                });
            }

            const [result] = await pool.execute(
                `INSERT INTO documentos
                    (titulo, nombre_archivo, archivo_guardado, tamano_bytes, subido_por)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    title,
                    originalName,
                    request.file.filename,
                    request.file.size,
                    request.currentUser.id_usuario
                ]
            );

            return response.status(201).json({
                message: "PDF agregado al repositorio.",
                document: {
                    id_documento: result.insertId,
                    titulo: title,
                    nombre_archivo: originalName,
                    tamano_bytes: request.file.size
                }
            });
        } catch (error) {
            await removeUploadedFile(request.file.path);
            return next(error);
        }
    }
);

app.get("/api/documentos/:id/descargar", requireAuthenticated, async (request, response, next) => {
    if (!/^\d+$/.test(request.params.id)) {
        return response.status(400).json({ message: "El identificador del documento no es válido." });
    }

    try {
        const [documents] = await pool.execute(
            `SELECT nombre_archivo, archivo_guardado
             FROM documentos
             WHERE id_documento = ?
             LIMIT 1`,
            [request.params.id]
        );
        const document = documents[0];

        if (!document) {
            return response.status(404).json({ message: "No se encontró el PDF solicitado." });
        }

        if (!/^[0-9a-f-]+\.pdf$/i.test(document.archivo_guardado)) {
            return next(new Error("El nombre interno del PDF no es válido."));
        }

        const filePath = path.join(pdfStorageDirectory, document.archivo_guardado);

        return response.download(filePath, document.nombre_archivo, (error) => {
            if (error && !response.headersSent) {
                next(error.code === "ENOENT"
                    ? Object.assign(new Error("No se encontró el archivo PDF almacenado."), { status: 404 })
                    : error);
            }
        });
    } catch (error) {
        return next(error);
    }
});

app.delete(
    "/api/documentos/:id",
    requireAuthenticated,
    requireRepositoryManager,
    async (request, response, next) => {
        if (!/^\d+$/.test(request.params.id)) {
            return response.status(400).json({ message: "El identificador del documento no es válido." });
        }

        let originalFilePath;
        let deletingFilePath;

        try {
            const [documents] = await pool.execute(
                `SELECT archivo_guardado
                 FROM documentos
                 WHERE id_documento = ?
                 LIMIT 1`,
                [request.params.id]
            );
            const document = documents[0];

            if (!document) {
                return response.status(404).json({ message: "No se encontró el PDF solicitado." });
            }

            if (!/^[0-9a-f-]+\.pdf$/i.test(document.archivo_guardado)) {
                return next(new Error("El nombre interno del PDF no es válido."));
            }

            originalFilePath = path.join(pdfStorageDirectory, document.archivo_guardado);
            deletingFilePath = path.join(
                pdfStorageDirectory,
                `${path.basename(document.archivo_guardado, ".pdf")}.deleting`
            );

            await fsPromises.rename(originalFilePath, deletingFilePath);

            try {
                const [result] = await pool.execute(
                    "DELETE FROM documentos WHERE id_documento = ?",
                    [request.params.id]
                );

                if (result.affectedRows === 0) {
                    await fsPromises.rename(deletingFilePath, originalFilePath);
                    return response.status(404).json({ message: "No se encontró el PDF solicitado." });
                }
            } catch (databaseError) {
                try {
                    await fsPromises.rename(deletingFilePath, originalFilePath);
                } catch (restoreError) {
                    console.error("No se pudo restaurar el PDF después de un error de base de datos:", restoreError.message);
                    return next(new Error("No se pudo completar ni revertir la eliminación del PDF."));
                }
                throw databaseError;
            }

            await fsPromises.unlink(deletingFilePath).catch((error) => {
                console.error("No se pudo limpiar el PDF eliminado:", error.message);
            });

            return response.status(204).end();
        } catch (error) {
            if (error.code === "ENOENT" && originalFilePath) {
                try {
                    await pool.execute(
                        "DELETE FROM documentos WHERE id_documento = ?",
                        [request.params.id]
                    );
                    console.warn("Se eliminó el registro de un PDF cuyo archivo ya no existía.");
                    return response.status(204).end();
                } catch (cleanupError) {
                    return next(cleanupError);
                }
            }

            return next(error);
        }
    }
);

app.post("/api/auth/logout", (request, response, next) => {
    request.session.destroy((error) => {
        if (error) {
            return next(error);
        }

        response.clearCookie("simulador.sid", {
            httpOnly: true,
            sameSite: "lax",
            secure: isProduction
        });
        return response.status(204).end();
    });
});

app.use((error, request, response, next) => {
    console.error("Error en la solicitud:", error.message);

    if (response.headersSent) {
        return next(error);
    }

    return response.status(error.status || 500).json({
        message: error.status === 404
            ? error.message
            : "Ocurrió un error interno. Inténtalo más tarde."
    });
});

async function startServer() {
    await pool.query("SELECT 1");
    await sessionStore.onReady();
    await pool.execute("SELECT id_usuario FROM usuarios LIMIT 0");
    await pool.execute("SELECT id_documento FROM documentos LIMIT 0");
    app.listen(port, () => {
        console.log(`Aplicación disponible en http://localhost:${port}`);
    });
}

startServer().catch((error) => {
    console.error("No se pudo iniciar el servidor. Revisa MySQL y el archivo .env:", error.message);
    process.exitCode = 1;
    pool.end().catch((closeError) => {
        console.error("No se pudo cerrar el pool de MySQL:", closeError.message);
    });
});
