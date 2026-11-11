import { AppDataSource } from "../../../database/data-source";
import { Anio } from "../../anio/entities/Anio";
import { Curso } from "../entities/Curso";

export interface DatosCurso {
    nombre: string;
    descripcion?: string | null;
    anioId: number;
}

export async function crearCurso(datos: DatosCurso): Promise<Curso | null> {
    const anio = await AppDataSource.getRepository(Anio).findOneBy({
        id: datos.anioId,
    });
    if (!anio) {
        return null;
    }

    const repository = AppDataSource.getRepository(Curso);
    const curso = repository.create({
        nombre: datos.nombre,
        descripcion: datos.descripcion ?? null,
        anio,
    });
    return repository.save(curso);
}

export async function listarCursos(): Promise<Curso[]> {
    return AppDataSource.getRepository(Curso).find({
        relations: { anio: true },
        order: { id: "ASC" },
    });
}

export async function buscarCurso(id: number): Promise<Curso | null> {
    return AppDataSource.getRepository(Curso).findOne({
        where: { id },
        relations: { anio: true },
    });
}

export async function actualizarCurso(
    id: number,
    datos: Partial<DatosCurso>,
): Promise<Curso | null> {
    const repository = AppDataSource.getRepository(Curso);
    const curso = await repository.findOneBy({ id });
    if (!curso) {
        return null;
    }

    if (datos.anioId !== undefined) {
        const anio = await AppDataSource.getRepository(Anio).findOneBy({
            id: datos.anioId,
        });
        if (!anio) {
            return null;
        }
        curso.anio = anio;
    }

    if (datos.nombre !== undefined) {
        curso.nombre = datos.nombre;
    }
    if (datos.descripcion !== undefined) {
        curso.descripcion = datos.descripcion;
    }

    await repository.save(curso);
    return buscarCurso(id);
}

export async function eliminarCurso(id: number): Promise<boolean> {
    const resultado = await AppDataSource.getRepository(Curso).delete(id);
    return (resultado.affected ?? 0) > 0;
}
