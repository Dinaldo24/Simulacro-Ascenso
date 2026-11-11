-- Migración 001: los exámenes desglosados por Python se guardan en MySQL.
-- Las tablas examenes/preguntas/opciones estaban vacías al aplicarla.
USE `proyectodirector`;

ALTER TABLE `examenes`
  ADD COLUMN `anio` VARCHAR(10) NULL AFTER `descripcion`,
  ADD COLUMN `curso` VARCHAR(100) NULL AFTER `anio`,
  ADD COLUMN `archivoBase` VARCHAR(150) NULL AFTER `curso`,
  ADD COLUMN `tieneClave` TINYINT(1) NOT NULL DEFAULT 0 AFTER `archivoBase`,
  ADD COLUMN `creadoEn` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) AFTER `tieneClave`,
  ADD UNIQUE KEY `UQ_examenes_anio_curso` (`anio`, `curso`);

ALTER TABLE `preguntas`
  ADD COLUMN `numero` INT NOT NULL DEFAULT 0 AFTER `texto`,
  ADD COLUMN `contexto` TEXT NULL AFTER `numero`,
  ADD UNIQUE KEY `UQ_preguntas_examen_numero` (`examenId`, `numero`);

ALTER TABLE `opciones`
  ADD COLUMN `letra` CHAR(1) NOT NULL DEFAULT 'A' AFTER `id`,
  MODIFY COLUMN `texto` TEXT NOT NULL;

ALTER TABLE `simulacros_docente`
  ADD COLUMN `examenId` INT NULL AFTER `docenteId`,
  ADD KEY `IDX_simulacros_docente_examenId` (`examenId`),
  ADD CONSTRAINT `FK_simulacros_docente_examen`
    FOREIGN KEY (`examenId`) REFERENCES `examenes` (`id`) ON DELETE SET NULL;

-- Índices pendientes del informe (hallazgo 15)
ALTER TABLE `documentos`
  ADD KEY `IDX_documentos_anio_curso` (`anio`, `curso`),
  ADD KEY `IDX_documentos_creadoEn` (`creadoEn`);
ALTER TABLE `simulacros_docente`
  ADD KEY `IDX_simulacros_docente_docenteId_creadoEn` (`docenteId`, `creadoEn`);
