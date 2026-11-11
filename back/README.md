# ProyectoDirector API — guía para frontend

Documentación de las rutas disponibles para integrar el frontend con la API.

## Conexión

- **Base URL local:** `http://localhost:3002`
- **Formato habitual:** JSON (`Content-Type: application/json`)
- **Puerto:** `3002`

Inicia el servidor para desarrollo con `npm run dev`. Para compilar y ejecutar, usa `npm run build` y `npm start`.

Si el frontend corre en otro puerto/origen, el navegador puede bloquear las peticiones porque el backend todavía no tiene CORS configurado. En ese caso, habilita CORS en el servidor o usa un proxy de desarrollo del frontend. Si frontend y API están en equipos distintos, reemplaza `localhost` por la dirección accesible del servidor.

## Autenticación

`POST /usuarios` y `POST /usuarios/login` son públicos. Todas las rutas de años, cursos, exámenes, preguntas, opciones y documentos requieren el token JWT que entrega el login.

En cada petición protegida, envía:

```http
Authorization: Bearer TU_TOKEN_JWT
```

El token dura una hora. Si falta o no es válido, la API responde `401`. Los roles posibles son `director`, `profesor` y `administrador`; actualmente el registro asigna `profesor` por defecto y el token no limita las rutas según el rol.

Ejemplo básico desde el frontend:

```js
const respuesta = await fetch("http://localhost:3002/anios", {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

const datos = await respuesta.json();
```

Para requests JSON que envían datos, agrega `Content-Type: application/json` y serializa el cuerpo con `JSON.stringify`.

## Usuarios

| Método | Ruta | Auth | Uso |
|---|---|---|---|
| `POST` | `/usuarios` | No | Registrar usuario |
| `POST` | `/usuarios/login` | No | Iniciar sesión |

### Registrar — `POST /usuarios`

Request:

```json
{
  "nombre": "Ana Pérez",
  "email": "ana@example.com",
  "password": "mi contraseña"
}
```

Respuesta `201`:

```json
{
  "id": 1,
  "nombre": "Ana Pérez",
  "email": "ana@example.com",
  "role": "profesor",
  "creadoEn": "2026-10-28T19:00:00.000Z",
  "actualizadoEn": "2026-10-28T19:00:00.000Z"
}
```

La contraseña se guarda como hash y nunca se devuelve. El rol se asigna como `profesor`.

### Login — `POST /usuarios/login`

Request:

```json
{
  "email": "ana@example.com",
  "password": "mi contraseña"
}
```

Respuesta `200`:

```json
{
  "mensaje": "Inicio de sesión correcto.",
  "token": "JWT",
  "usuario": {
    "id": 1,
    "nombre": "Ana Pérez",
    "email": "ana@example.com",
    "role": "profesor"
  }
}
```

Credenciales inválidas: `401`.

## Años

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/anios` | Crear año |
| `GET` | `/anios` | Listar años con sus cursos |
| `GET` | `/anios/:id` | Obtener año con sus cursos |
| `PUT` | `/anios/:id` | Cambiar nombre |
| `DELETE` | `/anios/:id` | Eliminar año sin cursos |

Crear o actualizar:

```json
{
  "nombre": "2026"
}
```

Respuesta de ejemplo:

```json
{
  "id": 1,
  "nombre": "2026",
  "cursos": []
}
```

No se puede eliminar un año que tenga cursos; devuelve `409`.

## Cursos

Cada curso pertenece a un año mediante `anioId`.

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/cursos` | Crear curso |
| `GET` | `/cursos` | Listar cursos |
| `GET` | `/cursos/:id` | Obtener curso |
| `PUT` | `/cursos/:id` | Actualizar curso |
| `DELETE` | `/cursos/:id` | Eliminar curso |

Crear:

```json
{
  "nombre": "Matemáticas",
  "descripcion": "Curso anual",
  "anioId": 1
}
```

Respuesta de ejemplo:

```json
{
  "id": 1,
  "nombre": "Matemáticas",
  "descripcion": "Curso anual",
  "anioId": 1,
  "anio": "2026"
}
```

`descripcion` es opcional y admite `null`. En `PUT`, envía uno o más de `nombre`, `descripcion` y `anioId`.

## Exámenes

