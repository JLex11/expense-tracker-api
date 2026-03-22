import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import auth from './auth';
import sync from './sync';
import { getDb } from './db';
import { expenses, users } from './db/schema';
import { eq, desc } from 'drizzle-orm';
import type { CloudflareBindings, JWTPayload } from './types';
const apiDoc = `# Expense Tracker API Reference

## 1. Authentication
All protected routes require a JWT in the \`Authorization: Bearer <token>\` header.

### POST /api/auth/register
- **Description**: Creates a new user account.
- **Request**: \`{ "email": "string", "password": "string" }\`
- **Response**: \`{ "token": "string", "user": { "id": "string", "email": "string" } }\`

### POST /api/auth/login
- **Description**: Authenticates user and returns a token.
- **Request**: \`{ "email": "string", "password": "string" }\`
- **Response**: \`{ "token": "string", "user": { "id": "string", "email": "string" } }\`

## 2. Synchronization (WatermelonDB Protocol)
The system uses Delta Sync to keep local and server databases in sync.

### GET /api/sync
- **Query Params**: \`last_pulled_at\` (timestamp, milliseconds).
- **Description**: Downloads changes since the last pull.
- **Response**: \`{ changes: { <table_name>: { created: [], updated: [], deleted: [] } }, timestamp: number }\`

### POST /api/sync
- **Description**: Uploads local changes to the server.
- **Request**: \`{ changes: { <table_name>: { created: [], updated: [], deleted: [] } }, last_pulled_at: number }\`

## 3. Resources
### GET /api/expenses
- **Auth**: Protected.
- **Description**: Returns the last 50 expenses for the authenticated user, sorted by date.

### GET /api/profile
- **Auth**: Protected.
- **Description**: Returns the authenticated user's profile information.

## 4. Data Models (Contracts)
- **Common Fields**: All models use \`id\` (UUID), \`userId\` (FK), \`createdAt\` (number), \`updatedAt\` (number), and \`deletedAt\` (number | null).
- **Users**: \`id\`, \`email\`, \`password\` (hashed).
- **Categories**: \`name\`, \`icon\`.
- **Expenses**: \`amount\` (real), \`categoryId\`, \`date\`, \`note\`, \`paymentMethod\`, \`status\`, \`origin\`, \`recurringRuleId\`, \`resolvedAt\`.
- **RecurringExpenseRules**: \`amount\`, \`categoryId\`, \`intervalValue\`, \`intervalUnit\`, \`startDate\`, \`nextDueAt\`, \`isActive\`.
- **Budgets**: \`categoryId\`, \`monthKey\`, \`limitAmount\`.
`;

const app = new Hono<{ Bindings: CloudflareBindings; Variables: { jwtPayload: JWTPayload } }>();

app.get('/', (c) => c.text(apiDoc));

// Authentication routes (Public)
app.route('/api/auth', auth);

// JWT Middleware for protected routes
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth')) {
    return next();
  }
  const handler = jwt({
    secret: c.env.JWT_SECRET,
    alg: 'HS256',
  });
  return handler(c, next);
});

// Sync endpoint
app.route('/api/sync', sync);

// Maintenance / Optional endpoints
app.get('/api/expenses', async (c) => {
  const userId = c.get('jwtPayload').id; // Hono JWT middleware puts payload in jwtPayload
  const db = getDb(c.env);
  
  const result = await db
    .select()
    .from(expenses)
    .where(eq(expenses.userId, userId))
    .orderBy(desc(expenses.date))
    .limit(50);

  return c.json(result);
});

app.get('/api/profile', async (c) => {
  const userId = c.get('jwtPayload').id;
  const db = getDb(c.env);
  
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      password: false,
    },
  });

  if (!user) return c.json({ error: 'User not found' }, 404);
  return c.json(user);
});

export default app;
