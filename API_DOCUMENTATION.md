# Expense Tracker API Documentation

Esta API está orientada a sincronización incremental para clientes móviles/web y corre sobre Cloudflare Workers + D1. El backend implementa autenticación JWT, validación estricta con Zod, borrado lógico y generación automática de gastos recurrentes.

## Arquitectura de Sync

La API usa un modelo estilo WatermelonDB:

- `GET /api/sync`: pull de cambios desde el servidor.
- `POST /api/sync`: push de cambios desde el cliente.
- Todas las colecciones se transmiten por tabla con los grupos `created`, `updated` y `deleted`.

Colecciones soportadas:

- `categories`
- `expenses`
- `budgets`
- `recurring_expense_rules`

### Reglas de Datos

Todas las tablas sincronizables usan:

- `id`: string UUID generado en cliente
- `createdAt`: timestamp numérico en milisegundos
- `updatedAt`: timestamp numérico en milisegundos
- `deletedAt`: timestamp numérico o `null` para borrado lógico

## Autenticación

Todas las rutas bajo `/api/*`, excepto `/api/auth/*`, requieren:

```http
Authorization: Bearer <jwt>
```

La autenticación se ejecuta antes de la validación específica del endpoint. Por eso, una request sin token a `/api/sync` responde `401` antes de validar `last_pulled_at`.

### POST /api/auth/register

Body:

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

Validación:

- `email` debe ser válido
- `password` debe tener mínimo 8 caracteres

Respuesta `201`:

```json
{
  "token": "jwt",
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  }
}
```

### POST /api/auth/login

Body:

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

Respuesta `200`:

```json
{
  "token": "jwt",
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  }
}
```

Notas:

- Usuarios con `deletedAt != null` no pueden autenticarse.

## Sync

## GET /api/sync

Ejemplo:

```http
GET /api/sync?last_pulled_at=1710845600000
```

Parámetros:

- `last_pulled_at`: timestamp en milisegundos

Validación:

- Si el request está autenticado pero `last_pulled_at` no es numérico, responde `400`

Respuesta `200`:

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

Semántica:

- registros con `createdAt > last_pulled_at` salen en `created`
- registros con `updatedAt > last_pulled_at` y no creados recientemente salen en `updated`
- registros con `deletedAt != null` salen en `deleted` como lista de ids

## POST /api/sync

Body base:

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

Respuesta `200`:

- body vacío

Validación:

- el payload es estricto por colección
- no se aceptan campos extra
- `expenses.amount` no puede ser negativo
- `recurring_expense_rules.intervalUnit` acepta:
  - documentados: `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`
  - legacy: `DAY`, `WEEK`, `MONTH`, `YEAR`

Reglas de conflicto:

- updates solo se aplican si el `updatedAt` entrante es más nuevo que el almacenado
- deletes solo se aplican si el servidor no tiene un cambio más reciente que `last_pulled_at`
- un usuario no puede modificar ni borrar registros de otro usuario aunque conozca el `id`

## Endpoints de Lectura

### GET /api/profile

Devuelve el usuario autenticado sin password.

Respuesta `200`:

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "updatedAt": "2026-04-05T02:11:54.000Z"
}
```

Notas:

- usuarios soft-deleted no aparecen

### GET /api/expenses

Devuelve hasta 50 gastos del usuario autenticado, ordenados por fecha descendente.

Notas:

- excluye gastos con `deletedAt != null`

## Automatización de Gastos Recurrentes

El Worker ejecuta `scheduled()` cada hora.

Comportamiento:

- busca reglas activas cuyo `nextDueAt <= now`
- crea un gasto con `origin = "RECURRING_RULE"` y `status = "PENDING"`
- avanza `nextDueAt` según el intervalo
- si la regla trae una unidad inválida, la desactiva
- evita duplicar la misma ocurrencia mediante lookup e índice único

## Configuración Operativa

Secretos/variables relevantes:

- `JWT_SECRET`: requerido
- `CORS_ORIGIN`: opcional, lista separada por comas

Si `CORS_ORIGIN` no está configurado, el Worker responde con `Access-Control-Allow-Origin: *`.

## Testing

La base actual de testing tiene:

- smoke tests con mocks de D1
- tests de reglas puras
- integración real con Worker local + D1 migrada

Comandos:

```bash
bun test
bun run typecheck
```
