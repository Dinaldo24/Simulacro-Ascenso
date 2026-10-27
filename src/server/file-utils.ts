import { promises as fs } from "node:fs";

export async function removeUploadedFile(filePath: string): Promise<void> {
    try {
        await fs.unlink(filePath);
    } catch (error) {
        console.error(
            "No se pudo limpiar un archivo temporal:",
            error instanceof Error ? error.message : error
        );
    }
}

export async function hasPdfSignature(filePath: string): Promise<boolean> {
    const handle = await fs.open(filePath, "r");

    try {
        const header = Buffer.alloc(5);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        return bytesRead === header.length && header.toString("ascii") === "%PDF-";
    } finally {
        await handle.close();
    }
}

export async function hasCoverImageSignature(
    filePath: string,
    extension: string
): Promise<boolean> {
    const headerLength = extension === ".png" ? 8 : extension === ".webp" ? 12 : 3;
    const handle = await fs.open(filePath, "r");

    try {
        const header = Buffer.alloc(headerLength);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);

        if (bytesRead !== header.length) {
            return false;
        }

        if (extension === ".png") {
            return header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        }

        if (extension === ".webp") {
            return header.toString("ascii", 0, 4) === "RIFF" &&
                header.toString("ascii", 8, 12) === "WEBP";
        }

        return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    } finally {
        await handle.close();
    }
}
