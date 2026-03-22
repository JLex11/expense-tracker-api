import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { getDb } from './db';
import { users } from './db/schema';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import type { CloudflareBindings } from './types';

const auth = new Hono<{ Bindings: CloudflareBindings }>();

auth.post('/register', async (c) => {
  const { email, password } = await c.req.json();
  const db = getDb(c.env);

  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existingUser) {
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

  return c.json({ token, user: { id, email } });
});

auth.post('/login', async (c) => {
  const { email, password } = await c.req.json();
  const db = getDb(c.env);

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const payload = {
    id: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 1 week
  };

  const token = await sign(payload, c.env.JWT_SECRET);

  return c.json({ token, user: { id: user.id, email: user.email } });
});

export default auth;
