import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Anio } from "../../anio/entities/Anio";

@Entity("cursos")
export class Curso {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "varchar", length: 150 })
    nombre: string;

    @Column({ type: "text", nullable: true })
    descripcion: string | null;

    @ManyToOne(() => Anio, (anio) => anio.cursos, {
        nullable: false,
        onDelete: "RESTRICT",
    })
    anio: Anio;
}
