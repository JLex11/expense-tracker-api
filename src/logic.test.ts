import { describe, expect, test } from 'bun:test';
import { advanceRecurringDate, normalizeRecurringIntervalUnit } from './recurring';
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
