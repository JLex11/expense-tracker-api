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

## Runtime Config

- `JWT_SECRET`: required
- `CORS_ORIGIN`: optional comma-separated allowlist

## Testing

- `bun test` runs mocks + real local D1 integration
- `bun run typecheck` validates TypeScript
