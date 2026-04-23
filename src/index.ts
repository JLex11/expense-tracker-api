import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';
import auth from './auth';
import sync from './sync';
import receiptScans from './receipt-scans';
import { getDb } from './db';
import { expenses, users } from './db/schema';
import { and, eq, desc, isNull } from 'drizzle-orm';
import type { CloudflareBindings, JWTPayload } from './types';
import { scheduled } from './scheduled';
import { processReceiptScanQueue } from './receipt-processing';

const apiDoc = `Expense Tracker API

Routes:
- POST /api/auth/register
- POST /api/auth/login
- GET /api/sync
- POST /api/sync
- GET /api/expenses
- GET /api/profile
- POST /api/receipt-scans
- GET /api/receipt-scans/:scanId

See the repository documentation for the full API contract and sync rules.
`;

export const app = new Hono<{ Bindings: CloudflareBindings; Variables: { jwtPayload: JWTPayload } }>();

app.use(
  '/*',
  cors({
    origin: (origin, c) => {
      const configuredOrigins = (c.env.CORS_ORIGIN ?? '')
        .split(',')
        .map((value: string) => value.trim())
        .filter(Boolean);
      if (!configuredOrigins || configuredOrigins.length === 0) {
        return '*';
      }

      if (!origin) {
        return configuredOrigins[0];
      }

      return configuredOrigins.includes(origin) ? origin : configuredOrigins[0];
    },
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  }),
);

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
app.route('/api/receipt-scans', receiptScans);

// Maintenance / Optional endpoints
app.get('/api/expenses', async (c) => {
  const userId = c.get('jwtPayload').id; // Hono JWT middleware puts payload in jwtPayload
  const db = getDb(c.env);
  
  const result = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.userId, userId), isNull(expenses.deletedAt)))
    .orderBy(desc(expenses.date))
    .limit(50);

  return c.json(result);
});

app.get('/api/profile', async (c) => {
  const userId = c.get('jwtPayload').id;
  const db = getDb(c.env);
  
  const user = await db
    .select({
      id: users.id,
      email: users.email,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (user.length === 0) return c.json({ error: 'User not found' }, 404);
  return c.json(user[0]);
});

export default {
  fetch: app.fetch,
  queue: processReceiptScanQueue,
  scheduled
};
