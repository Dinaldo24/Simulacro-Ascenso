import { Anio } from "../modules/anio/entities/Anio";
import { Curso } from "../modules/curso/entities/Curso";
import { Documento } from "../modules/documento/entities/Documento";
import { Especialidad } from "../modules/especialidad/entities/Especialidad";
import { Examen } from "../modules/examen/entities/Examen";
import { SimulacroDocente } from "../modules/examen/entities/SimulacroDocente";
import { Opcion } from "../modules/opcion/entities/Opcion";
import { Pregunta } from "../modules/pregunta/entities/Pregunta";
import { Usuario } from "../modules/usuario/entities/Usuario";

export const ENTITIES = [
    Usuario,
    Especialidad,
    Anio,
    Curso,
    Examen,
    Pregunta,
    Opcion,
    Documento,
    SimulacroDocente,
];
