import { AppDataSource } from "../../../database/data-source";
import { Examen } from "../entities/Examen";

export interface OpcionNueva {
    texto: string;
    esCorrecta?: boolean;
}

export interface PreguntaNueva {
    texto: string;
    opciones: OpcionNueva[];
}

export interface ExamenNuevo {
    titulo: string;
    descripcion?: string;
    preguntas: PreguntaNueva[];
}

export async function crearExamen(datos: ExamenNuevo): Promise<Examen> {
    const repository = AppDataSource.getRepository(Examen);
    const examen = repository.create({
        titulo: datos.titulo,
        descripcion: datos.descripcion ?? null,
        preguntas: datos.preguntas.map((pregunta) => ({
            texto: pregunta.texto,
            opciones: pregunta.opciones.map((opcion) => ({
                texto: opcion.texto,
                esCorrecta: opcion.esCorrecta ?? false,
            })),
        })),
    });

    return repository.save(examen);
}

export async function listarExamenes(): Promise<Examen[]> {
    return AppDataSource.getRepository(Examen).find({
        relations: { preguntas: { opciones: true } },
    });
}

export async function buscarExamen(id: number): Promise<Examen | null> {
    return AppDataSource.getRepository(Examen).findOne({
        where: { id },
        relations: { preguntas: { opciones: true } },
    });
}

export async function actualizarExamen(
    id: number,
    datos: { titulo?: string; descripcion?: string | null },
): Promise<Examen | null> {
    const repository = AppDataSource.getRepository(Examen);
    const examen = await repository.findOneBy({ id });
    if (!examen) {
        return null;
    }

    if (datos.titulo !== undefined) {
        examen.titulo = datos.titulo;
    }
    if (datos.descripcion !== undefined) {
        examen.descripcion = datos.descripcion;
    }

    await repository.save(examen);
    return buscarExamen(id);
}

export async function eliminarExamen(id: number): Promise<boolean> {
    const resultado = await AppDataSource.getRepository(Examen).delete(id);
    return (resultado.affected ?? 0) > 0;
}
