import { describe, expect, test } from 'bun:test';
import {
  FuzzyExtractionCache,
  type ExtractionCacheStore,
  type JsonObject,
  type StoredExtractionCacheEntry,
} from './extraction-cache';
import { advanceRecurringDate, normalizeRecurringIntervalUnit } from './recurring';
import { buildGeminiReceiptPayload, normalizeParsedReceipt } from './receipt-ai';
import {
  buildReceiptOcrCacheContext,
  createReceiptOcrCache,
  extractReceiptCacheDocument,
  normalizeOcrWord,
} from './receipt-ocr-cache';
import { buildReceiptScanHashes, normalizeCategoriesForCache } from './receipt-scan-cache';
import { isIncomingChangeNewer, shouldApplyDelete } from './sync-logic';

describe('recurring helpers', () => {
  test('normalizes documented and legacy interval values', () => {
    expect(normalizeRecurringIntervalUnit('daily')).toBe('DAY');
    expect(normalizeRecurringIntervalUnit('WEEK')).toBe('WEEK');
    expect(normalizeRecurringIntervalUnit('monthly')).toBe('MONTH');
  });

  test('returns null for unsupported interval values', () => {
    expect(normalizeRecurringIntervalUnit('quarterly')).toBeNull();
    expect(advanceRecurringDate(Date.UTC(2025, 0, 1), 'quarterly', 1)).toBeNull();
  });

  test('advances recurring dates using normalized intervals', () => {
    const baseDate = Date.UTC(2025, 0, 1);

    expect(advanceRecurringDate(baseDate, 'daily', 2)).toBe(Date.UTC(2025, 0, 3));
    expect(advanceRecurringDate(baseDate, 'WEEKLY', 1)).toBe(Date.UTC(2025, 0, 8));
  });
});

describe('sync conflict helpers', () => {
  test('applies incoming changes only when they are newer', () => {
    expect(isIncomingChangeNewer(100, 101)).toBe(true);
    expect(isIncomingChangeNewer(100, 100)).toBe(false);
    expect(isIncomingChangeNewer(100, 99)).toBe(false);
  });

  test('applies deletes only when server state is not newer than last pull', () => {
    expect(shouldApplyDelete(100, 100)).toBe(true);
    expect(shouldApplyDelete(90, 100)).toBe(true);
    expect(shouldApplyDelete(101, 100)).toBe(false);
    expect(shouldApplyDelete(150, undefined)).toBe(true);
  });
});

