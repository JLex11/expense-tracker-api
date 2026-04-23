import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from './index';
import { processReceiptScan } from './receipt-processing';
import { normalizeRecurringIntervalUnit, advanceRecurringDate } from './recurring';
import { isIncomingChangeNewer, shouldApplyDelete } from './sync-logic';

type MockRecord = Record<string, any>;

const dbState = {
  users: [] as MockRecord[],
  expenses: [] as MockRecord[],
  categories: [] as MockRecord[],
  budgets: [] as MockRecord[],
  recurringExpenseRules: [] as MockRecord[],
  receiptScans: [] as MockRecord[],
  receiptScanUsage: [] as MockRecord[],
  receiptScanRateLimits: [] as MockRecord[],
  receiptImages: new Map<string, { body: Blob | ReadableStream; metadata?: Record<string, string> }>(),
  receiptQueueMessages: [] as Array<{ scanId: string }>,
};

const rawColumnOrderByTable: Record<string, Array<[string, string]>> = {
  users: [
    ['id', 'id'],
    ['email', 'email'],
    ['password', 'password'],
    ['updated_at', 'updatedAt'],
    ['deleted_at', 'deletedAt'],
  ],
  expenses: [
    ['id', 'id'],
    ['user_id', 'userId'],
    ['amount', 'amount'],
    ['category_id', 'categoryId'],
    ['date', 'date'],
    ['note', 'note'],
    ['payment_method', 'paymentMethod'],
    ['status', 'status'],
    ['origin', 'origin'],
    ['recurring_rule_id', 'recurringRuleId'],
    ['resolved_at', 'resolvedAt'],
    ['created_at', 'createdAt'],
    ['updated_at', 'updatedAt'],
    ['deleted_at', 'deletedAt'],
  ],
  categories: [
    ['id', 'id'],
    ['user_id', 'userId'],
    ['name', 'name'],
    ['icon', 'icon'],
    ['created_at', 'createdAt'],
    ['updated_at', 'updatedAt'],
    ['deleted_at', 'deletedAt'],
  ],
  budgets: [
    ['id', 'id'],
    ['user_id', 'userId'],
    ['category_id', 'categoryId'],
    ['month_key', 'monthKey'],
    ['limit_amount', 'limitAmount'],
    ['created_at', 'createdAt'],
    ['updated_at', 'updatedAt'],
    ['deleted_at', 'deletedAt'],
  ],
  recurring_expense_rules: [
    ['id', 'id'],
    ['user_id', 'userId'],
    ['amount', 'amount'],
    ['category_id', 'categoryId'],
    ['payment_method', 'paymentMethod'],
    ['note', 'note'],
    ['interval_value', 'intervalValue'],
    ['interval_unit', 'intervalUnit'],
    ['start_date', 'startDate'],
    ['next_due_at', 'nextDueAt'],
    ['is_active', 'isActive'],
    ['created_at', 'createdAt'],
    ['updated_at', 'updatedAt'],
    ['deleted_at', 'deletedAt'],
  ],
  receipt_scans: [
    ['scan_id', 'scanId'],
    ['client_scan_id', 'clientScanId'],
    ['user_id', 'userId'],
    ['status', 'status'],
    ['locale', 'locale'],
    ['currency', 'currency'],
    ['timezone', 'timezone'],
    ['image_object_key', 'imageObjectKey'],
    ['parsed_data_json', 'parsedDataJson'],
    ['failure_message', 'failureMessage'],
    ['created_at', 'createdAt'],
    ['updated_at', 'updatedAt'],
    ['completed_at', 'completedAt'],
  ],
  receipt_scan_usage: [
    ['id', 'id'],
    ['user_id', 'userId'],
    ['bucket_key', 'bucketKey'],
    ['count', 'count'],
    ['updated_at', 'updatedAt'],
  ],
  receipt_scan_rate_limits: [
    ['id', 'id'],
    ['user_id', 'userId'],
    ['bucket_key', 'bucketKey'],
    ['count', 'count'],
    ['updated_at', 'updatedAt'],
  ],
};

function resetDbState() {
  dbState.users = [];
  dbState.expenses = [];
  dbState.categories = [];
  dbState.budgets = [];
  dbState.recurringExpenseRules = [];
  dbState.receiptScans = [];
  dbState.receiptScanUsage = [];
  dbState.receiptScanRateLimits = [];
  dbState.receiptImages = new Map();
  dbState.receiptQueueMessages = [];
}

