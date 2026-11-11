import "dotenv/config";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import { ask, askSecret } from "./prompts.js";

const roles = ["administrador", "director", "profesor"] as const;
type UserRole = typeof roles[number];

function isUserRole(role: string): role is UserRole {
    return roles.some((validRole) => validRole === role);
}

function isDuplicateEntryError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error &&
        error.code === "ER_DUP_ENTRY";
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

async function main(): Promise<void> {
    const missingDatabaseConfig = ["DB_HOST", "DB_USER", "DB_NAME"]
        .filter((name) => !process.env[name]);

    if (missingDatabaseConfig.length > 0) {
        throw new Error(`Configura estas variables en .env: ${missingDatabaseConfig.join(", ")}.`);
    }

    const username = await ask("Nombre de usuario: ");
    const nombres = await ask("Nombres: ");
    const apellidos = await ask("Apellidos: ");
    const roleInput = await ask(`Rol (${roles.join("/")}): `);
    const password = await askSecret("Contraseña (mínimo 12 caracteres, no se mostrará): ");
    const confirmation = await askSecret("Repite la contraseña: ");

    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
        throw new Error(
            "El usuario debe tener entre 3 y 50 caracteres: letras, números, punto, guion o guion bajo."
        );
    }
    if (!nombres || nombres.length > 100 || !apellidos || apellidos.length > 100) {
        throw new Error("Escribe nombres y apellidos (máximo 100 caracteres cada uno).");
    }
    if (!isUserRole(roleInput)) {
        throw new Error(`El rol debe ser uno de estos: ${roles.join(", ")}.`);
    }
    if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
        throw new Error("La contraseña debe tener entre 12 y 72 caracteres.");
    }
    if (password !== confirmation) {
        throw new Error("Las contraseñas no coinciden.");
    }

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || "",
        database: process.env.DB_NAME
    });

    try {
        const hash = await bcrypt.hash(password, 12);
        await connection.execute(
            `INSERT INTO usuarios (nombre_usuario, hash_contrasena, nombres, apellidos, rol)
             VALUES (?, ?, ?, ?, ?)`,
            [username, hash, nombres, apellidos, roleInput]
        );
        console.log(`Cuenta "${username}" creada con el rol "${roleInput}".`);
    } finally {
        await connection.end();
    }
}

main().catch((error: unknown) => {
    console.error(
        "No se pudo crear la cuenta:",
        isDuplicateEntryError(error) ? "ese nombre de usuario ya existe." : getErrorMessage(error)
    );
    process.exitCode = 1;
});
