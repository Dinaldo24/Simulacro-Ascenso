-- ============================================================================
-- BASE DE DATOS COMPLETA - SIMULADOR MINEDU
-- Ejecuta este único archivo en tu MySQL (phpMyAdmin, Workbench o consola).
-- Si ya existen las bases de datos, las ELIMINA y las REEMPLAZA desde cero,
-- dejándolas 100% limpias y con la estructura correcta.
-- ============================================================================

-- ============================================================================
-- PARTE 1: BASE DE DATOS PRINCIPAL: proyectodirector
-- ============================================================================

DROP DATABASE IF EXISTS `proyectodirector`;

CREATE DATABASE `proyectodirector`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `proyectodirector`;

-- 1. Tabla: especialidades (catálogo del colegio)
CREATE TABLE IF NOT EXISTS `especialidades` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(100) NOT NULL,
  `creadoEn` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_especialidades_nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cargar especialidades oficiales por defecto
INSERT IGNORE INTO `especialidades` (`nombre`) VALUES
  ('Comunicación'), ('Religión'), ('Educación para el Trabajo'),
  ('Matemática'), ('Pedagogía'), ('Inglés'), ('Arte y Cultura');

-- 2. Tabla: usuarios (cuentas y roles del sistema)
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

-- Usuario administrador inicial por defecto (email: admin@colegio.edu.pe / clave: admin123)
INSERT INTO `usuarios` (`nombre`, `email`, `password`, `role`, `activo`)
VALUES ('Administrador General', 'admin@colegio.edu.pe', '$2b$10$RN2XQirO//mNAFelXN0CFu94A8.cvuxVd0GhseF5arj5xv378EGiq', 'administrador', 1)
ON DUPLICATE KEY UPDATE `password` = VALUES(`password`), `activo` = 1;

-- 3. Tabla: anios
CREATE TABLE IF NOT EXISTS `anios` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_anios_nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Tabla: cursos
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

-- 5. Tabla: examenes (exámenes oficiales MINEDU)
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

-- 6. Tabla: preguntas (preguntas desglosadas con figuras y contexto)
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

-- 7. Tabla: opciones (alternativas A, B, C... con textos y figuras asociadas)
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

-- 8. Tabla: documentos (sincronización de PDFs de preguntas y respuestas)
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

-- 9. Tabla: simulacros_docente (intentos y calificaciones de los docentes)
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


-- ============================================================================
-- PARTE 2: BASE DE DATOS AUXILIAR: simulador_cole (Frontend y Sesiones)
-- ============================================================================

DROP DATABASE IF EXISTS `simulador_cole`;

CREATE DATABASE `simulador_cole`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `simulador_cole`;

-- 10. Tabla: usuarios (antigua en simulador_cole)
CREATE TABLE IF NOT EXISTS `usuarios` (
  `id_usuario` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nombre_usuario` VARCHAR(50) NOT NULL,
  `hash_contrasena` VARCHAR(255) NOT NULL,
  `nombres` VARCHAR(100) NOT NULL,
  `apellidos` VARCHAR(100) NOT NULL,
  `rol` ENUM('administrador', 'director', 'profesor') NOT NULL,
  `activo` BOOLEAN NOT NULL DEFAULT TRUE,
  `creado_en` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_usuario`),
  UNIQUE KEY `uq_usuarios_nombre_usuario` (`nombre_usuario`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Tabla: documentos (en simulador_cole)
CREATE TABLE IF NOT EXISTS `documentos` (
  `id_documento` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `titulo` VARCHAR(150) NOT NULL,
  `nombre_archivo` VARCHAR(255) NOT NULL,
  `archivo_guardado` VARCHAR(100) NOT NULL,
  `tamano_bytes` BIGINT UNSIGNED NOT NULL,
  `subido_por` INT UNSIGNED NULL,
  `curso` VARCHAR(150) NULL,
  `anio` VARCHAR(50) NULL,
  `fecha_subida` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_documento`),
  UNIQUE KEY `uq_documentos_archivo_guardado` (`archivo_guardado`),
  KEY `idx_documentos_fecha_subida` (`fecha_subida`),
  KEY `idx_documentos_subido_por` (`subido_por`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. Tabla: portadas_documentos (en simulador_cole)
CREATE TABLE IF NOT EXISTS `portadas_documentos` (
  `id_documento` INT UNSIGNED NOT NULL,
  `pagina_pdf` INT UNSIGNED NOT NULL DEFAULT 1,
  `archivo_imagen` VARCHAR(100) NULL,
  PRIMARY KEY (`id_documento`),
  CONSTRAINT `fk_portadas_documento`
    FOREIGN KEY (`id_documento`)
    REFERENCES `documentos` (`id_documento`)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
