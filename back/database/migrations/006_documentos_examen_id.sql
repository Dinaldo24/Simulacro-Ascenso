-- Migración 006: vincula documentos del Repositorio con examenes del Simulador vía examenId.
USE `proyectodirector`;

ALTER TABLE `documentos`
  ADD COLUMN `examenId` INT NULL AFTER `anio`,
  ADD KEY `IDX_documentos_examenId` (`examenId`),
  ADD CONSTRAINT `FK_documentos_examen`
    FOREIGN KEY (`examenId`) REFERENCES `examenes` (`id`) ON DELETE SET NULL;

UPDATE `documentos` d
INNER JOIN `examenes` e
  ON d.`anio` = e.`anio`
 AND d.`curso` = e.`curso`
SET d.`examenId` = e.`id`
WHERE d.`examenId` IS NULL
  AND (
    d.`titulo` LIKE 'Examen EBR %'
    OR RIGHT(d.`nombreOriginal`, 14) = '_Preguntas.pdf'
  );