Un examen contiene varias preguntas; cada pregunta contiene varias opciones.

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/examenes` | Crear examen junto a preguntas y opciones |
| `GET` | `/examenes` | Listar exámenes con preguntas y opciones |
| `GET` | `/examenes/:id` | Obtener examen con preguntas y opciones |
| `PUT` | `/examenes/:id` | Actualizar título o descripción |
| `DELETE` | `/examenes/:id` | Eliminar examen y sus preguntas/opciones |

Crear:

```json
{
  "titulo": "Examen de ciencias",
  "descripcion": "Evaluación del tema",
  "preguntas": [
    {
      "texto": "¿Cuál es el planeta rojo?",
      "opciones": [
        { "texto": "Marte", "esCorrecta": true },
        { "texto": "Venus", "esCorrecta": false }
      ]
    }
  ]
}
```

Respuesta de ejemplo:

```json
{
  "id": 1,
  "titulo": "Examen de ciencias",
  "descripcion": "Evaluación del tema",
  "preguntas": [
    {
      "id": 1,
      "texto": "¿Cuál es el planeta rojo?",
      "opciones": [
        { "id": 1, "texto": "Marte", "esCorrecta": true },
        { "id": 2, "texto": "Venus", "esCorrecta": false }
      ]
    }
  ]
}
```

Se requiere al menos una pregunta y dos opciones de texto por pregunta. `descripcion` y `esCorrecta` son opcionales.

## Preguntas

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/preguntas` | Crear pregunta con opciones para un examen |
| `GET` | `/preguntas` | Listar preguntas con opciones |
| `GET` | `/preguntas/:id` | Obtener pregunta con opciones |
| `PUT` | `/preguntas/:id` | Actualizar texto o cambiar de examen |
| `DELETE` | `/preguntas/:id` | Eliminar pregunta y sus opciones |

Crear:

```json
{
  "examenId": 1,
  "texto": "¿Cuál es el planeta rojo?",
  "opciones": [
    { "texto": "Marte", "esCorrecta": true },
    { "texto": "Venus", "esCorrecta": false }
  ]
}
```

La respuesta contiene `id`, `texto`, `examenId` y el arreglo `opciones`. Se requieren al menos dos opciones. Para cambiar opciones ya creadas, usa sus rutas.

## Opciones

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/opciones` | Crear opción para una pregunta |
| `GET` | `/opciones` | Listar opciones |
| `GET` | `/opciones/:id` | Obtener opción |
| `PUT` | `/opciones/:id` | Actualizar opción |
| `DELETE` | `/opciones/:id` | Eliminar opción |

Crear:

```json
{
  "preguntaId": 1,
  "texto": "Marte",
  "esCorrecta": true
}
```

La respuesta contiene `id`, `texto`, `esCorrecta` y `preguntaId`. `esCorrecta` es opcional y por defecto es `false`. En `PUT`, envía uno o más de `texto`, `esCorrecta` y `preguntaId`.

## Documentos PDF

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/documentos` | Subir PDF |
| `GET` | `/documentos` | Listar metadatos |
| `GET` | `/documentos/:id` | Descargar PDF |
| `DELETE` | `/documentos/:id` | Eliminar metadatos y archivo |

La carga es `multipart/form-data`, no JSON. El nombre del campo de archivo es `archivo`; el límite es 10 MB y solo se aceptan PDF.

Ejemplo con `fetch`:

```js
const formulario = new FormData();
formulario.append("archivo", archivoPdf);

const respuesta = await fetch("http://localhost:3002/documentos", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
  },
  body: formulario,
});
```

No establezcas manualmente `Content-Type` al enviar `FormData`; el navegador debe agregar el `boundary`.

`GET /documentos/:id` devuelve el archivo como descarga. `GET /documentos` devuelve metadatos como `id`, `nombreOriginal`, `nombreArchivo`, `tipoMime`, `tamanio` y `creadoEn`.

## Códigos de respuesta

| Código | Significado |
|---|---|
| `200` | Consulta, login o actualización correcta |
| `201` | Recurso creado |
| `204` | Eliminado correctamente; respuesta sin cuerpo |
| `400` | Datos inválidos o archivo no permitido |
| `401` | Credenciales incorrectas o token ausente/inválido/expirado |
| `404` | No existe el recurso o la relación indicada |
| `409` | Conflicto con una relación existente (por ejemplo, año con cursos) |
| `413` | PDF supera 10 MB |
| `500` | Error interno del servidor |

Las respuestas de error suelen tener este formato:

```json
{
  "mensaje": "Descripción del error"
}
```
