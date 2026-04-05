import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  password: text('password').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
});

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(), // UUID string from WatermelonDB
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  icon: text('icon').notNull(),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'number' }),
}, (table) => [
  index('categories_user_updated_idx').on(table.userId, table.updatedAt),
]);

export const expenses = sqliteTable('expenses', {
  id: text('id').primaryKey(), // UUID string
  userId: text('user_id').notNull().references(() => users.id),
  amount: real('amount').notNull(),
  categoryId: text('category_id').notNull().references(() => categories.id),
  date: integer('date', { mode: 'number' }).notNull(),
  note: text('note'),
  paymentMethod: text('payment_method').notNull(),
  status: text('status').notNull(),
  origin: text('origin').notNull(),
  recurringRuleId: text('recurring_rule_id'),
  resolvedAt: integer('resolved_at', { mode: 'number' }),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'number' }),
}, (table) => [
  index('expenses_user_updated_idx').on(table.userId, table.updatedAt),
  index('expenses_user_date_idx').on(table.userId, table.date),
  index('expenses_recurring_lookup_idx').on(table.userId, table.recurringRuleId, table.date),
  uniqueIndex('expenses_recurring_occurrence_unique').on(table.userId, table.recurringRuleId, table.date)
    .where(sql`${table.recurringRuleId} is not null`),
]);

export const recurringExpenseRules = sqliteTable('recurring_expense_rules', {
  id: text('id').primaryKey(), // UUID string
  userId: text('user_id').notNull().references(() => users.id),
  amount: real('amount').notNull(),
  categoryId: text('category_id').notNull().references(() => categories.id),
  paymentMethod: text('payment_method').notNull(),
  note: text('note'),
  intervalValue: integer('interval_value').notNull(),
  intervalUnit: text('interval_unit').notNull(),
  startDate: integer('start_date', { mode: 'number' }).notNull(),
  nextDueAt: integer('next_due_at', { mode: 'number' }).notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull(),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'number' }),
}, (table) => [
  index('recurring_rules_user_updated_idx').on(table.userId, table.updatedAt),
  index('recurring_rules_due_active_idx').on(table.isActive, table.nextDueAt),
]);

export const budgets = sqliteTable('budgets', {
  id: text('id').primaryKey(), // UUID string
  userId: text('user_id').notNull().references(() => users.id),
  categoryId: text('category_id').notNull().references(() => categories.id),
  monthKey: text('month_key').notNull(),
  limitAmount: real('limit_amount').notNull(),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'number' }),
}, (table) => [
  index('budgets_user_updated_idx').on(table.userId, table.updatedAt),
  uniqueIndex('budgets_user_category_month_unique').on(table.userId, table.categoryId, table.monthKey),
]);
