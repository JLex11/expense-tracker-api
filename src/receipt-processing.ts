import { and, eq } from 'drizzle-orm';
import { getDb } from './db';
import { receiptScans } from './db/schema';
import type { ReceiptCategoryOption } from './receipt-ai';
import { extractReceiptText, parseReceiptText } from './receipt-ai';
import type { CloudflareBindings, ReceiptScanQueueMessage } from './types';

const failedMessage = 'No se pudo leer la factura';

export async function processReceiptScan(scanId: string, env: CloudflareBindings) {
  const db = getDb(env);
  const records = await db
    .select()
    .from(receiptScans)
    .where(eq(receiptScans.scanId, scanId))
    .limit(1);

  const scan = records[0];
  if (!scan || scan.status === 'completed' || scan.status === 'failed') {
    return;
  }

  const now = Date.now();
  await db
    .update(receiptScans)
    .set({ status: 'processing', updatedAt: now })
    .where(and(eq(receiptScans.scanId, scanId), eq(receiptScans.status, scan.status)));

  try {
    const object = await env.RECEIPT_IMAGES.get(scan.imageObjectKey);
    if (!object) {
      throw new Error(failedMessage);
    }

    const image = await object.arrayBuffer();
    const rawText = await extractReceiptText(image, env);
    const categories = parseStoredCategories(scan.categoriesJson);
    const parsedData = await parseReceiptText(rawText, env, {
      locale: scan.locale,
      currency: scan.currency,
      timezone: scan.timezone,
      categories,
    });

    const completedAt = Date.now();
    await db
      .update(receiptScans)
      .set({
        status: 'completed',
        parsedDataJson: JSON.stringify(parsedData),
        failureMessage: null,
        updatedAt: completedAt,
        completedAt,
      })
      .where(eq(receiptScans.scanId, scanId));

    await env.RECEIPT_IMAGES.delete(scan.imageObjectKey);
  } catch (error) {
    console.error('receipt_scan_failed', { scanId, message: error instanceof Error ? error.message : String(error) });
    const completedAt = Date.now();
    await db
      .update(receiptScans)
      .set({
        status: 'failed',
        failureMessage: failedMessage,
        updatedAt: completedAt,
        completedAt,
      })
      .where(eq(receiptScans.scanId, scanId));

    await env.RECEIPT_IMAGES.delete(scan.imageObjectKey).catch((deleteError) => {
      console.error('receipt_scan_image_delete_failed', {
        scanId,
        message: deleteError instanceof Error ? deleteError.message : String(deleteError),
      });
    });
  }
}

export async function processReceiptScanQueue(batch: MessageBatch<ReceiptScanQueueMessage>, env: CloudflareBindings) {
  for (const message of batch.messages) {
    await processReceiptScan(message.body.scanId, env);
  }
}

function parseStoredCategories(value: string | null): ReceiptCategoryOption[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is { id: unknown; name: unknown } => typeof item === 'object' && item !== null)
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id.trim() : '',
        name: typeof item.name === 'string' ? item.name.trim() : '',
      }))
      .filter((category) => category.id.length > 0 && category.name.length > 0);
  } catch {
    return [];
  }
}
