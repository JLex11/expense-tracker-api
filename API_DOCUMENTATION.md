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

## Escaneo de Facturas

Los escaneos usan OCR asíncrono. El `POST` sigue aceptando el mismo multipart, pero ahora evita reprocesar JPEGs idénticos cuando el contexto de parseo también es idéntico. La deduplicación se calcula con:

- `image_hash`: `SHA-256` del JPEG exacto
- `processing_key`: `SHA-256` del contexto normalizado exacto (`image_hash`, `locale`, `currency`, `timezone`, categorías normalizadas con sus `id` y `name`, `GEMINI_MODEL` y versión interna de cache)

Si no hay hit, el flujo normal guarda el JPEG en R2, crea un job en D1, envía un mensaje a Cloudflare Queues y responde rápido. El consumer de Queue llama Google Vision con `DOCUMENT_TEXT_DETECTION` usando `API key` y luego Gemini con salida JSON estructurada. No se guarda el texto OCR raw.

### POST /api/receipt-scans

Headers:

```http
Authorization: Bearer <jwt>
Accept: application/json
Content-Type: multipart/form-data
```

Campos `form-data`:

- `image`: archivo JPEG, máximo `4 MiB`
- `clientScanId`: UUID generado por la app
- `locale`: por ejemplo `es` o `en`
- `currency`: por ejemplo `USD`, `DOP`, `COP`
- `timezone`: por ejemplo `America/Bogota`
- `categories`: JSON serializado con opciones permitidas, por ejemplo:

```json
[
  { "id": "cat-1", "name": "Comida" },
  { "id": "cat-2", "name": "Transporte" }
]
```

Respuesta `201` cuando crea trabajo nuevo:

```json
{
  "scanId": "server-job-id"
}
```

Respuesta `201` cuando encuentra un resultado `completed` ya cacheado para la misma imagen y el mismo contexto:

```json
{
  "scanId": "new-server-scan-id"
}
```

Respuesta `200` cuando el mismo usuario ya tiene un scan `queued` o `processing` para la misma imagen y el mismo contexto:

```json
{
  "scanId": "existing-in-flight-scan-id"
}
```

Idempotencia:

- El backend guarda `(userId, clientScanId)` como clave única.
- Si el mismo usuario reenvía el mismo `clientScanId`, responde `200` con el mismo `scanId`.
- Los reintentos idempotentes no consumen cuota diaria ni límite por minuto.
- Un hit de cache `completed` tampoco consume cuota adicional.
- Un reuso de scan en curso (`queued` o `processing`) tampoco consume cuota adicional.

Límites:

- `15` escaneos nuevos por usuario por día UTC.
- `5` escaneos nuevos por usuario por minuto.
- Si se excede un límite, responde `429`:

```json
{
  "message": "Límite de escaneos alcanzado"
}
```

### GET /api/receipt-scans/:scanId

Devuelve solo escaneos del usuario autenticado.

Pendiente:

```json
{
  "status": "queued"
}
```

Procesando:

```json
{
  "status": "processing"
}
```

Completado:

```json
{
  "status": "completed",
  "data": {
    "amount": 123.45,
    "date": "2026-04-23",
    "merchant": "Supermercado X",
    "currency": "USD",
    "paymentMethod": "card",
    "categoryId": "cat-1",
    "categoryName": "Groceries",
    "note": "Supermercado X",
    "confidence": 0.86,
    "warnings": []
  }
}
```

Reglas de categoria:

- El backend solo puede elegir entre las categorías enviadas por la app.
- El backend intenta elegir la categoría más probable según comercio, items y contexto de la compra.
- `categoryId` y `categoryName` se comportan como sugerencia inicial para el borrador de la app.
- Solo responde `categoryId: null` y `categoryName: null` cuando ninguna categoría enviada parece una candidata razonable.
- Para efectos de cache, las categorías se normalizan con `trim`, se descartan inválidas y se ordenan por `id` y luego `name`, así que el mismo set en distinto orden produce el mismo `processing_key`.

Fallido:

```json
{
  "status": "failed",
  "message": "No se pudo leer la factura"
}
```

Si el `scanId` no existe o pertenece a otro usuario, responde `404`:

```json
{
  "message": "Escaneo no encontrado"
}
```

Notas de cache:

- La cache de resultados `completed` es global por contexto exacto, no solo por usuario.
- La reutilización de scans en curso solo ocurre dentro del mismo usuario; nunca devuelve un `scanId` ajeno.
- Los scans `failed` no se reutilizan como cache.

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
- `GOOGLE_VISION_API_KEY`: requerido para Google Vision OCR
- `GEMINI_API_KEY`: API key de Gemini
- `GEMINI_MODEL`: opcional, default `gemini-2.5-flash-lite`
- `GOOGLE_VISION_LOCATION`: opcional, default `global`

Bindings de Cloudflare:

- `DB`: D1
- `RECEIPT_IMAGES`: R2 privado para JPEGs temporales
- `RECEIPT_SCAN_QUEUE`: Queue para procesar OCR fuera del request

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
