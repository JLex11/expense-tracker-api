# Expense Tracker API

A robust backend service for personal expense management, built on **Cloudflare Workers** and **Drizzle ORM**. This API is designed to support efficient data synchronization (Delta Sync) for mobile and web clients.

## 🚀 Features

- **Authentication:** Secure user registration and login using JWT.
- **Data Synchronization:** Efficient bi-directional sync (delta updates) allowing clients to push changes and pull updates since the last sync.
- **Data Integrity:** Strict server-side validation, including support for non-negative expense constraints.
- **Performance:** Built on Cloudflare Workers and D1, ensuring low latency and high availability.

## 🛠 Tech Stack

- **Framework:** Hono
- **Database:** Cloudflare D1 (SQL)
- **ORM:** Drizzle ORM
- **Runtime:** Bun (for development and testing)
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

2. Run the development server:
   ```bash
   bun run dev
   ```

### Database Management

Apply migrations to your local D1 instance:
```bash
bunx wrangler d1 migrations apply DB --local
```

## 🧪 Testing

The project includes a comprehensive test suite using `bun test` with an in-memory database mock for rapid validation.

Run all tests:
```bash
bun test
```

Tests cover:
- Authentication flows (register/login/duplicate users/bad credentials)
- Protected endpoints (profile/expenses access)
- Synchronization logic (delta push/pull, invalid payload handling, business rule enforcement)

## 🔑 API Documentation

See `API_DOCUMENTATION.md` for a detailed breakdown of endpoints, request schemas, and response formats.
