# Expense Tracker API

A robust backend service for personal expense management, built on **Cloudflare Workers** and **Drizzle ORM**. This API is designed to support efficient data synchronization (Delta Sync) for mobile and web clients.

## 🚀 Features

- **Authentication & Validation:** Secure user registration and login with JWT and Zod validation (Strict email and password requirements).
- **Data Synchronization:** Efficient bi-directional sync (delta updates) based on WatermelonDB's protocol.
- **Automated Recurring Expenses:** Hourly Cron Trigger to process and generate expenses from recurring rules.
- **CORS Support:** Integrated middleware to facilitate cross-origin requests from frontend applications.
- **Performance:** Built on Cloudflare Workers and D1 for low latency and high availability.

## 🛠 Tech Stack

- **Framework:** [Hono](https://hono.dev)
- **Database:** [Cloudflare D1](https://developers.cloudflare.com/d1/)
- **ORM:** [Drizzle ORM](https://orm.drizzle.team)
- **Validation:** [Zod](https://zod.dev)
- **Runtime:** [Bun](https://bun.sh) (for development and testing)
- **Auth:** JWT / bcryptjs

## 📦 Getting Started

### Prerequisites

- [Bun](https://bun.sh/) installed
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/get-started/) installed and authenticated

### Installation

1. Clone the repository and install dependencies:
   ```bash
   bun install
   ```

2. Create local worker vars:
   ```bash
   cp .dev.vars.example .dev.vars
   ```

3. Run the development server:
   ```bash
   bun run dev
   ```

### Database Management

Apply migrations to your local D1 instance:
```bash
bunx wrangler d1 migrations apply DB --local
```

Deploying migrations to production:
```bash
bunx wrangler d1 migrations apply DB --remote
```

Set production secrets before deploying:
```bash
wrangler secret put JWT_SECRET
```

Optional runtime variable:
- `CORS_ORIGIN`: lista separada por comas con orígenes permitidos.

## 🧪 Testing

The project includes a fast test suite using `bun test`, plus `bun run typecheck` for static validation.

Run all tests:
```bash
bun test
```

Run typecheck:
```bash
bun run typecheck
```

## 🔑 API Documentation

See `API_DOCUMENTATION.md` for a detailed breakdown of endpoints, request schemas, and business rules.
