require("dotenv").config();

const readline = require("node:readline");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");

function ask(question) {
    const terminal = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        terminal.question(question, (answer) => {
            terminal.close();
            resolve(answer.trim());
        });
    });
}

function askSecret(question) {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
        throw new Error("Ejecuta este comando desde una terminal interactiva para ingresar la contraseña de forma oculta.");
    }

    return new Promise((resolve, reject) => {
        let value = "";
        process.stdout.write(question);
        process.stdin.setEncoding("utf8");
        process.stdin.setRawMode(true);
        process.stdin.resume();

        function finish(error) {
            process.stdin.removeListener("data", onData);
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdout.write("\n");

            if (error) {
                reject(error);
            } else {
                resolve(value);
            }
        }

        function onData(character) {
            if (character === "\u0003") {
                finish(new Error("Operación cancelada."));
                return;
            }

            if (character === "\r" || character === "\n") {
                finish();
                return;
            }

            if (character === "\u0008" || character === "\u007f") {
                value = value.slice(0, -1);
                return;
            }

            if (character >= " ") {
                value += character;
            }
        }

        process.stdin.on("data", onData);
    });
}

async function main() {
    const missingDatabaseConfig = ["DB_HOST", "DB_USER", "DB_NAME"]
        .filter((name) => !process.env[name]);

    if (missingDatabaseConfig.length > 0) {
        throw new Error(`Configura estas variables en .env: ${missingDatabaseConfig.join(", ")}.`);
    }

    const username = await ask("Nombre de usuario de la cuenta: ");
    const password = await askSecret("Nueva contraseña (mínimo 12 caracteres, no se mostrará): ");
    const confirmation = await askSecret("Repite la nueva contraseña: ");

    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
        throw new Error("El usuario debe tener entre 3 y 50 caracteres: letras, números, punto, guion o guion bajo.");
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
        const [result] = await connection.execute(
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

main().catch((error) => {
    console.error("No se pudo cambiar la contraseña:", error.message);
    process.exitCode = 1;
});