function getTableRecords(tableName: string) {
  switch (tableName) {
    case 'users':
      return dbState.users;
    case 'expenses':
      return dbState.expenses;
    case 'categories':
      return dbState.categories;
    case 'budgets':
      return dbState.budgets;
    case 'recurring_expense_rules':
      return dbState.recurringExpenseRules;
    case 'receipt_scans':
      return dbState.receiptScans;
    case 'receipt_scan_usage':
      return dbState.receiptScanUsage;
    case 'receipt_scan_rate_limits':
      return dbState.receiptScanRateLimits;
    default:
      return [];
  }
}

function extractTableName(query: string): string | null {
  const normalizedQuery = query.toLowerCase();
  const match = normalizedQuery.match(/(?:from|into|update)\s+(?:"|`)?([a-z_]+)(?:"|`)?/);
  return match?.[1] ?? null;
}

function filterRows(rows: MockRecord[], query: string, params: any[]) {
  let filteredRows = [...rows];
  const normalizedQuery = query.toLowerCase();

  if (normalizedQuery.includes('"email" = ?') || normalizedQuery.includes('`email` = ?')) {
    filteredRows = filteredRows.filter((row) => row.email === params[0]);
  }

  if (normalizedQuery.includes('"id" = ?') || normalizedQuery.includes('`id` = ?')) {
    filteredRows = filteredRows.filter((row) => row.id === params[0]);
  }

  if (normalizedQuery.includes('"scan_id" = ?') || normalizedQuery.includes('`scan_id` = ?')) {
    filteredRows = filteredRows.filter((row) => params.includes(row.scanId));
  }

  if (normalizedQuery.includes('"client_scan_id" = ?') || normalizedQuery.includes('`client_scan_id` = ?')) {
    filteredRows = filteredRows.filter((row) => params.includes(row.clientScanId));
  }

  if (normalizedQuery.includes('"bucket_key" = ?') || normalizedQuery.includes('`bucket_key` = ?')) {
    filteredRows = filteredRows.filter((row) => params.includes(row.bucketKey));
  }

  if (normalizedQuery.includes('"user_id" = ? and "expenses"."updated_at" > ?')) {
    filteredRows = filteredRows.filter((row) => row.userId === params[0] && row.updatedAt > params[1]);
  }

  if (query.includes('"user_id" = ? and "categories"."updated_at" > ?')) {
    filteredRows = filteredRows.filter((row) => row.userId === params[0] && row.updatedAt > params[1]);
  }

  if (query.includes('"user_id" = ? and "budgets"."updated_at" > ?')) {
    filteredRows = filteredRows.filter((row) => row.userId === params[0] && row.updatedAt > params[1]);
  }

  if (query.includes('"user_id" = ? and "recurring_expense_rules"."updated_at" > ?')) {
    filteredRows = filteredRows.filter((row) => row.userId === params[0] && row.updatedAt > params[1]);
  }

  if (normalizedQuery.includes('"user_id" = ?') && !normalizedQuery.includes('updated_at" > ?')) {
    filteredRows = filteredRows.filter((row) => params.includes(row.userId));
  }

  if (normalizedQuery.includes('"deleted_at" is null')) {
    filteredRows = filteredRows.filter((row) => row.deletedAt == null);
  }

  if (normalizedQuery.includes('order by "expenses"."date" desc')) {
    filteredRows.sort((left, right) => right.date - left.date);
  }

  if (normalizedQuery.includes('limit ?')) {
    const limit = params[params.length - 1];
    filteredRows = filteredRows.slice(0, limit);
  }

  return filteredRows;
}

function toDriverRow(tableName: string, row: MockRecord) {
  switch (tableName) {
    case 'users':
      return {
        id: row.id,
        email: row.email,
        password: row.password,
        updated_at: row.updatedAt,
        deleted_at: row.deletedAt,
      };
    case 'expenses':
      return {
        id: row.id,
        user_id: row.userId,
        amount: row.amount,
        category_id: row.categoryId,
        date: row.date,
        note: row.note,
        payment_method: row.paymentMethod,
        status: row.status,
        origin: row.origin,
        recurring_rule_id: row.recurringRuleId,
        resolved_at: row.resolvedAt,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        deleted_at: row.deletedAt,
      };
    case 'categories':
      return {
        id: row.id,
        user_id: row.userId,
        name: row.name,
        icon: row.icon,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        deleted_at: row.deletedAt,
      };
    case 'budgets':
      return {
        id: row.id,
        user_id: row.userId,
        category_id: row.categoryId,
        month_key: row.monthKey,
        limit_amount: row.limitAmount,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        deleted_at: row.deletedAt,
      };
    case 'recurring_expense_rules':
      return {
        id: row.id,
        user_id: row.userId,
        amount: row.amount,
        category_id: row.categoryId,
        payment_method: row.paymentMethod,
        note: row.note,
        interval_value: row.intervalValue,
        interval_unit: row.intervalUnit,
        start_date: row.startDate,
        next_due_at: row.nextDueAt,
        is_active: row.isActive,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        deleted_at: row.deletedAt,
      };
    case 'receipt_scans':
      return {
        scan_id: row.scanId,
        client_scan_id: row.clientScanId,
        user_id: row.userId,
        status: row.status,
        locale: row.locale,
        currency: row.currency,
        timezone: row.timezone,
        image_object_key: row.imageObjectKey,
        parsed_data_json: row.parsedDataJson,
        failure_message: row.failureMessage,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        completed_at: row.completedAt,
      };
    case 'receipt_scan_usage':
    case 'receipt_scan_rate_limits':
      return {
        id: row.id,
        user_id: row.userId,
        bucket_key: row.bucketKey,
        count: row.count,
        updated_at: row.updatedAt,
      };
    default:
      return row;
  }
}

function getSelectedColumns(query: string) {
  const normalizedQuery = query.toLowerCase();
  const selectIndex = normalizedQuery.indexOf('select ');
  const fromIndex = normalizedQuery.indexOf(' from ');

  if (selectIndex === -1 || fromIndex === -1) {
    return [];
  }

  return query
    .slice(selectIndex + 7, fromIndex)
    .split(',')
    .map((token) => {
      const matches = [...token.matchAll(/"([^"]+)"|`([^`]+)`/g)];
      const lastMatch = matches[matches.length - 1];
      return lastMatch?.[1] ?? lastMatch?.[2] ?? null;
    })
    .filter((columnName): columnName is string => columnName !== null);
}

