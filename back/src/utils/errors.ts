export class AppError extends Error {
    constructor(
        public readonly mensaje: string,
        public readonly statusCode: number = 500,
    ) {
        super(mensaje);
        this.name = new.target.name;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class BadRequestError extends AppError {
    constructor(mensaje: string) {
        super(mensaje, 400);
    }
}

export class UnauthorizedError extends AppError {
    constructor(mensaje: string = "No autorizado.") {
        super(mensaje, 401);
    }
}

export class ForbiddenError extends AppError {
    constructor(mensaje: string = "Acceso denegado.") {
        super(mensaje, 403);
    }
}

export class NotFoundError extends AppError {
    constructor(mensaje: string = "Recurso no encontrado.") {
        super(mensaje, 404);
    }
}

export class ConflictError extends AppError {
    constructor(mensaje: string) {
        super(mensaje, 409);
    }
}
