-- Migración 003: figuras recortadas del PDF por pregunta (lista de nombres de archivo PNG).
USE `proyectodirector`;

ALTER TABLE `preguntas` ADD COLUMN `figuras` JSON NULL AFTER `contexto`;
