import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import auth from './auth';
import sync from './sync';
import { getDb } from './db';
import { expenses, users } from './db/schema';
import { eq, desc } from 'drizzle-orm';
import type { CloudflareBindings, JWTPayload } from './types';

const app = new Hono<{ Bindings: CloudflareBindings; Variables: { jwtPayload: JWTPayload } }>();

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
