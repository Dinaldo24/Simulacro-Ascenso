-- Migración 002: catálogo de especialidades definido por el colegio.
-- Los docentes y los exámenes se vinculan a una especialidad.
USE `proyectodirector`;

CREATE TABLE IF NOT EXISTS `especialidades` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(100) NOT NULL,
  `creadoEn` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_especialidades_nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `especialidades` (`nombre`) VALUES
  ('Comunicación'), ('Religión'), ('Educación para el Trabajo'),
  ('Matemática'), ('Pedagogía'), ('Inglés'), ('Arte y Cultura');

ALTER TABLE `usuarios`
  ADD COLUMN `especialidadId` INT NULL AFTER `role`,
  ADD KEY `IDX_usuarios_especialidadId` (`especialidadId`),
  ADD CONSTRAINT `FK_usuarios_especialidad`
    FOREIGN KEY (`especialidadId`) REFERENCES `especialidades` (`id`) ON DELETE SET NULL;

ALTER TABLE `examenes`
  ADD COLUMN `especialidadId` INT NULL AFTER `curso`,
  ADD KEY `IDX_examenes_especialidadId` (`especialidadId`),
  ADD CONSTRAINT `FK_examenes_especialidad`
    FOREIGN KEY (`especialidadId`) REFERENCES `especialidades` (`id`) ON DELETE SET NULL;

-- Vincula los exámenes ya importados (la colación ignora tildes y mayúsculas) y normaliza el nombre.
UPDATE `examenes` SET `curso` = 'Pedagogía' WHERE `curso` = 'pedadogia';
UPDATE `documentos` SET `curso` = 'Pedagogía' WHERE `curso` = 'pedadogia';
UPDATE `simulacros_docente` SET `curso` = 'Pedagogía' WHERE `curso` = 'pedadogia';
UPDATE `examenes` e JOIN `especialidades` s ON e.`curso` = s.`nombre`
  SET e.`especialidadId` = s.`id`, e.`curso` = s.`nombre`;
UPDATE `documentos` d JOIN `especialidades` s ON d.`curso` = s.`nombre`
  SET d.`curso` = s.`nombre`, d.`titulo` = CONCAT('Examen EBR ', s.`nombre`, ' ', d.`anio`)
  WHERE d.`titulo` LIKE 'Examen EBR %';
UPDATE `simulacros_docente` h JOIN `especialidades` s ON h.`curso` = s.`nombre`
  SET h.`curso` = s.`nombre`;
