# Expense Tracker API

Backend for personal expense tracking, built on **Cloudflare Workers**, **D1** and **Drizzle ORM**. The API is designed around **WatermelonDB-style delta sync**, JWT auth and recurring expense generation via cron.

## Features

- JWT-based authentication with strict Zod validation for register/login.
- Delta sync endpoint with per-collection payload validation.
- Conflict handling based on `updatedAt` last-write-wins semantics.
- Soft deletes propagated through `pull`.
- Hourly cron job for recurring expenses.
- Async receipt scan jobs with R2, Queues, Google Vision OCR and Gemini parsing.
- Configurable CORS through `CORS_ORIGIN`.
- Test suite with both fast mocked tests and real local D1 integration tests.

## Stack

- Framework: [Hono](https://hono.dev)
- Runtime: [Cloudflare Workers](https://developers.cloudflare.com/workers/) and [Bun](https://bun.sh/)
- Database: [Cloudflare D1](https://developers.cloudflare.com/d1/)
- ORM: [Drizzle ORM](https://orm.drizzle.team)
- Validation: [Zod](https://zod.dev)
- Auth: `hono/jwt` + `bcryptjs`

## Local Setup

### Prerequisites

- [Bun](https://bun.sh/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/get-started/)

### Install

```bash
bun install
cp .dev.vars.example .dev.vars
```

`.dev.vars` must contain at least:

```bash
JWT_SECRET=change-me-in-local-dev
GOOGLE_VISION_API_KEY=your-google-vision-api-key
GEMINI_API_KEY=your-gemini-api-key
```

Optional:

- `CORS_ORIGIN`: comma-separated allowlist such as `http://localhost:3000,http://localhost:5173`
- `GEMINI_MODEL`: defaults to `gemini-2.5-flash-lite`
- `RECEIPT_FUZZY_CACHE`: optional Cloudflare KV binding for OCR-aware fuzzy cache between Vision OCR and Gemini. If omitted, receipt parsing still works and simply skips the fuzzy cache layer.

### Run the Worker

```bash
bun run dev
```

### Apply Migrations

Local D1:

```bash
bun run db:migrate:local
```

Remote D1:

```bash
bun run db:migrate:prod
```

## Production Configuration

Before deploying or testing protected routes in production, configure at least:

```bash
wrangler secret put JWT_SECRET
wrangler secret put GOOGLE_VISION_API_KEY
wrangler secret put GEMINI_API_KEY
```

Optional runtime variable:

- `CORS_ORIGIN`: comma-separated allowlist for browser clients. If omitted, the Worker falls back to `*`.
- `GEMINI_MODEL`: configured in `wrangler.jsonc`, defaults to `gemini-2.5-flash-lite`.

Provision these Cloudflare resources before production deploy:

- R2 bucket: `expense-tracker-receipt-images`
- Queue: `receipt-scan-jobs`
- KV namespace for `RECEIPT_FUZZY_CACHE` if you want OCR-aware fuzzy cache reuse across scans

## Testing

The project currently has two test layers:

- Fast tests using lightweight D1 mocks for route and business-rule coverage.
- Integration tests using a real migrated local D1 database and a locally started Worker.

Run everything:

```bash
bun test
```

Run static type checks:

```bash
bun run typecheck
```

## Current API Surface

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/profile`
- `GET /api/expenses`
- `GET /api/sync`
- `POST /api/sync`
- `POST /api/receipt-scans`
- `GET /api/receipt-scans/:scanId`
- scheduled cron via Worker `scheduled()`
- queue consumer via Worker `queue()`

## Notes

- Protected routes authenticate before request-specific validation, so unauthenticated requests to `/api/sync` return `401` before query validation runs.
- `GET /api/expenses` excludes soft-deleted expenses.
- `GET /api/profile` excludes soft-deleted users.
- Recurring rules accept both documented interval values (`DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`) and legacy aliases (`DAY`, `WEEK`, `MONTH`, `YEAR`).
- `POST /api/receipt-scans` deduplicates exact JPEG uploads by exact normalized parse context, including normalized category ids/names. A completed cache hit returns `201` with a new `scanId`, while an in-flight match for the same user returns `200` with the existing `scanId`.
- Receipt processing can optionally use a second cache layer between Google Vision OCR and Gemini. It builds an OCR-aware fingerprint from normalized item text, exact amounts, and total, then reuses prior parsed payloads only when numeric signatures match exactly and fuzzy text similarity clears the threshold.

## Documentation

- Detailed API behavior: `API_DOCUMENTATION.md`
- Short developer reference: `src/api-reference.md`