function createMockStmt(query: string, params: any[] = []) {
  return {
    bind: (...newParams: any[]) => createMockStmt(query, newParams),
    first: async () => {
      const tableName = extractTableName(query);
      if (!tableName) {
        return null;
      }

      return filterRows(getTableRecords(tableName), query, params)[0] ?? null;
    },
    all: async () => {
      const tableName = extractTableName(query);
      if (!tableName) {
        return { results: [] };
      }

      return { results: filterRows(getTableRecords(tableName), query, params).map((row) => toDriverRow(tableName, row)) };
    },
    raw: async () => {
      const tableName = extractTableName(query);
      if (!tableName) {
        return [];
      }

      const selectedColumns = getSelectedColumns(query);
      const driverRows = filterRows(getTableRecords(tableName), query, params).map((row) => toDriverRow(tableName, row));

      return driverRows.map((row) => selectedColumns.map((columnName) => row[columnName] ?? null));
    },
    run: async () => {
      const normalizedQuery = query.toLowerCase();
      const tableName = extractTableName(query);

      if (!tableName) {
        return { success: true, meta: { changes: 0 } };
      }

      if (normalizedQuery.startsWith('insert into "users"')) {
        dbState.users.push({
          id: params[0],
          email: params[1],
          password: params[2],
          updatedAt: params[3],
          deletedAt: null,
        });

        return { success: true, meta: { changes: 1 } };
      }

      if (normalizedQuery.startsWith('insert into "expenses"')) {
        dbState.expenses.push({
          id: params[0],
          userId: params[1],
          amount: params[2],
          categoryId: params[3],
          date: params[4],
          note: params[5],
          paymentMethod: params[6],
          status: params[7],
          origin: params[8],
          recurringRuleId: params[9],
          resolvedAt: params[10],
          createdAt: params[11],
          updatedAt: params[12],
          deletedAt: params[13],
        });

        return { success: true, meta: { changes: 1 } };
      }

      if (normalizedQuery.startsWith('insert into "receipt_scans"')) {
        dbState.receiptScans.push({
          scanId: params[0],
          clientScanId: params[1],
          userId: params[2],
          status: params[3],
          locale: params[4],
          currency: params[5],
          timezone: params[6],
          imageObjectKey: params[7],
          parsedDataJson: params[8],
          failureMessage: params[9],
          createdAt: params[10],
          updatedAt: params[11],
          completedAt: params[12],
        });

        return { success: true, meta: { changes: 1 } };
      }

      if (normalizedQuery.startsWith('insert into "receipt_scan_usage"')) {
        dbState.receiptScanUsage.push({
          id: params[0],
          userId: params[1],
          bucketKey: params[2],
          count: params[3],
          updatedAt: params[4],
        });

        return { success: true, meta: { changes: 1 } };
      }

      if (normalizedQuery.startsWith('insert into "receipt_scan_rate_limits"')) {
        dbState.receiptScanRateLimits.push({
          id: params[0],
          userId: params[1],
          bucketKey: params[2],
          count: params[3],
          updatedAt: params[4],
        });

        return { success: true, meta: { changes: 1 } };
      }

      if (normalizedQuery.startsWith('delete from "receipt_scans"')) {
        const index = dbState.receiptScans.findIndex((row) => row.scanId === params[0]);
        if (index >= 0) dbState.receiptScans.splice(index, 1);
        return { success: true, meta: { changes: index >= 0 ? 1 : 0 } };
      }

      if (normalizedQuery.startsWith('update "expenses"')) {
        const expense = dbState.expenses.find((row) => row.id === params[2] && row.userId === params[3]);
        if (expense) {
          expense.updatedAt = params[0];
          expense.deletedAt = params[1];
          return { success: true, meta: { changes: 1 } };
        }

        return { success: true, meta: { changes: 0 } };
      }

      if (normalizedQuery.startsWith('update "recurring_expense_rules"')) {
        const rule = dbState.recurringExpenseRules.find((row) => row.id === params[2] && row.userId === params[3]);
        if (rule) {
          rule.nextDueAt = params[0];
          rule.updatedAt = params[1];
          return { success: true, meta: { changes: 1 } };
        }

        return { success: true, meta: { changes: 0 } };
      }

      if (normalizedQuery.startsWith('update "receipt_scan_usage"')) {
        const record = dbState.receiptScanUsage.find((row) => row.userId === params[2] && row.bucketKey === params[3]);
        if (record) {
          record.count = params[0];
          record.updatedAt = params[1];
          return { success: true, meta: { changes: 1 } };
        }

        return { success: true, meta: { changes: 0 } };
      }

      if (normalizedQuery.startsWith('update "receipt_scan_rate_limits"')) {
        const record = dbState.receiptScanRateLimits.find((row) => row.userId === params[2] && row.bucketKey === params[3]);
        if (record) {
          record.count = params[0];
          record.updatedAt = params[1];
          return { success: true, meta: { changes: 1 } };
        }

        return { success: true, meta: { changes: 0 } };
      }

      if (normalizedQuery.startsWith('update "receipt_scans"')) {
        const scan = dbState.receiptScans.find((row) => params.includes(row.scanId));
        if (!scan) {
          return { success: true, meta: { changes: 0 } };
        }

        if (normalizedQuery.includes('"status" = ?')) {
          scan.status = params[0];
        }

        if (normalizedQuery.includes('"parsed_data_json" = ?')) {
          scan.parsedDataJson = params[1];
          scan.failureMessage = params[2];
          scan.updatedAt = params[3];
          scan.completedAt = params[4];
        } else if (normalizedQuery.includes('"failure_message" = ?')) {
          scan.failureMessage = params[1];
          scan.updatedAt = params[2];
          scan.completedAt = params[3];
        } else {
          scan.updatedAt = params[1];
        }

        return { success: true, meta: { changes: 1 } };
      }

      return { success: true, meta: { changes: 0 } };
    },
  };
}

