import { z } from 'zod';
import { recurringIntervalUnits } from './recurring';

const recurringIntervalUnitOptions = [...recurringIntervalUnits] as [
  (typeof recurringIntervalUnits)[number],
  ...(typeof recurringIntervalUnits)[number][],
];

export const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
});

const baseSyncEntitySchema = z.object({
  id: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

const categoriesSyncSchema = baseSyncEntitySchema.extend({
  name: z.string().min(1),
  icon: z.string().min(1),
}).strict();

const expensesSyncSchema = baseSyncEntitySchema.extend({
  amount: z.number().nonnegative(),
  categoryId: z.string().min(1),
  date: z.number().int().nonnegative(),
  note: z.string().nullable().optional(),
  paymentMethod: z.string().min(1),
  status: z.string().min(1),
  origin: z.string().min(1),
  recurringRuleId: z.string().min(1).nullable().optional(),
  resolvedAt: z.number().int().nonnegative().nullable().optional(),
}).strict();

const recurringExpenseRulesSyncSchema = baseSyncEntitySchema.extend({
  amount: z.number().nonnegative(),
  categoryId: z.string().min(1),
  paymentMethod: z.string().min(1),
  note: z.string().nullable().optional(),
  intervalValue: z.number().int().positive(),
  intervalUnit: z.enum(recurringIntervalUnitOptions),
  startDate: z.number().int().nonnegative(),
  nextDueAt: z.number().int().nonnegative(),
  isActive: z.boolean(),
}).strict();

const budgetsSyncSchema = baseSyncEntitySchema.extend({
  categoryId: z.string().min(1),
  monthKey: z.string().min(1),
  limitAmount: z.number().nonnegative(),
}).strict();

function changesetSchema<T extends z.ZodTypeAny>(entitySchema: T) {
  return z.object({
    created: z.array(entitySchema).default([]),
    updated: z.array(entitySchema).default([]),
    deleted: z.array(z.string().min(1)).default([]),
  }).strict();
}

export const syncSchema = z.object({
  changes: z.object({
    categories: changesetSchema(categoriesSyncSchema).optional(),
    budgets: changesetSchema(budgetsSyncSchema).optional(),
    recurring_expense_rules: changesetSchema(recurringExpenseRulesSyncSchema).optional(),
    expenses: changesetSchema(expensesSyncSchema).optional(),
  }).strict(),
  last_pulled_at: z.number().int().nonnegative().default(0),
}).strict();
