# Expense Tracker API Reference

Short developer reference for the current Worker behavior.

## Authentication

- `POST /api/auth/register`
  - validates email + password
  - returns `201` with JWT and user
- `POST /api/auth/login`
  - returns `200` with JWT and user
- all `/api/*` routes except `/api/auth/*` require `Authorization: Bearer <token>`
- auth runs before endpoint-specific validation

## Sync

- `GET /api/sync?last_pulled_at=<timestamp>`
  - returns `changes` + `timestamp`
  - if authenticated and query is invalid, returns `400`
- `POST /api/sync`
  - strict payload per collection
  - blocks record takeover by `id`
  - uses `updatedAt` as last-write-wins
  - ignores stale deletes when server already has newer data
  - rejects negative `expenses.amount`

## Collections

- `categories`
- `expenses`
- `budgets`
- `recurring_expense_rules`

Common sync fields:

- `id`
- `createdAt`
- `updatedAt`
- `deletedAt`

## Cron

- recurring rules run hourly through Worker `scheduled()`
- supports `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`
- also accepts legacy aliases `DAY`, `WEEK`, `MONTH`, `YEAR`
- invalid recurring units disable the rule
- duplicate recurring occurrences are prevented

## Read Endpoints

- `GET /api/profile`
  - authenticated user without password
  - excludes soft-deleted users
- `GET /api/expenses`
  - latest 50 expenses
  - excludes soft-deleted records

## Receipt Scans

- `POST /api/receipt-scans`
  - authenticated multipart upload
  - fields: JPEG `image`, UUID `clientScanId`, `locale`, `currency`, `timezone`, JSON string `categories`
  - returns `201 { "scanId": "..." }` for a new queued job
  - also returns `201 { "scanId": "..." }` for an immediate completed cache hit with a new server scan id
  - returns `200 { "scanId": "..." }` when the same user already has the same image + context in `queued` or `processing`
  - duplicate `clientScanId` for the same user returns `200` with the original `scanId`
  - completed cache hits are global by exact normalized processing context, including normalized category ids/names
  - failed scans are never reused as cache hits
  - limits new scans to 15 per UTC day and 5 per minute per user
- `GET /api/receipt-scans/:scanId`
  - returns `queued`, `processing`, `completed` with parsed data, or `failed`
  - completed responses use `categoryId` and `categoryName`
  - missing or cross-user scans return `404`

## Runtime Config

- `JWT_SECRET`: required
- `CORS_ORIGIN`: optional comma-separated allowlist
- `GOOGLE_VISION_API_KEY`: Google Vision API key
- `GEMINI_API_KEY`: Gemini API key
- `GEMINI_MODEL`: optional, defaults to `gemini-2.5-flash-lite`
- `GOOGLE_VISION_LOCATION`: optional, defaults to `global`

## Testing

- `bun test` runs mocks + real local D1 integration
- `bun run typecheck` validates TypeScript
