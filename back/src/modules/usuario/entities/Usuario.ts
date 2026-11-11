import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";

import { Especialidad } from "../../especialidad/entities/Especialidad";

export enum RolUsuario {
    DIRECTOR = "director",
    PROFESOR = "profesor",
    ADMINISTRADOR = "administrador",
    ALUMNO = "alumno",
}

@Entity("usuarios")
export class Usuario {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "varchar", length: 100 })
    nombre: string;

    @Column({ type: "varchar", length: 255, unique: true })
    email: string;

    @Column({ type: "varchar", length: 255 })
    password: string;

    @Column({
        type: "enum",
        enum: RolUsuario,
        default: RolUsuario.PROFESOR,
    })
    role: RolUsuario;

    @Column({ type: "int", nullable: true })
    especialidadId: number | null;

    @ManyToOne(() => Especialidad, { nullable: true, onDelete: "SET NULL", eager: true })
    @JoinColumn({ name: "especialidadId" })
    especialidad: Especialidad | null;

    @Column({ type: "boolean", default: true })
    activo: boolean;

    @CreateDateColumn()
    creadoEn: Date;

    @UpdateDateColumn()
    actualizadoEn: Date;
}
