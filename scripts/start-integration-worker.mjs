import { writeFile } from 'node:fs/promises';
import { unstable_dev } from 'wrangler';

const persistDir = process.env.PERSIST_DIR;
const readyFile = process.env.READY_FILE;
const jwtSecret = process.env.JWT_SECRET;
const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:3000';

if (!persistDir || !readyFile || !jwtSecret) {
  throw new Error('PERSIST_DIR, READY_FILE and JWT_SECRET are required');
}

const worker = await unstable_dev('src/index.ts', {
  config: 'wrangler.jsonc',
  local: true,
  logLevel: 'error',
  persistTo: persistDir,
  vars: {
    JWT_SECRET: jwtSecret,
    CORS_ORIGIN: corsOrigin,
  },
  experimental: {
    disableExperimentalWarning: true,
    testMode: true,
  },
});

await writeFile(
  readyFile,
  JSON.stringify({
    address: worker.address,
    port: worker.port,
  }),
  'utf8',
);

const shutdown = async () => {
  await worker.stop();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});

setInterval(() => {}, 1 << 30);
