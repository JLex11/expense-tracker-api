import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

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
});

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
});

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
});

export const budgets = sqliteTable('budgets', {
  id: text('id').primaryKey(), // UUID string
  userId: text('user_id').notNull().references(() => users.id),
  categoryId: text('category_id').notNull().references(() => categories.id),
  monthKey: text('month_key').notNull(),
  limitAmount: real('limit_amount').notNull(),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'number' }),
});
