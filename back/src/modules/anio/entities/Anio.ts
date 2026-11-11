import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Curso } from "../../curso/entities/Curso";

@Entity("anios")
export class Anio {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "varchar", length: 100, unique: true })
    nombre: string;

    @OneToMany(() => Curso, (curso) => curso.anio)
    cursos: Curso[];
}
