# Expense Tracker API Reference

## 1. Authentication
All routes under `/api/*` require a Bearer token in the `Authorization` header.
The API uses **Zod** for validation.

- `POST /api/auth/register`: Create a user account (`201 Created`).
  - **Schema**: Email format, Password min 8 chars.
- `POST /api/auth/login`: Authenticate and receive a JWT.

## 2. Synchronization (WatermelonDB)
- `GET /api/sync?last_pulled_at=<timestamp>`: Pull changes from the server.
- `POST /api/sync`: Push local changes (created, updated, deleted) to the server.
  - **Validation**: Enforces structured payloads and non-negative amounts for expenses.
  - **Conflict policy**: Incoming updates use `updatedAt` for last-write-wins. Deletes are ignored when the server already has newer changes than `last_pulled_at`.

## 3. Automation
- **Scheduled Task**: Processes `recurring_expense_rules` every hour.
- **Rules**: Supports `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY` intervals and legacy `DAY`, `WEEK`, `MONTH`, `YEAR`.

## 4. Resources
- `GET /api/expenses`: List the latest 50 expenses.
- `GET /api/profile`: Get authenticated user profile.

## 5. Data Models
- **Users**: `id`, `email`, `password`, `updatedAt`, `deletedAt`.
- **Categories**: `id`, `userId`, `name`, `icon`, `createdAt`, `updatedAt`, `deletedAt`.
- **Expenses**: `id`, `userId`, `amount`, `categoryId`, `date`, `note`, `paymentMethod`, `status`, `origin`, `recurringRuleId`, `resolvedAt`, `createdAt`, `updatedAt`, `deletedAt`.
- **RecurringExpenseRules**: `id`, `userId`, `amount`, `categoryId`, `paymentMethod`, `note`, `intervalValue`, `intervalUnit`, `startDate`, `nextDueAt`, `isActive`, `createdAt`, `updatedAt`, `deletedAt`.
- **Budgets**: `id`, `userId`, `categoryId`, `monthKey`, `limitAmount`, `createdAt`, `updatedAt`, `deletedAt`.
