import "dotenv/config";
import bcrypt from "bcryptjs";
import mysql, { type ResultSetHeader } from "mysql2/promise";
import { ask, askSecret } from "./prompts.js";

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

async function main(): Promise<void> {
    const missingDatabaseConfig = ["DB_HOST", "DB_USER", "DB_NAME"]
        .filter((name) => !process.env[name]);

    if (missingDatabaseConfig.length > 0) {
        throw new Error(`Configura estas variables en .env: ${missingDatabaseConfig.join(", ")}.`);
    }

    const username = await ask("Nombre de usuario de la cuenta: ");
    const password = await askSecret("Nueva contraseña (mínimo 12 caracteres, no se mostrará): ");
    const confirmation = await askSecret("Repite la nueva contraseña: ");

    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
        throw new Error(
            "El usuario debe tener entre 3 y 50 caracteres: letras, números, punto, guion o guion bajo."
        );
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
        const [result] = await connection.execute<ResultSetHeader>(
            "UPDATE usuarios SET hash_contrasena = ? WHERE nombre_usuario = ?",
            [hash, username]
        );

        if (result.affectedRows === 0) {
            throw new Error(`No existe una cuenta con el usuario "${username}".`);
        }

        console.log(`Contraseña actualizada para "${username}".`);
    } finally {
        await connection.end();
    }
}

main().catch((error: unknown) => {
    console.error("No se pudo cambiar la contraseña:", getErrorMessage(error));
    process.exitCode = 1;
});
