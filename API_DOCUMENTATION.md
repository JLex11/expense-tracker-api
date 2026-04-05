# Expense Tracker API Documentation

Esta API proporciona una base sólida para el seguimiento de gastos con soporte para sincronización bidireccional "Delta Sync", permitiendo que las aplicaciones móviles funcionen sin conexión y sincronicen cambios de manera eficiente.

## 🚀 Arquitectura: "Delta Sync" con WatermelonDB

El backend está diseñado para conectarse nativamente con **WatermelonDB**. Recibe todas las actualizaciones agrupadas por tablas (`created`, `updated`, `deleted`) y usa un enfoque Last Write Wins basado en marcas de tiempo (`timestamps`).

### Requisitos del Esquema
Todas las tablas (incluidas las nuevas y `recurring_expense_rules`) cumplen con:
- `id`: String UUID generado por WatermelonDB en el frontend.
- `created_at` y `updated_at`: Timestamps en formato numérico milisegundos.
- `deleted_at`: Usado internamente por el servidor para manejar borrados lógicos y notificar a otros dispositivos (Pull) qué registros han sido eliminados de su BD local en un push.

---

## 🔐 Autenticación y Validación

Todas las rutas bajo `/api/*` (excepto `/api/auth/*`) requieren un token Bearer JWT. 
La API utiliza **Zod** para validación estricta de esquemas en todas las entradas.

### Registro
`POST /api/auth/register`
- **Body**: `{"email": "...", "password": "..."}`
  - `email`: Debe ser un formato de correo válido.
  - `password`: Mínimo 8 caracteres.
- **Respuesta (`201 Created`)**: `{"token": "...", "user": {"id": "...", "email": "..."}}`

### Login
`POST /api/auth/login`
- **Body**: `{"email": "...", "password": "..."}`
- **Respuesta (`200 OK`)**: Token JWT y datos del usuario.

---

## 🔄 Sincronización (API de WatermelonDB)

Este es el mecanismo nativo mediante el cual WatermelonDB descarga e inserta registros.
El protocolo se divide en dos métodos en el mismo endpoint `/api/sync`: `GET` para bajar datos (Pull) y `POST` para subir cambios (Push).
Las actualizaciones entrantes usan `updatedAt` para aplicar un criterio Last Write Wins. Los borrados se aplican solo si el servidor no recibió cambios más nuevos desde `last_pulled_at`.

### Pull (GET)
El cliente llama a este endpoint proporcionando la última vez que sincronizó.
`GET /api/sync?last_pulled_at=1710845600000`
- **Param**: `last_pulled_at` en formato timestamp.
- **Respuesta**: Un objeto separando registros creados, modificados o "eliminados lógicamente" (devuelve el string UUID).
```json
{
  "changes": {
    "expenses": { "created": [], "updated": [], "deleted": [] },
    "categories": { "created": [], "updated": [], "deleted": [] },
    "budgets": { "created": [], "updated": [], "deleted": [] },
    "recurring_expense_rules": { "created": [], "updated": [], "deleted": [] }
  },
  "timestamp": 1710850000000 
}
```

### Push (POST)
Watermelon reúne todos sus cambios offline y los agrupa en un super objeto con todas sus colecciones. Validado mediante esquemas de Zod para asegurar la integridad de la sincronización.
`POST /api/sync`
- **Body**:
```json
{
  "last_pulled_at": 1710845600000,
  "changes": {
    "expenses": { "created": [], "updated": [], "deleted": [] },
    "categories": { "created": [], "updated": [], "deleted": [] },
    "budgets": { "created": [], "updated": [], "deleted": [] },
    "recurring_expense_rules": { "created": [], "updated": [], "deleted": [] }
  }
}
```
- **Respuesta (`200 OK`)**: Todo ha ido bien, aplicar cambios localmente. 
- **Validaciones de Negocio**: 
  - No se permiten importes de gastos (`expenses.amount`) negativos.

---

## ⏰ Automatización: Gastos Recurrentes

La API incluye un procesador de tareas programadas (**Cloudflare Cron Trigger**) que se ejecuta cada hora.
- **Funcionamiento**: Escanea la tabla `recurring_expense_rules` en busca de reglas activas donde `nextDueAt` haya pasado.
- **Acción**: Crea automáticamente un nuevo registro en `expenses` y actualiza `nextDueAt` según el intervalo definido (`DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`). También acepta los valores legacy `DAY`, `WEEK`, `MONTH`, `YEAR`.

---

## 📁 Endpoints de Mantenimiento

### Listar Gastos
`GET /api/expenses`
- Devuelve los últimos 50 gastos del usuario.

### Perfil de Usuario
`GET /api/profile`
- Devuelve los datos del usuario autenticado (sin contraseñas).

---

## 🛠️ Tecnologías Utilizadas

- **Runtime**: [Bun](https://bun.sh)
- **Framework**: [Hono](https://hono.dev)
- **Base de Datos**: [Cloudflare D1](https://developers.cloudflare.com/d1/)
- **ORM**: [Drizzle ORM](https://orm.drizzle.team)
- **Validación**: [Zod](https://zod.dev)
- **Seguridad**: JWT con `hono/jwt`, `bcryptjs` y CORS configurable mediante `CORS_ORIGIN`.
