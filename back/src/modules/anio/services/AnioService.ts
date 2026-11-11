import { AppDataSource } from "../../../database/data-source";
import { Anio } from "../entities/Anio";

export async function crearAnio(nombre: string): Promise<Anio> {
    const repository = AppDataSource.getRepository(Anio);
    return repository.save(repository.create({ nombre }));
}

export async function listarAnios(): Promise<Anio[]> {
    return AppDataSource.getRepository(Anio).find({
        relations: { cursos: true },
        order: { id: "ASC" },
    });
}

export async function buscarAnio(id: number): Promise<Anio | null> {
    return AppDataSource.getRepository(Anio).findOne({
        where: { id },
        relations: { cursos: true },
    });
}

export async function actualizarAnio(id: number, nombre: string): Promise<Anio | null> {
    const repository = AppDataSource.getRepository(Anio);
    const anio = await repository.findOneBy({ id });
    if (!anio) {
        return null;
    }

    anio.nombre = nombre;
    return repository.save(anio);
}

export async function eliminarAnio(
    id: number,
): Promise<"eliminado" | "no-encontrado" | "tiene-cursos"> {
    const repository = AppDataSource.getRepository(Anio);
    const anio = await repository.findOne({
        where: { id },
        relations: { cursos: true },
    });
    if (!anio) {
        return "no-encontrado";
    }
    if (anio.cursos.length > 0) {
        return "tiene-cursos";
    }

    await repository.remove(anio);
    return "eliminado";
}
