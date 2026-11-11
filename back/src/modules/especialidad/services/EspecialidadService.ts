import { AppDataSource } from "../../../database/data-source";
import { BadRequestError, ConflictError, NotFoundError } from "../../../utils/errors";
import { Examen } from "../../examen/entities/Examen";
import { Usuario } from "../../usuario/entities/Usuario";
import { Especialidad } from "../entities/Especialidad";

export async function listarEspecialidades(): Promise<Especialidad[]> {
    return AppDataSource.getRepository(Especialidad).find({ order: { nombre: "ASC" } });
}

export async function buscarEspecialidad(id: number): Promise<Especialidad | null> {
    return AppDataSource.getRepository(Especialidad).findOneBy({ id });
}

export async function crearEspecialidad(nombre: string): Promise<Especialidad> {
    const repo = AppDataSource.getRepository(Especialidad);
    const limpio = nombre.trim();
    if (!limpio || limpio.length > 100) {
        throw new BadRequestError("El nombre de la especialidad es obligatorio (máximo 100 caracteres).");
    }
    // La colación ignora mayúsculas y tildes: "Ingles" e "Inglés" cuentan como duplicado.
    if (await repo.findOneBy({ nombre: limpio })) {
        throw new ConflictError("Ya existe una especialidad con ese nombre.");
    }
    return repo.save(repo.create({ nombre: limpio }));
}

export async function eliminarEspecialidad(id: number): Promise<void> {
    const repo = AppDataSource.getRepository(Especialidad);
    const especialidad = await repo.findOneBy({ id });
    if (!especialidad) throw new NotFoundError("No se encontró la especialidad.");
    const [docentes, examenes] = await Promise.all([
        AppDataSource.getRepository(Usuario).countBy({ especialidadId: id }),
        AppDataSource.getRepository(Examen).countBy({ especialidadId: id }),
    ]);
    if (docentes > 0 || examenes > 0) {
        throw new ConflictError(
            `No se puede eliminar: la usan ${docentes} usuario(s) y ${examenes} examen(es).`,
        );
    }
    await repo.remove(especialidad);
}
