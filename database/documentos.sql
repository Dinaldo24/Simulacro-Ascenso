USE simulador_cole;

CREATE TABLE IF NOT EXISTS documentos (
    id_documento INT UNSIGNED NOT NULL AUTO_INCREMENT,
    titulo VARCHAR(150) NOT NULL,
    nombre_archivo VARCHAR(255) NOT NULL,
    archivo_guardado VARCHAR(100) NOT NULL,
    tamano_bytes BIGINT UNSIGNED NOT NULL,
    subido_por INT UNSIGNED NOT NULL,
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