const MOCK_ENV = {
  DB: {
    prepare: (query: string) => createMockStmt(query),
    batch: async (commands: Array<ReturnType<typeof createMockStmt>>) => Promise.all(commands.map((command) => command.run())),
  } as unknown as D1Database,
  JWT_SECRET: 'test-secret',
  RECEIPT_IMAGES: {
    put: async (key: string, body: Blob | ReadableStream, options?: { customMetadata?: Record<string, string> }) => {
      dbState.receiptImages.set(key, { body, metadata: options?.customMetadata });
      return null;
    },
    get: async (key: string) => {
      const stored = dbState.receiptImages.get(key);
      if (!stored) return null;
      return {
        arrayBuffer: async () => stored.body instanceof Blob ? stored.body.arrayBuffer() : new Response(stored.body).arrayBuffer(),
      };
    },
    delete: async (key: string) => {
      dbState.receiptImages.delete(key);
    },
  } as unknown as R2Bucket,
  RECEIPT_SCAN_QUEUE: {
    send: async (message: { scanId: string }) => {
      dbState.receiptQueueMessages.push(message);
    },
  } as unknown as Queue<{ scanId: string }>,
  GOOGLE_VISION_API_KEY: 'test-vision-key',
  GEMINI_API_KEY: 'test-gemini-key',
};

