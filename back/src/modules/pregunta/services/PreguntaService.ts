import { AppDataSource } from "../../../database/data-source";
import { Examen } from "../../examen/entities/Examen";
import { OpcionNueva } from "../../examen/services/ExamenService";
import { Pregunta } from "../entities/Pregunta";

export async function crearPregunta(
    examenId: number,
    texto: string,
    opciones: OpcionNueva[],
): Promise<Pregunta | null> {
    const examen = await AppDataSource.getRepository(Examen).findOneBy({ id: examenId });
    if (!examen) {
        return null;
    }

    const preguntaRepository = AppDataSource.getRepository(Pregunta);
    const pregunta = preguntaRepository.create({
        texto,
        examen,
        opciones: opciones.map((opcion) => ({
            texto: opcion.texto,
            esCorrecta: opcion.esCorrecta ?? false,
        })),
    });

    return preguntaRepository.save(pregunta);
}

export async function listarPreguntas(): Promise<Pregunta[]> {
    return AppDataSource.getRepository(Pregunta).find({
        relations: { examen: true, opciones: true },
    });
}

export async function buscarPregunta(id: number): Promise<Pregunta | null> {
    return AppDataSource.getRepository(Pregunta).findOne({
        where: { id },
        relations: { examen: true, opciones: true },
    });
}

export async function actualizarPregunta(
    id: number,
    datos: { texto?: string; examenId?: number },
): Promise<Pregunta | null> {
    const preguntaRepository = AppDataSource.getRepository(Pregunta);
    const pregunta = await preguntaRepository.findOneBy({ id });
    if (!pregunta) {
        return null;
    }

    if (datos.texto !== undefined) {
        pregunta.texto = datos.texto;
    }
    if (datos.examenId !== undefined) {
        const examen = await AppDataSource.getRepository(Examen).findOneBy({
            id: datos.examenId,
        });
        if (!examen) {
            return null;
        }
        pregunta.examen = examen;
    }

    await preguntaRepository.save(pregunta);
    return buscarPregunta(id);
}

export async function eliminarPregunta(id: number): Promise<boolean> {
    const resultado = await AppDataSource.getRepository(Pregunta).delete(id);
    return (resultado.affected ?? 0) > 0;
}
