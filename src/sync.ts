import { Hono } from 'hono';
import { getDb } from './db';
import { expenses, categories, budgets, recurringExpenseRules } from './db/schema';
import { eq, gt, and } from 'drizzle-orm';
import type { CloudflareBindings, JWTPayload } from './types';

const sync = new Hono<{ Bindings: CloudflareBindings; Variables: { jwtPayload: JWTPayload } }>();

sync.get('/', async (c) => {
  const lastPulledAt = parseInt(c.req.query('last_pulled_at') || '0', 10);
  const userId = c.get('jwtPayload').id;
  const db = getDb(c.env);
  const serverTimestamp = Date.now();

  const fetchChanges = async (table: any) => {
    const records = await db
      .select()
      .from(table)
      .where(and(eq(table.userId, userId), gt(table.updatedAt, lastPulledAt)));

    const created: any[] = [];
    const updated: any[] = [];
    const deleted: string[] = [];

    for (const record of records) {
      if (record.deletedAt !== null) {
        deleted.push(record.id);
      } else if (record.createdAt > lastPulledAt) {
        created.push(record);
      } else {
        updated.push(record);
      }
    }

    return { created, updated, deleted };
  };

  const responseChanges = {
    expenses: await fetchChanges(expenses),
    categories: await fetchChanges(categories),
    budgets: await fetchChanges(budgets),
    recurring_expense_rules: await fetchChanges(recurringExpenseRules),
  };

  return c.json({
    changes: responseChanges,
    timestamp: serverTimestamp,
  });
});

sync.post('/', async (c) => {
  let body;
  try {
    body = (await c.req.json()) as { changes: any; last_pulled_at: number };
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const { changes } = body;
  if (!changes || typeof changes !== 'object') {
    return c.json({ error: "Invalid payload" }, 400);
  }

  const userId = c.get('jwtPayload').id;
  const db = getDb(c.env);
  const now = Date.now();

  const processChanges = async (table: any, tableChanges: { created?: any[]; updated?: any[]; deleted?: string[] }) => {
    const { created = [], updated = [], deleted = [] } = tableChanges;
    
    // UPSERT Created and Updated in a single batch list
    const allUpserts = [...created, ...updated];
    for (const item of allUpserts) {
      if (table === expenses && typeof item.amount === 'number' && item.amount < 0) {
        throw new Error("Invalid expense amount");
      }
      await db
        .insert(table)
        .values({
          ...item,
          userId,
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: table.id,
          set: {
            ...item,
            userId,
            deletedAt: null,
          },
        });
    }

    // Logical Delete
    for (const id of deleted) {
      await db
        .update(table)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(table.id, id), eq(table.userId, userId)));
    }
  };

  try {
    if (changes.categories) await processChanges(categories, changes.categories);
    if (changes.budgets) await processChanges(budgets, changes.budgets);
    if (changes.recurring_expense_rules) await processChanges(recurringExpenseRules, changes.recurring_expense_rules);
    if (changes.expenses) await processChanges(expenses, changes.expenses);
  } catch (e: any) {
    if (e.message === "Invalid expense amount") {
      return c.json({ error: "Invalid expense amount" }, 400);
    }
    return c.json({ error: "Internal server error" }, 500);
  }

  return c.body(null, 200);
});

export default sync;