async function registerAndLogin(email: string) {
  const password = 'password123';

  const registerResponse = await app.request(
    '/api/auth/register',
    {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'Content-Type': 'application/json' },
    },
    MOCK_ENV,
  );

  expect(registerResponse.status).toBe(201);

  const loginResponse = await app.request(
    '/api/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'Content-Type': 'application/json' },
    },
    MOCK_ENV,
  );

  expect(loginResponse.status).toBe(200);
  const loginPayload = await loginResponse.json() as any;

  return {
    token: loginPayload.token as string,
    userId: loginPayload.user.id as string,
    password,
  };
}

beforeEach(() => {
  resetDbState();
});

describe('Recurring helpers', () => {
  test('normalizeRecurringIntervalUnit accepts documented aliases', () => {
    expect(normalizeRecurringIntervalUnit('daily')).toBe('DAY');
    expect(normalizeRecurringIntervalUnit('WEEK')).toBe('WEEK');
    expect(normalizeRecurringIntervalUnit('unknown')).toBeNull();
  });

  test('advanceRecurringDate rejects invalid interval values', () => {
    expect(advanceRecurringDate(Date.UTC(2026, 0, 1), 'MONTHLY', 1)).not.toBeNull();
    expect(advanceRecurringDate(Date.UTC(2026, 0, 1), 'MONTHLY', 0)).toBeNull();
  });
});

describe('Sync helpers', () => {
  test('isIncomingChangeNewer only accepts newer updates', () => {
    expect(isIncomingChangeNewer(100, 101)).toBe(true);
    expect(isIncomingChangeNewer(100, 100)).toBe(false);
    expect(isIncomingChangeNewer(100, 99)).toBe(false);
  });

  test('shouldApplyDelete rejects stale deletes', () => {
    expect(shouldApplyDelete(100, 100)).toBe(true);
    expect(shouldApplyDelete(101, 100)).toBe(false);
    expect(shouldApplyDelete(101)).toBe(true);
  });
});

