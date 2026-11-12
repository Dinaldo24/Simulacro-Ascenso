-- Migración 005: soporte de PDF opcional de Hoja de Respuestas en documentos del repositorio.
USE `proyectodirector`;

ALTER TABLE `documentos`
  ADD COLUMN `respuestasNombreOriginal` VARCHAR(255) NULL AFTER `tamanio`,
  ADD COLUMN `respuestasNombreArchivo` VARCHAR(60) NULL AFTER `respuestasNombreOriginal`,
  ADD COLUMN `respuestasTipoMime` VARCHAR(100) NULL AFTER `respuestasNombreArchivo`,
  ADD COLUMN `respuestasTamanio` INT UNSIGNED NULL AFTER `respuestasTipoMime`,
  ADD UNIQUE KEY `UQ_documentos_respuestasNombreArchivo` (`respuestasNombreArchivo`);
