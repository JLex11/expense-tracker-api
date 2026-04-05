import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getDb } from './db';
import { expenses, categories, budgets, recurringExpenseRules } from './db/schema';
import { eq, gt, and } from 'drizzle-orm';
import type { CloudflareBindings, JWTPayload } from './types';
import { normalizeRecurringIntervalUnit } from './recurring';
import { isIncomingChangeNewer, shouldApplyDelete } from './sync-logic';
import { syncSchema } from './validators';

const sync = new Hono<{ Bindings: CloudflareBindings; Variables: { jwtPayload: JWTPayload } }>();

sync.get('/', async (c) => {
  const lastPulledAtParam = c.req.query('last_pulled_at');
  if (lastPulledAtParam !== undefined && !/^\d+$/.test(lastPulledAtParam)) {
    return c.json({ error: 'Invalid last_pulled_at value' }, 400);
  }

  const lastPulledAt = parseInt(lastPulledAtParam || '0', 10);
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

class SyncRequestError extends Error {
  status: 400 | 403;

  constructor(message: string, status: 400 | 403) {
    super(message);
    this.name = 'SyncRequestError';
    this.status = status;
  }
}

sync.post('/', zValidator('json', syncSchema), async (c) => {
  const { changes, last_pulled_at: lastPulledAt } = c.req.valid('json');

  if (!changes) {
    return c.json({ error: 'Invalid payload' }, 400);
  }

  const userId = c.get('jwtPayload').id;
  const db = getDb(c.env);
  const now = Date.now();

  const getExistingRecord = async (table: any, id: string) => {
    const records = await db.select().from(table).where(eq(table.id, id)).limit(1);
    return records[0] ?? null;
  };

  const normalizeItem = (table: any, item: Record<string, unknown>) => {
    if (table === recurringExpenseRules && typeof item.intervalUnit === 'string') {
      const normalizedIntervalUnit = normalizeRecurringIntervalUnit(item.intervalUnit);
      if (!normalizedIntervalUnit) {
        throw new SyncRequestError('Invalid recurring interval unit', 400);
      }

      return {
        ...item,
        intervalUnit: normalizedIntervalUnit,
      };
    }

    return item;
  };

  const processChanges = async (table: any, tableChanges: { created?: any[]; updated?: any[]; deleted?: string[] }) => {
    const { created = [], updated = [], deleted = [] } = tableChanges;

    const allUpserts = [...created, ...updated];
    for (const item of allUpserts) {
      if (table === expenses && typeof item.amount === 'number' && item.amount < 0) {
        throw new SyncRequestError('Invalid expense amount', 400);
      }

      const normalizedItem = normalizeItem(table, item);
      const existingRecord = await getExistingRecord(table, String(normalizedItem.id));

      if (existingRecord && existingRecord.userId !== userId) {
        throw new SyncRequestError('Cannot modify another user record', 403);
      }

      if (existingRecord) {
        if (!isIncomingChangeNewer(existingRecord.updatedAt, Number(normalizedItem.updatedAt))) {
          continue;
        }

        await db
          .update(table)
          .set({
            ...normalizedItem,
            userId,
            deletedAt: null,
          })
          .where(and(eq(table.id, normalizedItem.id), eq(table.userId, userId)));

        continue;
      }

      await db.insert(table).values({
        ...normalizedItem,
        userId,
        deletedAt: null,
      });
    }

    for (const id of deleted) {
      const existingRecord = await getExistingRecord(table, id);
      if (!existingRecord) {
        continue;
      }

      if (existingRecord.userId !== userId) {
        throw new SyncRequestError('Cannot delete another user record', 403);
      }

      if (!shouldApplyDelete(existingRecord.updatedAt, lastPulledAt)) {
        continue;
      }

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
  } catch (e: unknown) {
    if (e instanceof SyncRequestError) {
      return c.json({ error: e.message }, e.status as 400 | 403);
    }

    console.error(e); // Log unexpected errors
    return c.json({ error: 'Internal server error' }, 500);
  }

  return c.body(null, 200);
});

export default sync;
