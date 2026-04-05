import { describe, expect, test } from 'bun:test';
import * as bcrypt from 'bcryptjs';
import { app } from './index';

const dbState = {
  users: [] as any[],
  expenses: [] as any[],
};

const createMockStmt = (query: string, params: any[] = []) => {
  return {
    bind: (...newParams: any[]) => createMockStmt(query, newParams),
    first: async () => null,
    run: async () => ({ success: true }),
    all: async () => {
      if (query.toLowerCase().includes('expenses')) {
        return { results: dbState.expenses };
      }

      return { results: [] };
    },
    raw: async () => {
      if (query.toLowerCase().includes('users')) {
        let user;
        if (query.includes('"email" = ?') || query.includes('email = ?')) {
          user = dbState.users.find((candidate) => candidate.email === params[0]);
        } else if (query.includes('"id" = ?') || query.includes('id = ?')) {
          user = dbState.users.find((candidate) => candidate.id === params[0]);
        }

        if (!user) {
          return [];
        }

        if (query.includes('"password"') === false) {
          return [[user.id, user.email, user.updatedAt, null]];
        }

        return [[user.id, user.email, user.password, user.updatedAt, null]];
      }

      return [];
    },
  };
};

const MOCK_ENV = {
  DB: {
    prepare: (query: string) => createMockStmt(query),
    batch: async (cmds: any[]) => cmds.map(() => ({ success: true })),
  } as unknown as D1Database,
  JWT_SECRET: 'test-secret',
};

describe('Expense Tracker API', () => {
  let authToken = '';
  const testUser = {
    email: `test-${Date.now()}@example.com`,
    password: 'password123',
  };

  test('registers and logs in a user', async () => {
    const registerResponse = await app.request(
      '/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify(testUser),
        headers: { 'Content-Type': 'application/json' },
      },
      MOCK_ENV,
    );

    expect(registerResponse.status).toBe(201);
    const registerPayload = (await registerResponse.json()) as any;
    expect(registerPayload.token).toBeDefined();

    dbState.users.push({
      id: registerPayload.user.id,
      email: testUser.email,
      password: await bcrypt.hash(testUser.password, 10),
      updatedAt: new Date().toISOString(),
    });

    const loginResponse = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify(testUser),
        headers: { 'Content-Type': 'application/json' },
      },
      MOCK_ENV,
    );

    expect(loginResponse.status).toBe(200);
    const loginPayload = (await loginResponse.json()) as any;
    authToken = loginPayload.token;
  });

  test('protects profile without token', async () => {
    const response = await app.request('/api/profile', {}, MOCK_ENV);
    expect(response.status).toBe(401);
  });

  test('returns profile with token', async () => {
    const response = await app.request(
      '/api/profile',
      {
        headers: { Authorization: `Bearer ${authToken}` },
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.email).toBe(testUser.email);
  });

  test('rejects invalid sync payloads', async () => {
    const response = await app.request(
      '/api/sync',
      {
        method: 'POST',
        body: JSON.stringify({ invalid: true }),
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(400);
  });

  test('rejects invalid sync query values', async () => {
    const response = await app.request(
      '/api/sync?last_pulled_at=abc',
      {
        headers: { Authorization: `Bearer ${authToken}` },
      },
      MOCK_ENV,
    );

    expect(response.status).toBe(400);
  });
});
