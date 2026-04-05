import { getDb } from './db';
import { expenses, recurringExpenseRules } from './db/schema';
import { eq, lte, and, isNull } from 'drizzle-orm';
import type { CloudflareBindings } from './types';
import { advanceRecurringDate } from './recurring';

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

export const scheduled = async (event: ScheduledEvent, env: CloudflareBindings, ctx: ExecutionContext) => {
  const db = getDb(env);
  const now = Date.now();

  // Find active rules that are due
  const dueRules = await db
    .select()
    .from(recurringExpenseRules)
    .where(
      and(
        eq(recurringExpenseRules.isActive, true),
        isNull(recurringExpenseRules.deletedAt),
        lte(recurringExpenseRules.nextDueAt, now),
      ),
    );

  console.log(`[Scheduled] Found ${dueRules.length} recurring rules due.`);

  for (const rule of dueRules) {
    const nextDueAt = advanceRecurringDate(rule.nextDueAt, rule.intervalUnit, rule.intervalValue);
    if (nextDueAt === null) {
      console.error(`[Scheduled] Unknown interval unit: ${rule.intervalUnit} for rule ${rule.id}`);

      await db
        .update(recurringExpenseRules)
        .set({
          isActive: false,
          updatedAt: now,
        })
        .where(and(eq(recurringExpenseRules.id, rule.id), eq(recurringExpenseRules.userId, rule.userId)));

      continue;
    }

    try {
      await db.insert(expenses).values({
        id: crypto.randomUUID(),
        userId: rule.userId,
        amount: rule.amount,
        categoryId: rule.categoryId,
        date: rule.nextDueAt,
        note: rule.note,
        paymentMethod: rule.paymentMethod,
        status: 'PENDING',
        origin: 'RECURRING_RULE',
        recurringRuleId: rule.id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      console.log(`[Scheduled] Expense already exists for rule ${rule.id} at ${rule.nextDueAt}. Advancing only.`);
    }

    await db
      .update(recurringExpenseRules)
      .set({
        nextDueAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(recurringExpenseRules.id, rule.id),
          eq(recurringExpenseRules.userId, rule.userId),
          eq(recurringExpenseRules.nextDueAt, rule.nextDueAt),
          eq(recurringExpenseRules.isActive, true),
          isNull(recurringExpenseRules.deletedAt),
        ),
      );

    console.log(`[Scheduled] Processed rule ${rule.id}. Next due: ${new Date(nextDueAt).toISOString()}`);
  }
};
