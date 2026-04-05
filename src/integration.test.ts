import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

setDefaultTimeout(30000);

const projectRoot = '/home/alexander/Projects/expense-tracker-api';
const jwtSecret = 'integration-test-secret';

let persistDir = '';
let readyFile = '';
let baseUrl = '';
let workerProcess: ReturnType<typeof Bun.spawn> | undefined;

function runCommand(cmd: string[]) {
  const result = Bun.spawnSync({
    cmd,
    cwd: projectRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      CI: '1',
    },
  });

  if (result.exitCode !== 0) {
    const stdout = Buffer.from(result.stdout).toString();
    const stderr = Buffer.from(result.stderr).toString();
    throw new Error(`Command failed: ${cmd.join(' ')}\n${stdout}\n${stderr}`);
  }
}

async function waitForFile(path: string, timeoutMs = 20000) {
  const startedAt = Date.now();

  while (!existsSync(path)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for file: ${path}`);
    }

    await Bun.sleep(250);
  }
}

async function request(path: string, init?: RequestInit) {
  return fetch(new URL(path, baseUrl), init);
}

async function registerAndLogin() {
  const email = `integration-${Date.now()}-${crypto.randomUUID()}@example.com`;
  const password = 'password123';

  const registerResponse = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  expect(registerResponse.status).toBe(201);

  const loginResponse = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  expect(loginResponse.status).toBe(200);
  const loginPayload = await loginResponse.json() as { token: string };

  return {
    email,
    token: loginPayload.token,
  };
}

beforeAll(async () => {
  persistDir = mkdtempSync(join(tmpdir(), 'expense-tracker-integration-'));
  readyFile = join(persistDir, 'worker-ready.json');

  runCommand([
    'bunx',
    'wrangler',
    'd1',
    'migrations',
    'apply',
    'DB',
    '--local',
    '--persist-to',
    persistDir,
    '--config',
    'wrangler.jsonc',
  ]);

  workerProcess = Bun.spawn({
    cmd: ['node', 'scripts/start-integration-worker.mjs'],
    cwd: projectRoot,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      ...process.env,
      PERSIST_DIR: persistDir,
      READY_FILE: readyFile,
      JWT_SECRET: jwtSecret,
      CORS_ORIGIN: 'http://localhost:3000',
    },
  });

  await waitForFile(readyFile);

  const { address, port } = JSON.parse(readFileSync(readyFile, 'utf8')) as { address: string; port: number };
  baseUrl = `http://${address}:${port}`;
});

afterAll(async () => {
  if (workerProcess) {
    workerProcess.kill();
    await workerProcess.exited;
  }

  if (persistDir) {
    rmSync(persistDir, { recursive: true, force: true });
  }
});

describe('Worker integration with real D1', () => {
  test('registers and logs in against a migrated local D1 database', async () => {
    const { email, token } = await registerAndLogin();

    const profileResponse = await request('/api/profile', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(profileResponse.status).toBe(200);
    const profile = await profileResponse.json() as { email: string };
    expect(profile.email).toBe(email);
  });

  test('persists sync changes and returns them on pull', async () => {
    const { token } = await registerAndLogin();
    const timestamp = Date.now();
    const categoryId = `category-${crypto.randomUUID()}`;
    const expenseId = `expense-${crypto.randomUUID()}`;

    const pushResponse = await request('/api/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        last_pulled_at: 0,
        changes: {
          categories: {
            created: [
              {
                id: categoryId,
                name: 'Integration Category',
                icon: 'receipt',
                createdAt: timestamp,
                updatedAt: timestamp,
              },
            ],
            updated: [],
            deleted: [],
          },
          expenses: {
            created: [
              {
                id: expenseId,
                amount: 42,
                categoryId,
                date: timestamp,
                note: 'Created from integration test',
                paymentMethod: 'CARD',
                status: 'PAID',
                origin: 'MANUAL',
                recurringRuleId: null,
                resolvedAt: null,
                createdAt: timestamp,
                updatedAt: timestamp,
              },
            ],
            updated: [],
            deleted: [],
          },
        },
      }),
    });

    expect(pushResponse.status).toBe(200);

    const expensesResponse = await request('/api/expenses', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(expensesResponse.status).toBe(200);
    const expenses = await expensesResponse.json() as Array<{ id: string }>;
    expect(expenses.some((expense) => expense.id === expenseId)).toBe(true);

    const pullResponse = await request('/api/sync?last_pulled_at=0', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(pullResponse.status).toBe(200);
    const pullPayload = await pullResponse.json() as {
      changes: {
        categories: { created: Array<{ id: string }> };
        expenses: { created: Array<{ id: string }> };
      };
    };

    expect(pullPayload.changes.categories.created.some((category) => category.id === categoryId)).toBe(true);
    expect(pullPayload.changes.expenses.created.some((expense) => expense.id === expenseId)).toBe(true);
  });
});
