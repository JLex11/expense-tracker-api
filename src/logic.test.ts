import { describe, expect, test } from 'bun:test';
import { advanceRecurringDate, normalizeRecurringIntervalUnit } from './recurring';
import { buildGeminiReceiptPayload, normalizeParsedReceipt } from './receipt-ai';
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
});
