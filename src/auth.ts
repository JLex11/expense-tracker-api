import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { zValidator } from '@hono/zod-validator';
import { getDb } from './db';
import { users } from './db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import type { CloudflareBindings } from './types';
import { authSchema } from './validators';

const auth = new Hono<{ Bindings: CloudflareBindings }>();

auth.post('/register', zValidator('json', authSchema), async (c) => {
  const { email, password } = c.req.valid('json');
  const db = getDb(c.env);

  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser.length > 0) {
    return c.json({ error: 'User already exists' }, 400);
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const id = crypto.randomUUID();

  await db.insert(users).values({
    id,
    email,
    password: hashedPassword,
    updatedAt: new Date(),
  });

  const payload = {
    id,
    email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 1 week
  };

  const token = await sign(payload, c.env.JWT_SECRET);

  return c.json({ token, user: { id, email } }, 201);
});

auth.post('/login', zValidator('json', authSchema), async (c) => {
  const { email, password } = c.req.valid('json');
  const db = getDb(c.env);

  const user = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);

  if (user.length === 0 || !(await bcrypt.compare(password, user[0].password))) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const payload = {
    id: user[0].id,
    email: user[0].email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 1 week
  };

  const token = await sign(payload, c.env.JWT_SECRET);

  return c.json({ token, user: { id: user[0].id, email: user[0].email } });
});

export default auth;
