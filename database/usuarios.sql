-- ATENCION: este script elimina simulador_cole y todos sus datos.
DROP DATABASE IF EXISTS simulador_cole;

CREATE DATABASE simulador_cole;

USE simulador_cole;

CREATE TABLE usuarios (
    id_usuario INT UNSIGNED NOT NULL AUTO_INCREMENT,
    nombre_usuario VARCHAR(50) NOT NULL,
    hash_contrasena VARCHAR(255) NOT NULL,
    nombres VARCHAR(100) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    rol ENUM('administrador', 'director', 'profesor') NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_usuario),
    UNIQUE KEY uq_usuarios_nombre_usuario (nombre_usuario)
) ENGINE = InnoDB;
