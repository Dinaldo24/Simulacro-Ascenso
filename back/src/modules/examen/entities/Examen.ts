import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Unique } from "typeorm";
import { Especialidad } from "../../especialidad/entities/Especialidad";
import { Pregunta } from "../../pregunta/entities/Pregunta";

@Entity("examenes")
@Unique("UQ_examenes_anio_curso", ["anio", "curso"])
export class Examen {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "varchar", length: 150 })
    titulo: string;

    @Column({ type: "text", nullable: true })
    descripcion: string | null;

    @Column({ type: "varchar", length: 10, nullable: true })
    anio: string | null;

    @Column({ type: "varchar", length: 100, nullable: true })
    curso: string | null;

    @Column({ type: "int", nullable: true })
    especialidadId: number | null;

    @ManyToOne(() => Especialidad, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({ name: "especialidadId" })
    especialidad: Especialidad | null;

    /** Prefijo de los archivos en disco (p. ej. "2024_MATEMATICA"); se guarda para no recalcularlo. */
    @Column({ type: "varchar", length: 150, nullable: true })
    archivoBase: string | null;

    @Column({ type: "boolean", default: false })
    tieneClave: boolean;

    @CreateDateColumn()
    creadoEn: Date;

    @OneToMany(() => Pregunta, (pregunta) => pregunta.examen, {
        cascade: ["insert", "update"],
    })
    preguntas: Pregunta[];
}
