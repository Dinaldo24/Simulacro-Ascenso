import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("documentos")
export class Documento {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "varchar", length: 150, default: "" })
    titulo: string;

    @Column({ type: "varchar", length: 100, nullable: true })
    curso: string | null;

    @Column({ type: "varchar", length: 50, nullable: true })
    anio: string | null;

    @Column({ type: "varchar", length: 255 })
    nombreOriginal: string;

    @Column({ type: "varchar", length: 60, unique: true })
    nombreArchivo: string;

    @Column({ type: "varchar", length: 100, default: "application/pdf" })
    tipoMime: string;

    @Column({ type: "int", unsigned: true })
    tamanio: number;

    @Column({ type: "varchar", length: 255, nullable: true })
    respuestasNombreOriginal: string | null;

    @Column({ type: "varchar", length: 60, unique: true, nullable: true })
    respuestasNombreArchivo: string | null;

    @Column({ type: "varchar", length: 100, nullable: true })
    respuestasTipoMime: string | null;

    @Column({ type: "int", unsigned: true, nullable: true })
    respuestasTamanio: number | null;

    @Column({ type: "int", default: 1 })
    paginaPortada: number;

    @CreateDateColumn()
    creadoEn: Date;
}