describe('Expense Tracker API', () => {
  test('POST /api/auth/register validates payloads', async () => {
    const response = await app.request(
      '/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ email: 'invalid-email', password: 'short' }),
        headers: { 'Content-Type': 'application/json' },
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(400);
  });

  test('POST /api/auth/register rejects duplicate users', async () => {
    const email = `duplicate-${Date.now()}@example.com`;

    const firstResponse = await app.request(
      '/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ email, password: 'password123' }),
        headers: { 'Content-Type': 'application/json' },
      },
      MOCK_ENV,
    );

    const secondResponse = await app.request(
      '/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ email, password: 'password123' }),
        headers: { 'Content-Type': 'application/json' },
      },
      MOCK_ENV,
    );

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(400);
  });

  test('POST /api/auth/login ignores soft-deleted users', async () => {
    const email = `deleted-${Date.now()}@example.com`;
    await registerAndLogin(email);

    dbState.users[0].deletedAt = new Date();

    const response = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password: 'password123' }),
        headers: { 'Content-Type': 'application/json' },
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(401);
  });

  test('GET /api/profile requires a token', async () => {
    const response = await app.request('/api/profile', {}, MOCK_ENV);
    expect(response.status).toBe(401);
  });

  test('GET /api/profile rejects an invalid token', async () => {
    const response = await app.request(
      '/api/profile',
      {
        headers: { Authorization: 'Bearer invalid-token' },
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(401);
  });

  test('GET /api/profile returns the authenticated user', async () => {
    const { token } = await registerAndLogin(`profile-${Date.now()}@example.com`);

    const response = await app.request(
      '/api/profile',
      {
        headers: { Authorization: `Bearer ${token}` },
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as any;
    expect(payload.email).toContain('profile-');
  });

  test('GET /api/expenses excludes soft-deleted expenses', async () => {
    const { token, userId } = await registerAndLogin(`expenses-${Date.now()}@example.com`);

    dbState.expenses.push(
      {
        id: 'expense-active',
        userId,
        amount: 10,
        categoryId: 'category-1',
        date: 2,
        note: null,
        paymentMethod: 'CARD',
        status: 'PAID',
        origin: 'MANUAL',
        recurringRuleId: null,
        resolvedAt: null,
        createdAt: 1,
        updatedAt: 2,
        deletedAt: null,
      },
      {
        id: 'expense-deleted',
        userId,
        amount: 20,
        categoryId: 'category-1',
        date: 3,
        note: null,
        paymentMethod: 'CARD',
        status: 'PAID',
        origin: 'MANUAL',
        recurringRuleId: null,
        resolvedAt: null,
        createdAt: 1,
        updatedAt: 3,
        deletedAt: 999,
      },
    );

    const response = await app.request(
      '/api/expenses',
      {
        headers: { Authorization: `Bearer ${token}` },
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as any[];
    expect(payload).toHaveLength(1);
    expect(payload[0].id).toBe('expense-active');
  });

  test('GET /api/sync requires a token', async () => {
    const response = await app.request('/api/sync?last_pulled_at=0', {}, MOCK_ENV);
    expect(response.status).toBe(401);
  });

  test('GET /api/sync rejects an invalid token', async () => {
    const response = await app.request(
      '/api/sync?last_pulled_at=0',
      {
        headers: { Authorization: 'Bearer invalid-token' },
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(401);
  });

  test('GET /api/sync validates last_pulled_at', async () => {
    const { token } = await registerAndLogin(`sync-${Date.now()}@example.com`);

    const response = await app.request(
      '/api/sync?last_pulled_at=invalid',
      {
        headers: { Authorization: `Bearer ${token}` },
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(400);
  });

  test('POST /api/sync accepts a valid expense payload', async () => {
    const { token } = await registerAndLogin(`push-${Date.now()}@example.com`);
    const expenseId = crypto.randomUUID();
    const expenseCreatedAt = Date.now();

    const response = await app.request(
      '/api/sync',
      {
        method: 'POST',
        body: JSON.stringify({
          last_pulled_at: 0,
          changes: {
            expenses: {
              created: [
                {
                  id: expenseId,
                  amount: 100,
                  categoryId: 'category-1',
                  date: expenseCreatedAt,
                  note: null,
                  paymentMethod: 'CARD',
                  status: 'PAID',
                  origin: 'MANUAL',
                  recurringRuleId: null,
                  resolvedAt: null,
                  createdAt: expenseCreatedAt,
                  updatedAt: expenseCreatedAt,
                },
              ],
              updated: [],
              deleted: [],
            },
          },
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(200);
    expect(dbState.expenses).toHaveLength(1);

    const pullResponse = await app.request(
      '/api/sync?last_pulled_at=0',
      {
        headers: { Authorization: `Bearer ${token}` },
      },
      MOCK_ENV,
    );

    expect(pullResponse.status).toBe(200);
    const pullPayload = await pullResponse.json() as any;
    expect(pullPayload.changes.expenses.created).toHaveLength(1);
    expect(pullPayload.changes.expenses.created[0].id).toBe(expenseId);
  });

  test('POST /api/sync rejects extra fields in a strict payload', async () => {
    const { token } = await registerAndLogin(`strict-${Date.now()}@example.com`);

    const response = await app.request(
      '/api/sync',
      {
        method: 'POST',
        body: JSON.stringify({
          last_pulled_at: 0,
          changes: {
            expenses: {
              created: [
                {
                  id: crypto.randomUUID(),
                  amount: 100,
                  categoryId: 'category-1',
                  date: Date.now(),
                  note: null,
                  paymentMethod: 'CARD',
                  status: 'PAID',
                  origin: 'MANUAL',
                  recurringRuleId: null,
                  resolvedAt: null,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  description: 'should be rejected',
                },
              ],
              updated: [],
              deleted: [],
            },
          },
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(400);
  });

  test('POST /api/sync rejects record takeover by id', async () => {
    const { token } = await registerAndLogin(`takeover-${Date.now()}@example.com`);

    dbState.expenses.push({
      id: 'shared-expense',
      userId: 'other-user',
      amount: 10,
      categoryId: 'category-1',
      date: 1,
      note: null,
      paymentMethod: 'CARD',
      status: 'PAID',
      origin: 'MANUAL',
      recurringRuleId: null,
      resolvedAt: null,
      createdAt: 1,
      updatedAt: 10,
      deletedAt: null,
    });

    const response = await app.request(
      '/api/sync',
      {
        method: 'POST',
        body: JSON.stringify({
          last_pulled_at: 0,
          changes: {
            expenses: {
              created: [],
              updated: [
                {
                  id: 'shared-expense',
                  amount: 100,
                  categoryId: 'category-1',
                  date: 2,
                  note: null,
                  paymentMethod: 'CARD',
                  status: 'PAID',
                  origin: 'MANUAL',
                  recurringRuleId: null,
                  resolvedAt: null,
                  createdAt: 1,
                  updatedAt: 20,
                },
              ],
              deleted: [],
            },
          },
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(403);
  });

  test('POST /api/sync ignores stale updates', async () => {
    const { token, userId } = await registerAndLogin(`stale-${Date.now()}@example.com`);

    dbState.expenses.push({
      id: 'owned-expense',
      userId,
      amount: 10,
      categoryId: 'category-1',
      date: 1,
      note: null,
      paymentMethod: 'CARD',
      status: 'PAID',
      origin: 'MANUAL',
      recurringRuleId: null,
      resolvedAt: null,
      createdAt: 1,
      updatedAt: 20,
      deletedAt: null,
    });

    const response = await app.request(
      '/api/sync',
      {
        method: 'POST',
        body: JSON.stringify({
          last_pulled_at: 0,
          changes: {
            expenses: {
              created: [],
              updated: [
                {
                  id: 'owned-expense',
                  amount: 999,
                  categoryId: 'category-1',
                  date: 2,
                  note: null,
                  paymentMethod: 'CARD',
                  status: 'PAID',
                  origin: 'MANUAL',
                  recurringRuleId: null,
                  resolvedAt: null,
                  createdAt: 1,
                  updatedAt: 10,
                },
              ],
              deleted: [],
            },
          },
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(200);
    expect(dbState.expenses[0].amount).toBe(10);
  });

  test('POST /api/sync rejects negative expenses', async () => {
    const { token } = await registerAndLogin(`negative-${Date.now()}@example.com`);

    const response = await app.request(
      '/api/sync',
      {
        method: 'POST',
        body: JSON.stringify({
          last_pulled_at: 0,
          changes: {
            expenses: {
              created: [
                {
                  id: crypto.randomUUID(),
                  amount: -50,
                  categoryId: 'category-1',
                  date: Date.now(),
                  note: null,
                  paymentMethod: 'CARD',
                  status: 'PAID',
                  origin: 'MANUAL',
                  recurringRuleId: null,
                  resolvedAt: null,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                },
              ],
              updated: [],
              deleted: [],
            },
          },
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(400);
  });

  test('POST /api/receipt-scans requires a token', async () => {
    const response = await app.request('/api/receipt-scans', { method: 'POST' }, MOCK_ENV);
    expect(response.status).toBe(401);
  });

  test('POST /api/receipt-scans validates required multipart fields', async () => {
    const { token } = await registerAndLogin(`receipt-missing-${Date.now()}@example.com`);
    const form = new FormData();

    const response = await app.request(
      '/api/receipt-scans',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(422);
  });

  test('POST /api/receipt-scans rejects non-JPEG files', async () => {
    const { token } = await registerAndLogin(`receipt-type-${Date.now()}@example.com`);
    const form = createReceiptScanForm({ imageType: 'image/png' });

    const response = await app.request(
      '/api/receipt-scans',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(415);
  });

  test('POST /api/receipt-scans rejects oversized images', async () => {
    const { token } = await registerAndLogin(`receipt-large-${Date.now()}@example.com`);

    const response = await app.request(
      '/api/receipt-scans',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: createReceiptScanForm({ imageSize: 4 * 1024 * 1024 + 1 }),
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(413);
  });

  test('POST /api/receipt-scans creates a queued scan and enqueues processing', async () => {
    const { token, userId } = await registerAndLogin(`receipt-create-${Date.now()}@example.com`);
    const clientScanId = crypto.randomUUID();
    const form = createReceiptScanForm({ clientScanId });

    const response = await app.request(
      '/api/receipt-scans',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(201);
    const payload = await response.json() as { scanId: string };
    expect(payload.scanId).toBeTruthy();
    expect(dbState.receiptScans).toHaveLength(1);
    expect(dbState.receiptScans[0]).toMatchObject({
      scanId: payload.scanId,
      clientScanId,
      userId,
      status: 'queued',
      currency: 'USD',
    });
    expect(dbState.receiptImages.size).toBe(1);
    expect(dbState.receiptQueueMessages).toEqual([{ scanId: payload.scanId }]);
  });

  test('POST /api/receipt-scans is idempotent by clientScanId and does not consume extra limits', async () => {
    const { token } = await registerAndLogin(`receipt-idempotent-${Date.now()}@example.com`);
    const clientScanId = crypto.randomUUID();

    const firstResponse = await app.request(
      '/api/receipt-scans',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: createReceiptScanForm({ clientScanId }),
      },
      MOCK_ENV,
    );
    const firstPayload = await firstResponse.json() as { scanId: string };

    const secondResponse = await app.request(
      '/api/receipt-scans',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: createReceiptScanForm({ clientScanId }),
      },
      MOCK_ENV,
    );
    const secondPayload = await secondResponse.json() as { scanId: string };

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(200);
    expect(secondPayload.scanId).toBe(firstPayload.scanId);
    expect(dbState.receiptScans).toHaveLength(1);
    expect(dbState.receiptQueueMessages).toHaveLength(1);
    expect(dbState.receiptScanUsage[0].count).toBe(1);
    expect(dbState.receiptScanRateLimits[0].count).toBe(1);
  });

  test('POST /api/receipt-scans enforces the short per-user rate limit', async () => {
    const { token } = await registerAndLogin(`receipt-rate-${Date.now()}@example.com`);

    for (let index = 0; index < 5; index += 1) {
      const response = await app.request(
        '/api/receipt-scans',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: createReceiptScanForm({ clientScanId: crypto.randomUUID() }),
        },
        MOCK_ENV,
      );
      expect(response.status).toBe(201);
    }

    const blockedResponse = await app.request(
      '/api/receipt-scans',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: createReceiptScanForm({ clientScanId: crypto.randomUUID() }),
      },
      MOCK_ENV,
    );

    expect(blockedResponse.status).toBe(429);
  });

  test('POST /api/receipt-scans enforces the daily per-user scan limit', async () => {
    const { token, userId } = await registerAndLogin(`receipt-daily-${Date.now()}@example.com`);
    const todayBucket = new Date().toISOString().slice(0, 10);
    dbState.receiptScanUsage.push({
      id: `${userId}:${todayBucket}`,
      userId,
      bucketKey: todayBucket,
      count: 15,
      updatedAt: Date.now(),
    });

    const response = await app.request(
      '/api/receipt-scans',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: createReceiptScanForm({ clientScanId: crypto.randomUUID() }),
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(429);
  });

  test('GET /api/receipt-scans/:scanId returns completed and failed states for the owner only', async () => {
    const { token, userId } = await registerAndLogin(`receipt-status-${Date.now()}@example.com`);
    const other = await registerAndLogin(`receipt-status-other-${Date.now()}@example.com`);
    dbState.receiptScans.push({
      scanId: 'scan-completed',
      clientScanId: crypto.randomUUID(),
      userId,
      status: 'completed',
      locale: 'es',
      currency: 'USD',
      timezone: 'America/Bogota',
      imageObjectKey: 'receipt-scans/test.jpg',
      parsedDataJson: JSON.stringify({ amount: 10, warnings: [] }),
      failureMessage: null,
      createdAt: 1,
      updatedAt: 2,
      completedAt: 2,
    });

    const response = await app.request(
      '/api/receipt-scans/scan-completed',
      { headers: { Authorization: `Bearer ${token}` } },
      MOCK_ENV,
    );
    expect(response.status).toBe(200);
    const payload = await response.json() as any;
    expect(payload.status).toBe('completed');
    expect(payload.data.amount).toBe(10);

    const blockedResponse = await app.request(
      '/api/receipt-scans/scan-completed',
      { headers: { Authorization: `Bearer ${other.token}` } },
      MOCK_ENV,
    );
    expect(blockedResponse.status).toBe(404);
  });

  test('receipt scan processing marks missing images as failed', async () => {
    const originalError = console.error;
    console.error = () => undefined;
    dbState.receiptScans.push({
      scanId: 'scan-missing-image',
      clientScanId: crypto.randomUUID(),
      userId: 'user-1',
      status: 'queued',
      locale: 'es',
      currency: 'USD',
      timezone: 'America/Bogota',
      imageObjectKey: 'receipt-scans/missing.jpg',
      parsedDataJson: null,
      failureMessage: null,
      createdAt: 1,
      updatedAt: 1,
      completedAt: null,
    });

    try {
      await processReceiptScan('scan-missing-image', MOCK_ENV);

      expect(dbState.receiptScans[0].status).toBe('failed');
      expect(dbState.receiptScans[0].failureMessage).toBe('No se pudo leer la factura');
    } finally {
      console.error = originalError;
    }
  });
});

function createReceiptScanForm(options: { clientScanId?: string; imageType?: string; imageSize?: number } = {}) {
  const form = new FormData();
  const clientScanId = options.clientScanId ?? crypto.randomUUID();
  const imageType = options.imageType ?? 'image/jpeg';
  const imageSize = options.imageSize ?? 12;
  form.append('clientScanId', clientScanId);
  form.append('locale', 'es');
  form.append('currency', 'USD');
  form.append('timezone', 'America/Bogota');
  const extension = imageType === 'image/jpeg' ? 'jpg' : 'png';
  form.append('image', new File([new Uint8Array(imageSize)], `${clientScanId}.${extension}`, { type: imageType }));
  return form;
}
