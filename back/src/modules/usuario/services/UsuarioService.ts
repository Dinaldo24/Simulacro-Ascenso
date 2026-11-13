import { compare, hash } from "bcryptjs";
import { AppDataSource } from "../../../database/data-source";
import { BadRequestError } from "../../../utils/errors";
import { Especialidad } from "../../especialidad/entities/Especialidad";
import { RolUsuario, Usuario } from "../entities/Usuario";

export interface DatosCrearUsuario {
    nombre: string;
    email: string;
    password: string;
    role?: RolUsuario;
    especialidadId?: number | null | undefined;
}

export interface DatosActualizarUsuario {
    nombre?: string | undefined;
    email?: string | undefined;
    password?: string | undefined;
    role?: RolUsuario | undefined;
    activo?: boolean | undefined;
    especialidadId?: number | null | undefined;
}

export async function listarUsuarios(): Promise<Omit<Usuario, "password">[]> {
    const repository = AppDataSource.getRepository(Usuario);
    const usuarios = await repository.find({
        order: { creadoEn: "DESC" },
    });

    return usuarios.map(({ password: _, ...usuarioSinPassword }) => usuarioSinPassword as Usuario);
}

export async function buscarUsuarioPorId(id: number): Promise<Omit<Usuario, "password"> | null> {
    const repository = AppDataSource.getRepository(Usuario);
    const usuario = await repository.findOneBy({ id });
    if (!usuario) return null;

    const { password: _, ...usuarioSinPassword } = usuario;
    return usuarioSinPassword as Usuario;
}

async function validarEspecialidad(id: number | null | undefined): Promise<void> {
    if (id === null || id === undefined) return;
    if (!(await AppDataSource.getRepository(Especialidad).existsBy({ id }))) {
        throw new BadRequestError("La especialidad indicada no existe.");
    }
}

export async function crearUsuario(
    datos: DatosCrearUsuario,
): Promise<Omit<Usuario, "password">> {
    const repository = AppDataSource.getRepository(Usuario);
    const rol = datos.role ?? RolUsuario.PROFESOR;
    if (rol === RolUsuario.PROFESOR && !datos.especialidadId) {
        throw new BadRequestError("Asigna una especialidad al docente.");
    }
    await validarEspecialidad(datos.especialidadId);
    const passwordHasheado = await hash(datos.password, 10);
    const usuario = repository.create({
        nombre: datos.nombre,
        email: datos.email,
        password: passwordHasheado,
        role: rol,
        especialidadId: rol === RolUsuario.PROFESOR ? (datos.especialidadId ?? null) : null,
        activo: true,
    });

    const guardado = await repository.save(usuario);
    const recargado = await repository.findOneByOrFail({ id: guardado.id });
    const { password: _, ...usuarioSinPassword } = recargado;
    return usuarioSinPassword as Usuario;
}

export async function actualizarUsuario(
    id: number,
    datos: DatosActualizarUsuario,
    actorId?: number,
): Promise<Omit<Usuario, "password"> | null> {
    if (actorId !== undefined && id === actorId && datos.activo === false) {
        throw new BadRequestError("Por seguridad, no puedes deshabilitar tu propia cuenta activa.");
    }

    const repository = AppDataSource.getRepository(Usuario);
    const usuario = await repository.findOneBy({ id });
    if (!usuario) return null;

    if (
        actorId !== undefined &&
        id === actorId &&
        datos.role !== undefined &&
        datos.role !== usuario.role
    ) {
        throw new BadRequestError("Por seguridad, no puedes cambiar tu propio rol.");
    }

    if (datos.nombre !== undefined) usuario.nombre = datos.nombre.trim();
    if (datos.email !== undefined) usuario.email = datos.email.trim().toLowerCase();
    if (datos.role !== undefined) usuario.role = datos.role;
    if (datos.activo !== undefined) usuario.activo = Boolean(datos.activo);
    if (datos.especialidadId !== undefined) {
        await validarEspecialidad(datos.especialidadId);
        usuario.especialidadId = datos.especialidadId;
    }
    if (usuario.role === RolUsuario.PROFESOR && !usuario.especialidadId) {
        throw new BadRequestError("Asigna una especialidad al docente.");
    }
    if (usuario.role !== RolUsuario.PROFESOR) usuario.especialidadId = null;
    if (datos.password && datos.password.trim().length >= 6) {
        usuario.password = await hash(datos.password.trim(), 10);
    }

    await repository.save(usuario);
    const recargado = await repository.findOneByOrFail({ id });
    const { password: _, ...usuarioSinPassword } = recargado;
    return usuarioSinPassword as Usuario;
}

export async function alternarEstadoUsuario(
    id: number,
    activo: boolean,
    actorId?: number,
): Promise<boolean> {
    if (actorId !== undefined && id === actorId && !activo) {
        throw new BadRequestError("Por seguridad, no puedes deshabilitar tu propia cuenta activa.");
    }

    const repository = AppDataSource.getRepository(Usuario);
    const resultado = await repository.update(id, { activo });
    return (resultado.affected ?? 0) > 0;
}

export async function autenticarUsuario(
    email: string,
    password: string,
): Promise<{ usuario: Usuario | null; inactivo: boolean }> {
    const usuario = await AppDataSource.getRepository(Usuario).findOneBy({ email });
    if (!usuario) {
        return { usuario: null, inactivo: false };
    }

    const esHashBcrypt = usuario.password.startsWith("$2b$") || usuario.password.startsWith("$2a$");
    const esPasswordValida = esHashBcrypt
        ? await compare(password, usuario.password)
        : usuario.password === password;

    if (!esPasswordValida) {
        return { usuario: null, inactivo: false };
    }

    if (usuario.activo === false) {
        return { usuario: null, inactivo: true };
    }

    // Si estaba guardada en texto plano (ej: insertada manualmente en Workbench), actualizar al hash seguro
    if (!esHashBcrypt) {
        usuario.password = await hash(password, 10);
        await AppDataSource.getRepository(Usuario).save(usuario);
    }

    return { usuario, inactivo: false };
}
