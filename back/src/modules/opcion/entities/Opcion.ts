import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Pregunta } from "../../pregunta/entities/Pregunta";

@Entity("opciones")
export class Opcion {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "char", length: 1, default: "A" })
    letra: string;

    @Column({ type: "text" })
    texto: string;

    @Column({ type: "varchar", length: 100, nullable: true })
    figura: string | null;

    @Column({ type: "boolean", default: false })
    esCorrecta: boolean;

    @ManyToOne(() => Pregunta, (pregunta) => pregunta.opciones, {
        nullable: false,
        onDelete: "CASCADE",
    })
    pregunta: Pregunta;
}
