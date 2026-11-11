import { AppDataSource } from "../../../database/data-source";
import { Pregunta } from "../../pregunta/entities/Pregunta";
import { Opcion } from "../entities/Opcion";

export async function crearOpcion(
    preguntaId: number,
    texto: string,
    esCorrecta: boolean,
): Promise<Opcion | null> {
    const pregunta = await AppDataSource.getRepository(Pregunta).findOneBy({
        id: preguntaId,
    });
    if (!pregunta) {
        return null;
    }

    const repository = AppDataSource.getRepository(Opcion);
    return repository.save(repository.create({ pregunta, texto, esCorrecta }));
}

export async function listarOpciones(): Promise<Opcion[]> {
    return AppDataSource.getRepository(Opcion).find({
        relations: { pregunta: true },
    });
}

export async function buscarOpcion(id: number): Promise<Opcion | null> {
    return AppDataSource.getRepository(Opcion).findOne({
        where: { id },
        relations: { pregunta: true },
    });
}

export async function actualizarOpcion(
    id: number,
    datos: { texto?: string; esCorrecta?: boolean; preguntaId?: number },
): Promise<Opcion | null> {
    const repository = AppDataSource.getRepository(Opcion);
    const opcion = await repository.findOneBy({ id });
    if (!opcion) {
        return null;
    }

    if (datos.texto !== undefined) {
        opcion.texto = datos.texto;
    }
    if (datos.esCorrecta !== undefined) {
        opcion.esCorrecta = datos.esCorrecta;
    }
    if (datos.preguntaId !== undefined) {
        const pregunta = await AppDataSource.getRepository(Pregunta).findOneBy({
            id: datos.preguntaId,
        });
        if (!pregunta) {
            return null;
        }
        opcion.pregunta = pregunta;
    }

    await repository.save(opcion);
    return buscarOpcion(id);
}

export async function eliminarOpcion(id: number): Promise<boolean> {
    const resultado = await AppDataSource.getRepository(Opcion).delete(id);
    return (resultado.affected ?? 0) > 0;
}
