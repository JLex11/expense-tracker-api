import { expect, test, describe } from "bun:test";
import app from "./index";
import * as bcrypt from "bcryptjs";

// Improved D1 Mock with in-memory storage for testing flows
const dbState = {
  users: [] as any[],
  expenses: [] as any[],
};

const createMockStmt = (query: string, params: any[] = []) => {
  return {
    bind: (...newParams: any[]) => createMockStmt(query, newParams),
    first: async () => {
      return null;
    },
    run: async () => {
      return { success: true };
    },
    all: async () => {
      if (query.toLowerCase().includes("expenses")) {
        return { results: dbState.expenses };
      }
      return { results: [] };
    },
    raw: async () => {
      if (query.toLowerCase().includes("users")) {
        let user;
        if (query.includes('"email" = ?') || query.includes("email = ?")) {
          user = dbState.users.find((u) => u.email === params[0]);
        } else if (query.includes('"id" = ?') || query.includes("id = ?")) {
          user = dbState.users.find((u) => u.id === params[0]);
        }

        if (user) {
          if (query.includes('"password"') === false) {
            return [[user.id, user.email, user.updatedAt, null]];
          }
          return [[user.id, user.email, user.password, user.updatedAt, null]];
        }
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
  JWT_SECRET: "test-secret",
};

describe("Expense Tracker API", () => {
  let authToken: string;
  const testUser = {
    email: `test-${Date.now()}@example.com`,
    password: "password123",
  };

  describe("Authentication", () => {
    test("POST /api/auth/register (Success)", async () => {
      const res = await app.request(
        "/api/auth/register",
        {
          method: "POST",
          body: JSON.stringify(testUser),
          headers: { "Content-Type": "application/json" },
        },
        MOCK_ENV,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.token).toBeDefined();

      dbState.users.push({
        id: data.user.id,
        email: testUser.email,
        password: await bcrypt.hash(testUser.password, 10),
        updatedAt: new Date().toISOString(),
      });
    });

    test("POST /api/auth/register (Duplicate User)", async () => {
      const res = await app.request(
        "/api/auth/register",
        {
          method: "POST",
          body: JSON.stringify(testUser),
          headers: { "Content-Type": "application/json" },
        },
        MOCK_ENV,
      );

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.error).toBe("User already exists");
    });

    test("POST /api/auth/login (Success)", async () => {
      const res = await app.request(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify(testUser),
          headers: { "Content-Type": "application/json" },
        },
        MOCK_ENV,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      authToken = data.token;
    });

    test("POST /api/auth/login (Invalid Password)", async () => {
      const res = await app.request(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            email: testUser.email,
            password: "wrong-password",
          }),
          headers: { "Content-Type": "application/json" },
        },
        MOCK_ENV,
      );

      expect(res.status).toBe(401);
    });
  });

  describe("Protected Endpoints", () => {
    test("GET /api/profile (Success)", async () => {
      const res = await app.request(
        "/api/profile",
        {
          headers: { Authorization: `Bearer ${authToken}` },
        },
        MOCK_ENV,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.email).toBe(testUser.email);
    });

    test("GET /api/profile (No Token)", async () => {
      const res = await app.request("/api/profile", {}, MOCK_ENV);
      expect(res.status).toBe(401);
    });

    test("GET /api/expenses (Success)", async () => {
      const res = await app.request(
        "/api/expenses",
        {
          headers: { Authorization: `Bearer ${authToken}` },
        },
        MOCK_ENV,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe("Synchronization", () => {
    test("GET /api/sync (Success)", async () => {
      const res = await app.request(
        "/api/sync?last_pulled_at=0",
        {
          method: "GET",
          headers: { Authorization: `Bearer ${authToken}` },
        },
        MOCK_ENV,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.timestamp).toBeDefined();
      expect(data.changes).toBeDefined();
    });

    test("POST /api/sync (Push Changes)", async () => {
      const mockChanges = {
        expenses: {
          created: [
            {
              id: crypto.randomUUID(),
              amount: 100,
              description: "Test Expense",
              date: Date.now(),
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
          updated: [],
          deleted: [],
        },
      };

      const res = await app.request(
        "/api/sync",
        {
          method: "POST",
          body: JSON.stringify({
            changes: mockChanges,
            last_pulled_at: Date.now(),
          }),
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
        },
        MOCK_ENV,
      );

      expect(res.status).toBe(200);
    });

    test("POST /api/sync (Negative Expense Amount)", async () => {
      const mockChanges = {
        expenses: {
          created: [
            {
              id: crypto.randomUUID(),
              amount: -50,
              description: "Negative Expense",
              date: Date.now(),
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
          updated: [],
          deleted: [],
        },
      };

      const res = await app.request(
        "/api/sync",
        {
          method: "POST",
          body: JSON.stringify({
            changes: mockChanges,
            last_pulled_at: Date.now(),
          }),
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
        },
        MOCK_ENV,
      );

      // Expecting 400 Bad Request if the API enforces non-negative amounts
      expect(res.status).toBe(400);
    });

    test("POST /api/sync (Invalid Payload Structure)", async () => {
      const res = await app.request(
        "/api/sync",
        {
          method: "POST",
          body: JSON.stringify({
            invalid: "payload",
          }),
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
        },
        MOCK_ENV,
      );

      expect(res.status).toBe(400);
    });
  });
});
