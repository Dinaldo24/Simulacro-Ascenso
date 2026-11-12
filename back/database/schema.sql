-- ============================================================================
-- Esquema canónico de Base de Datos: proyectodirector (MySQL 8 / InnoDB)
-- Charset: utf8mb4 / utf8mb4_unicode_ci (compatible 100% con entidades TypeORM)
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `proyectodirector`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `proyectodirector`;

-- ----------------------------------------------------------------------------
-- 0. Tabla: especialidades (catálogo del colegio; migración 002)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `especialidades` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(100) NOT NULL,
  `creadoEn` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_especialidades_nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 1. Tabla: usuarios
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `usuarios` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(100) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `role` ENUM('director', 'profesor', 'administrador', 'alumno') NOT NULL DEFAULT 'profesor',
  `especialidadId` INT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `creadoEn` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `actualizadoEn` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_usuarios_email` (`email`),
  KEY `IDX_usuarios_especialidadId` (`especialidadId`),
  CONSTRAINT `FK_usuarios_especialidad`
    FOREIGN KEY (`especialidadId`) REFERENCES `especialidades` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. Tabla: anios
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `anios` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_anios_nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. Tabla: cursos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `cursos` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(150) NOT NULL,
  `descripcion` TEXT NULL,
  `anioId` INT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_cursos_anioId` (`anioId`),
  CONSTRAINT `FK_cursos_anio`
    FOREIGN KEY (`anioId`) REFERENCES `anios` (`id`)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 4. Tabla: examenes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `examenes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `titulo` VARCHAR(150) NOT NULL,
  `descripcion` TEXT NULL,
  `anio` VARCHAR(10) NULL,
  `curso` VARCHAR(100) NULL,
  `especialidadId` INT NULL,
  `archivoBase` VARCHAR(150) NULL,
  `tieneClave` TINYINT(1) NOT NULL DEFAULT 0,
  `creadoEn` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_examenes_anio_curso` (`anio`, `curso`),
  KEY `IDX_examenes_especialidadId` (`especialidadId`),
  CONSTRAINT `FK_examenes_especialidad`
    FOREIGN KEY (`especialidadId`) REFERENCES `especialidades` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 5. Tabla: preguntas
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `preguntas` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `texto` TEXT NOT NULL,
  `numero` INT NOT NULL DEFAULT 0,
  `contexto` TEXT NULL,
  `figuras` JSON NULL,
  `examenId` INT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_preguntas_examen_numero` (`examenId`, `numero`),
  KEY `IDX_preguntas_examenId` (`examenId`),
  CONSTRAINT `FK_preguntas_examen`
    FOREIGN KEY (`examenId`) REFERENCES `examenes` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 6. Tabla: opciones
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `opciones` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `letra` CHAR(1) NOT NULL DEFAULT 'A',
  `texto` TEXT NOT NULL,
  `figura` VARCHAR(100) NULL,
  `esCorrecta` TINYINT NOT NULL DEFAULT 0,
  `preguntaId` INT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_opciones_preguntaId` (`preguntaId`),
  CONSTRAINT `FK_opciones_pregunta`
    FOREIGN KEY (`preguntaId`) REFERENCES `preguntas` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 7. Tabla: documentos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `documentos` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `titulo` VARCHAR(150) NOT NULL DEFAULT '',
  `curso` VARCHAR(100) NULL,
  `anio` VARCHAR(50) NULL,
  `examenId` INT NULL,
  `nombreOriginal` VARCHAR(255) NOT NULL,
  `nombreArchivo` VARCHAR(60) NOT NULL,
  `tipoMime` VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  `tamanio` INT UNSIGNED NOT NULL,
  `respuestasNombreOriginal` VARCHAR(255) NULL,
  `respuestasNombreArchivo` VARCHAR(60) NULL,
  `respuestasTipoMime` VARCHAR(100) NULL,
  `respuestasTamanio` INT UNSIGNED NULL,
  `paginaPortada` INT NOT NULL DEFAULT 1,
  `creadoEn` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_documentos_nombreArchivo` (`nombreArchivo`),
  UNIQUE KEY `UQ_documentos_respuestasNombreArchivo` (`respuestasNombreArchivo`),
  KEY `IDX_documentos_anio_curso` (`anio`, `curso`),
  KEY `IDX_documentos_creadoEn` (`creadoEn`),
  KEY `IDX_documentos_examenId` (`examenId`),
  CONSTRAINT `FK_documentos_examen`
    FOREIGN KEY (`examenId`) REFERENCES `examenes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 8. Tabla: simulacros_docente
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `simulacros_docente` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `docenteId` INT NOT NULL,
  `examenId` INT NULL,
  `curso` VARCHAR(100) NOT NULL,
  `anio` VARCHAR(10) NOT NULL,
  `totalPreguntas` INT NOT NULL,
  `aciertos` INT NOT NULL,
  `desaciertos` INT NOT NULL,
  `puntaje` DECIMAL(5, 2) NOT NULL,
  `tiempoSegundos` INT NOT NULL DEFAULT 0,
  `detalleRespuestas` JSON NULL,
  `creadoEn` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_simulacros_docente_docenteId_creadoEn` (`docenteId`, `creadoEn`),
  KEY `IDX_simulacros_docente_examenId` (`examenId`),
  CONSTRAINT `FK_simulacros_docente_examen`
    FOREIGN KEY (`examenId`) REFERENCES `examenes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `FK_simulacros_docente_usuario`
    FOREIGN KEY (`docenteId`) REFERENCES `usuarios` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
