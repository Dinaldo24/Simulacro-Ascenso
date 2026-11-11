USE simulador_cole;

CREATE TABLE IF NOT EXISTS documentos (
    id_documento INT UNSIGNED NOT NULL AUTO_INCREMENT,
    titulo VARCHAR(150) NOT NULL,
    nombre_archivo VARCHAR(255) NOT NULL,
    archivo_guardado VARCHAR(100) NOT NULL,
    tamano_bytes BIGINT UNSIGNED NOT NULL,
    subido_por INT UNSIGNED NOT NULL,
    curso VARCHAR(150) NULL,
    anio VARCHAR(50) NULL,
    fecha_subida TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_documento),
    UNIQUE KEY uq_documentos_archivo_guardado (archivo_guardado),
    KEY idx_documentos_fecha_subida (fecha_subida),
    KEY idx_documentos_subido_por (subido_por),
    CONSTRAINT fk_documentos_usuario
        FOREIGN KEY (subido_por)
        REFERENCES usuarios (id_usuario)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS portadas_documentos (
    id_documento INT UNSIGNED NOT NULL,
    pagina_pdf INT UNSIGNED NOT NULL DEFAULT 1,
    archivo_imagen VARCHAR(100) NULL,
    PRIMARY KEY (id_documento),
    CONSTRAINT fk_portadas_documento
        FOREIGN KEY (id_documento)
        REFERENCES documentos (id_documento)
        ON UPDATE CASCADE
        ON DELETE CASCADE
) ENGINE = InnoDB;
