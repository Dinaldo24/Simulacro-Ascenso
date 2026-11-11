import { Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn, Unique } from "typeorm";
import { Examen } from "../../examen/entities/Examen";
import { Opcion } from "../../opcion/entities/Opcion";

@Entity("preguntas")
@Unique("UQ_preguntas_examen_numero", ["examen", "numero"])
export class Pregunta {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "text" })
    texto: string;

    @Column({ type: "int", default: 0 })
    numero: number;

    /** Texto compartido (lectura/contexto) que antecede a un grupo de preguntas. */
    @Column({ type: "text", nullable: true })
    contexto: string | null;

    /** Archivos PNG de las figuras de la pregunta (carpeta <archivoBase>_figuras del examen). */
    @Column({ type: "json", nullable: true })
    figuras: string[] | null;

    @ManyToOne(() => Examen, (examen) => examen.preguntas, {
        nullable: false,
        onDelete: "CASCADE",
    })
    examen: Examen;

    @OneToMany(() => Opcion, (opcion) => opcion.pregunta, {
        cascade: ["insert", "update"],
    })
    opciones: Opcion[];
}