describe('receipt scan helpers', () => {
  test('normalizes parsed receipt data for app defaults', () => {
    const normalized = normalizeParsedReceipt({
      amount: 12.5,
      date: '2026-04-23',
      merchant: ' Supermercado X ',
      currency: null,
      paymentMethod: 'unknown',
      categoryId: 'cat-1',
      confidence: 1.5,
      warnings: [' ok ', ''],
    }, 'dop', [{ id: 'cat-1', name: 'Comida' }]);

    expect(normalized).toEqual({
      amount: 12.5,
      date: '2026-04-23',
      merchant: 'Supermercado X',
      currency: 'DOP',
      paymentMethod: 'unknown',
      categoryId: 'cat-1',
      categoryName: 'Comida',
      note: 'Supermercado X',
      confidence: 1,
      warnings: [' ok '],
    });
  });

  test('rejects malformed dates and unsupported payment methods during normalization', () => {
    const normalized = normalizeParsedReceipt({
      date: '23/04/2026',
      paymentMethod: 'check',
      categoryId: 'missing',
      confidence: -1,
      warnings: [],
    }, 'usd', [{ id: 'cat-1', name: 'Comida' }]);

    expect(normalized.date).toBeNull();
    expect(normalized.paymentMethod).toBeNull();
    expect(normalized.confidence).toBe(0);
    expect(normalized.currency).toBe('USD');
    expect(normalized.categoryId).toBeNull();
    expect(normalized.categoryName).toBeNull();
  });

  test('builds Gemini REST payload with structured JSON config fields', () => {
    const payload = buildGeminiReceiptPayload('OCR text', {
      locale: 'es',
      currency: 'USD',
      timezone: 'America/Bogota',
      categories: [{ id: 'cat-1', name: 'Comida' }],
    });

    expect(payload.generationConfig.responseMimeType).toBe('application/json');
    expect(payload.generationConfig.responseJsonSchema.type).toBe('object');
    expect(JSON.stringify(payload.contents)).toContain('cat-1');
    expect(JSON.stringify(payload.contents)).toContain('mejor candidata');
  });

  test('normalizes cache categories by trimming, filtering and sorting', () => {
    expect(normalizeCategoriesForCache([
      { id: ' cat-2 ', name: ' Transporte ' },
      { id: '', name: 'Ignorar' },
      { id: 'cat-1', name: ' Comida ' },
    ])).toEqual([
      { id: 'cat-1', name: 'Comida' },
      { id: 'cat-2', name: 'Transporte' },
    ]);
  });

  test('builds stable hashes for the same image and normalized context', async () => {
    const image = new Uint8Array([1, 2, 3, 4]).buffer;
    const first = await buildReceiptScanHashes({
      image,
      locale: ' es ',
      currency: 'usd',
      timezone: 'America/Bogota',
      categories: [
        { id: 'cat-2', name: 'Transporte' },
        { id: 'cat-1', name: 'Comida' },
      ],
      geminiModel: 'gemini-test',
    });
    const second = await buildReceiptScanHashes({
      image,
      locale: 'es',
      currency: 'USD',
      timezone: 'America/Bogota',
      categories: [
        { id: 'cat-1', name: 'Comida' },
        { id: 'cat-2', name: 'Transporte' },
      ],
      geminiModel: 'gemini-test',
    });
    const differentCurrency = await buildReceiptScanHashes({
      image,
      locale: 'es',
      currency: 'COP',
      timezone: 'America/Bogota',
      categories: [
        { id: 'cat-1', name: 'Comida' },
        { id: 'cat-2', name: 'Transporte' },
      ],
      geminiModel: 'gemini-test',
    });

    expect(first.imageHash).toBe(second.imageHash);
    expect(first.processingKey).toBe(second.processingKey);
    expect(first.normalizedCategories).toEqual([
      { id: 'cat-1', name: 'Comida' },
      { id: 'cat-2', name: 'Transporte' },
    ]);
    expect(differentCurrency.processingKey).not.toBe(first.processingKey);
  });

  test('normalizes OCR item words without altering pure amounts', () => {
    expect(normalizeOcrWord('b0n')).toBe('bon');
    expect(normalizeOcrWord('ga5eosa')).toBe('gaseosa');
    expect(normalizeOcrWord('5000')).toBe('5000');
  });

  test('extracts a stable receipt OCR fingerprint and cleaned Gemini text', () => {
    const prepared = extractReceiptCacheDocument([
      'SUPERMERCADO XYZ',
      'B0N PAN 1230',
      'JUG0 NARANJA 2300',
      'TOTAL 3530',
    ].join('\n'));

    expect(prepared.itemTextsSorted).toEqual(['bon pan', 'jugo naranja']);
    expect(prepared.itemAmountsSorted).toEqual(['1230', '2300']);
    expect(prepared.totalAmount).toBe('3530');
    expect(prepared.cleanedText).toContain('supermercado xyz');
    expect(prepared.cleanedText).toContain('b0n pan 1230');
  });

  test('filters metadata and picks the real total from OCR-like hardware store receipts', () => {
    const prepared = extractReceiptCacheDocument([
      'FERRETERIA NUEVO OCCIDENTE',
      'NIT 71717893 7',
      'CLL 65A NRO 105 47 BLOQ 2 APT 9705',
      'TELEFONO 6045782284',
      '27 03 2026 04 15 PM',
      'CAJERO ADMINISTRADOR DE LA TIENDA',
      'CANT DESCRIPCION PRECIO IMPORTE',
      '6 CANTONERA 60X 800 00 4 800 00',
      '12 CHAZO 5 16 P 100 00 1 200 00',
      '12 TORNILLO ENS 100 00 1 200 00',
      '12 TORNILLO 1 EN 50 00 600 00',
      '1 BROCA 5 16 C 8 000 00 8 000 00',
      'NO DE ARTICULOS 43',
      'TOTAL 15 800 00',
      'PAGO CON 50 000 00',
      'SU CAMBIO 34 200 00',
    ].join('\n'));

    expect(prepared.totalAmount).toBe('15800');
    expect(prepared.itemLines).toHaveLength(5);
    expect(prepared.itemTextsSorted).toEqual([
      'broca c',
      'cantonera 6ox',
      'chazo p',
      'tornillo en',
      'tornillo ens',
    ]);
    expect(prepared.canonicalText).not.toContain('cll');
    expect(prepared.canonicalText).not.toContain('telefono');
    expect(prepared.canonicalText).not.toContain('pago');
  });

  test('keeps single-word items distinct when totals are the same', () => {
    const coffee = extractReceiptCacheDocument([
      'CAFE 4100',
      'TOTAL 4100',
    ].join('\n'));
    const water = extractReceiptCacheDocument([
      'AGUA 4100',
      'TOTAL 4100',
    ].join('\n'));

    expect(coffee.itemTextsSorted).toEqual(['cafe']);
    expect(water.itemTextsSorted).toEqual(['agua']);
    expect(coffee.exactFingerprint).not.toBe(water.exactFingerprint);
  });

  test('parses split decimals and thousand separators from OCR-normalized amounts', () => {
    expect(extractReceiptCacheDocument('CAFE 12.50\nTOTAL 12.50').totalAmount).toBe('12.50');
    expect(extractReceiptCacheDocument('COCA 3.500\nTOTAL 3.500').totalAmount).toBe('3500');
    expect(extractReceiptCacheDocument('TOTAL 1.230').totalAmount).toBe('1230');
  });

  test('rejects invoice metadata lines as items even when they contain mixed tokens and numbers', () => {
    const prepared = extractReceiptCacheDocument([
      'FACTURA A001 1234',
      'ORDEN 9988',
      'CLIENTE 12345',
      'CAFE 4100',
      'TOTAL 4100',
    ].join('\n'));

    expect(prepared.itemTextsSorted).toEqual(['cafe']);
    expect(prepared.canonicalText).not.toContain('factura');
    expect(prepared.canonicalText).not.toContain('orden');
  });

  test('isolates receipt OCR cache context by normalized parsing inputs', async () => {
    const first = await buildReceiptOcrCacheContext({
      locale: ' es ',
      currency: 'usd',
      timezone: 'America/Bogota',
      categories: [
        { id: 'cat-2', name: 'Transporte' },
        { id: 'cat-1', name: 'Comida' },
      ],
      geminiModel: 'gemini-test',
    });
    const second = await buildReceiptOcrCacheContext({
      locale: 'es',
      currency: 'USD',
      timezone: 'America/Bogota',
      categories: [
        { id: 'cat-1', name: 'Comida' },
        { id: 'cat-2', name: 'Transporte' },
      ],
      geminiModel: 'gemini-test',
    });
    const differentCurrency = await buildReceiptOcrCacheContext({
      locale: 'es',
      currency: 'COP',
      timezone: 'America/Bogota',
      categories: [
        { id: 'cat-1', name: 'Comida' },
        { id: 'cat-2', name: 'Transporte' },
      ],
      geminiModel: 'gemini-test',
    });

    expect(first.contextHash).toBe(second.contextHash);
    expect(differentCurrency.contextHash).not.toBe(first.contextHash);
  });

  test('returns a fuzzy hit only when text is similar and numbers match exactly', async () => {
    const store = new MemoryExtractionStore();
    const cache = new FuzzyExtractionCache<JsonObject>({
      store,
      payloadCodec: {
        serialize: (payload) => payload,
        deserialize: (payload) => (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as JsonObject : null),
      },
      textThreshold: 0.74,
      maxCandidates: 20,
      algorithmVersion: 'test-v1',
      payloadSchemaVersion: 'payload-v1',
    });
    const context = 'context-1';
    const storedPrepared = extractReceiptCacheDocument([
      'JUGO NARANJA 1200',
      'PAN INTEGRAL 2300',
      'TOTAL 3500',
    ].join('\n'));
    const queryPrepared = extractReceiptCacheDocument([
      'JUGO NARANGA 1200',
      'PAN INTEGRAL 2300',
      'TOTAL 3500',
    ].join('\n'));

    await cache.storePrepared(storedPrepared, context, { amount: 35, warnings: [] });

    const hit = await cache.lookupPrepared(queryPrepared, context);
    expect(hit.decision).toBe('fuzzy_hit');
    expect(hit.payload).toEqual({ amount: 35, warnings: [] });

    const miss = await cache.lookupPrepared(extractReceiptCacheDocument([
      'JUGO NARANGA 1200',
      'PAN INTEGRAL 2400',
      'TOTAL 3600',
    ].join('\n')), context);
    expect(miss.decision).toBe('miss');
  });

  test('does not reuse fuzzy cache entries across different single-item receipts with the same total', async () => {
    const store = new MemoryExtractionStore();
    const cache = new FuzzyExtractionCache<JsonObject>({
      store,
      payloadCodec: {
        serialize: (payload) => payload,
        deserialize: (payload) => (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as JsonObject : null),
      },
      textThreshold: 0.74,
      maxCandidates: 20,
      algorithmVersion: 'test-v1',
      payloadSchemaVersion: 'payload-v1',
    });

    await cache.storePrepared(extractReceiptCacheDocument('CAFE 4100\nTOTAL 4100'), 'ctx', { amount: 41, warnings: [] });
    const result = await cache.lookupPrepared(extractReceiptCacheDocument('AGUA 4100\nTOTAL 4100'), 'ctx');

    expect(result.decision).toBe('miss');
  });
});

class MemoryExtractionStore implements ExtractionCacheStore {
  private readonly entries = new Map<string, string>();
  private readonly markers = new Set<string>();

  async getExact(contextHash: string, exactHash: string) {
    const value = this.entries.get(`${contextHash}:${exactHash}`);
    return value ? JSON.parse(value) : null;
  }

  async listByNumbersSignature(contextHash: string, numbersSignatureHash: string, limit: number) {
    const prefix = `${contextHash}:${numbersSignatureHash}:`;
    const matches = Array.from(this.markers)
      .filter((marker) => marker.startsWith(prefix))
      .slice(0, limit)
      .map((marker) => marker.slice(prefix.length));

    const entries = await Promise.all(matches.map((exactHash) => this.getExact(contextHash, exactHash)));
    return entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }

  async putEntry(contextHash: string, numbersSignatureHash: string, entry: StoredExtractionCacheEntry) {
    this.entries.set(`${contextHash}:${entry.exactHash}`, JSON.stringify(entry));
    this.markers.add(`${contextHash}:${numbersSignatureHash}:${entry.exactHash}`);
  }
}
