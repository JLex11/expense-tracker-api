# Expense Tracker API Reference

## 1. Authentication
All routes under `/api/*` require a Bearer token in the `Authorization` header.

- `POST /api/auth/register`: Create a new user.
- `POST /api/auth/login`: Authenticate and receive a JWT.

## 2. Synchronization (WatermelonDB)
- `GET /api/sync?last_pulled_at=<timestamp>`: Pull changes from the server.
- `POST /api/sync`: Push local changes (created, updated, deleted) to the server.

## 3. Resources
- `GET /api/expenses`: List the latest 50 expenses.
- `GET /api/profile`: Get authenticated user profile.

## 4. Data Models
- **Users**: `id`, `email`, `password`, `updatedAt`, `deletedAt`.
- **Categories**: `id`, `userId`, `name`, `icon`, `createdAt`, `updatedAt`, `deletedAt`.
- **Expenses**: `id`, `userId`, `amount`, `categoryId`, `date`, `note`, `paymentMethod`, `status`, `origin`, `recurringRuleId`, `resolvedAt`, `createdAt`, `updatedAt`, `deletedAt`.
- **RecurringExpenseRules**: `id`, `userId`, `amount`, `categoryId`, `paymentMethod`, `note`, `intervalValue`, `intervalUnit`, `startDate`, `nextDueAt`, `isActive`, `createdAt`, `updatedAt`, `deletedAt`.
- **Budgets**: `id`, `userId`, `categoryId`, `monthKey`, `limitAmount`, `createdAt`, `updatedAt`, `deletedAt`.
