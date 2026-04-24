import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { getDb } from './db';
import { receiptScanRateLimits, receiptScans, receiptScanUsage } from './db/schema';
import type { ReceiptCategoryOption } from './receipt-ai';
import type { CloudflareBindings, JWTPayload } from './types';

const maxImageBytes = 4 * 1024 * 1024;
const maxDailyScans = 15;
const maxMinuteScans = 5;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const receiptScansRoute = new Hono<{ Bindings: CloudflareBindings; Variables: { jwtPayload: JWTPayload } }>();

receiptScansRoute.post('/', async (c) => {
  const userId = c.get('jwtPayload').id;
  const contentType = c.req.header('Content-Type') || '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return c.json({ message: 'Formulario inválido' }, 422);
  }

  const body = await c.req.parseBody();
  const image = body.image;
  const clientScanId = String(body.clientScanId || '');
  const locale = normalizeReceiptLocale(String(body.locale || 'es'));
  const currency = String(body.currency || '').toUpperCase();
  const timezone = String(body.timezone || '');
  const categories = parseCategories(body.categories);

  if (!clientScanId || !uuidPattern.test(clientScanId) || !(image instanceof File)) {
    return c.json({ message: 'Falta la imagen o el identificador del escaneo' }, 422);
  }

  if (!currency || !timezone) {
    return c.json({ message: 'Faltan datos del escaneo' }, 422);
  }

  if (categories === null) {
    return c.json({ message: 'Las categorías no son válidas' }, 422);
  }

  if (image.type !== 'image/jpeg') {
    return c.json({ message: 'La imagen debe ser JPEG' }, 415);
  }

  if (image.size > maxImageBytes) {
    return c.json({ message: 'La imagen es demasiado grande' }, 413);
  }

  const db = getDb(c.env);
  const existingScan = await findScanByClientId(userId, clientScanId, c.env);
  if (existingScan) {
    return c.json({ scanId: existingScan.scanId }, 200);
  }

  const limitStatus = await reserveScanLimits(c.env, userId, Date.now());
  if (!limitStatus.allowed) {
    return c.json({ message: 'Límite de escaneos alcanzado' }, 429);
  }

  const scanId = crypto.randomUUID();
  const imageObjectKey = `receipt-scans/${userId}/${scanId}.jpg`;
  const now = Date.now();

  try {
    await c.env.RECEIPT_IMAGES.put(imageObjectKey, image.stream(), {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { userId, scanId, clientScanId },
    });

    await db.insert(receiptScans).values({
      scanId,
      clientScanId,
      userId,
      status: 'queued',
      locale,
      currency,
      timezone,
      categoriesJson: JSON.stringify(categories),
      imageObjectKey,
      parsedDataJson: null,
      failureMessage: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });

    await c.env.RECEIPT_SCAN_QUEUE.send({ scanId });
  } catch (error) {
    await c.env.RECEIPT_IMAGES.delete(imageObjectKey).catch(() => undefined);
    await db.delete(receiptScans).where(eq(receiptScans.scanId, scanId)).catch(() => undefined);

    const raceScan = await findScanByClientId(userId, clientScanId, c.env);
    if (raceScan) {
      return c.json({ scanId: raceScan.scanId }, 200);
    }

    console.error('receipt_scan_create_failed', { userId, message: error instanceof Error ? error.message : String(error) });
    return c.json({ message: 'No se pudo crear el escaneo' }, 500);
  }

  return c.json({ scanId }, 201);
});

receiptScansRoute.get('/:scanId', async (c) => {
  const userId = c.get('jwtPayload').id;
  const scanId = c.req.param('scanId');
  const db = getDb(c.env);
  const records = await db
    .select()
    .from(receiptScans)
    .where(and(eq(receiptScans.scanId, scanId), eq(receiptScans.userId, userId)))
    .limit(1);

  const scan = records[0];
  if (!scan) {
    return c.json({ message: 'Escaneo no encontrado' }, 404);
  }

  if (scan.status === 'completed') {
    return c.json({
      status: 'completed',
      data: parseStoredReceiptData(scan.parsedDataJson),
    });
  }

  if (scan.status === 'failed') {
    return c.json({
      status: 'failed',
      message: scan.failureMessage || 'No se pudo leer la factura',
    });
  }

  return c.json({ status: scan.status });
});

async function findScanByClientId(userId: string, clientScanId: string, env: CloudflareBindings) {
  const db = getDb(env);
  const records = await db
    .select({ scanId: receiptScans.scanId })
    .from(receiptScans)
    .where(and(eq(receiptScans.userId, userId), eq(receiptScans.clientScanId, clientScanId)))
    .limit(1);

  return records[0] ?? null;
}

function parseStoredReceiptData(value: string | null) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function parseCategories(rawValue: string | File | (string | File)[] | undefined): ReceiptCategoryOption[] | null {
  if (rawValue === undefined) {
    return [];
  }

  if (rawValue instanceof File || Array.isArray(rawValue)) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }

    const categories = parsed
      .filter((item): item is { id: unknown; name: unknown } => typeof item === 'object' && item !== null)
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id.trim() : '',
        name: typeof item.name === 'string' ? item.name.trim() : '',
      }))
      .filter((category) => category.id.length > 0 && category.name.length > 0);

    return categories.length === parsed.length ? categories : null;
  } catch {
    return null;
  }
}

async function reserveScanLimits(env: CloudflareBindings, userId: string, now: number) {
  const dayBucket = new Date(now).toISOString().slice(0, 10);
  const minuteBucket = Math.floor(now / 60000).toString();
  const minuteStatus = await incrementLimit(env, receiptScanRateLimits, userId, minuteBucket, now, maxMinuteScans);
  if (!minuteStatus.allowed) return minuteStatus;

  return incrementLimit(env, receiptScanUsage, userId, dayBucket, now, maxDailyScans);
}

async function incrementLimit(
  env: CloudflareBindings,
  table: typeof receiptScanRateLimits | typeof receiptScanUsage,
  userId: string,
  bucketKey: string,
  now: number,
  limit: number,
) {
  const db = getDb(env);
  const id = `${userId}:${bucketKey}`;
  const existing = await db
    .select()
    .from(table)
    .where(and(eq(table.userId, userId), eq(table.bucketKey, bucketKey)))
    .limit(1);

  if (!existing[0]) {
    await db.insert(table).values({ id, userId, bucketKey, count: 1, updatedAt: now });
    return { allowed: true };
  }

  const count = existing[0].count + 1;
  await db
    .update(table)
    .set({ count, updatedAt: now })
    .where(and(eq(table.userId, userId), eq(table.bucketKey, bucketKey)));

  return { allowed: count <= limit };
}

export default receiptScansRoute;

function normalizeReceiptLocale(locale: string) {
  return locale.trim().slice(0, 12) || 'es';
}
