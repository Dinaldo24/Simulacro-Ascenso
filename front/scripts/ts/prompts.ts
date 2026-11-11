import readline from "node:readline";

export function ask(question: string): Promise<string> {
    const terminal = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        terminal.question(question, (answer: string) => {
            terminal.close();
            resolve(answer.trim());
        });
    });
}

export function askSecret(question: string): Promise<string> {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
        throw new Error(
            "Ejecuta este comando desde una terminal interactiva para ingresar la contraseña de forma oculta."
        );
    }

    return new Promise((resolve, reject) => {
        let value = "";
        process.stdout.write(question);
        process.stdin.setEncoding("utf8");
        process.stdin.setRawMode(true);
        process.stdin.resume();

        function finish(error?: Error): void {
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

        function onData(character: string): void {
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
