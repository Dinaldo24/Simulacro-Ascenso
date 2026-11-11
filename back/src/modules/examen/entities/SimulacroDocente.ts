import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Examen } from "./Examen";
import { Usuario } from "../../usuario/entities/Usuario";

@Entity("simulacros_docente")
export class SimulacroDocente {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "int" })
    docenteId: number;

    @ManyToOne(() => Usuario, { onDelete: "CASCADE" })
    docente: Usuario;

    @Column({ type: "int", nullable: true })
    examenId: number | null;

    @ManyToOne(() => Examen, { nullable: true, onDelete: "SET NULL" })
    examen: Examen | null;

    @Column({ type: "varchar", length: 100 })
    curso: string;

    @Column({ type: "varchar", length: 10 })
    anio: string;

    @Column({ type: "int" })
    totalPreguntas: number;

    @Column({ type: "int" })
    aciertos: number;

    @Column({ type: "int" })
    desaciertos: number;

    @Column({ type: "decimal", precision: 5, scale: 2 })
    puntaje: number;

    @Column({ type: "int", default: 0 })
    tiempoSegundos: number;

    @Column({ type: "json", nullable: true })
    detalleRespuestas: Record<string, string> | null;

    @CreateDateColumn()
    creadoEn: Date;
}
