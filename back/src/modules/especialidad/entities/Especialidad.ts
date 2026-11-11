import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("especialidades")
export class Especialidad {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "varchar", length: 100, unique: true })
    nombre: string;

    @CreateDateColumn()
    creadoEn: Date;
}
