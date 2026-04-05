export const recurringIntervalUnits = ['DAY', 'DAILY', 'WEEK', 'WEEKLY', 'MONTH', 'MONTHLY', 'YEAR', 'YEARLY'] as const;

const intervalUnitAliases = {
  DAY: 'DAY',
  DAILY: 'DAY',
  WEEK: 'WEEK',
  WEEKLY: 'WEEK',
  MONTH: 'MONTH',
  MONTHLY: 'MONTH',
  YEAR: 'YEAR',
  YEARLY: 'YEAR',
} as const;

export type RecurringIntervalUnit = (typeof intervalUnitAliases)[keyof typeof intervalUnitAliases];

export function normalizeRecurringIntervalUnit(unit: string): RecurringIntervalUnit | null {
  const normalizedUnit = intervalUnitAliases[unit.trim().toUpperCase() as keyof typeof intervalUnitAliases];
  return normalizedUnit ?? null;
}

export function advanceRecurringDate(timestamp: number, unit: string, value: number): number | null {
  const normalizedUnit = normalizeRecurringIntervalUnit(unit);
  if (!normalizedUnit || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  const nextDate = new Date(timestamp);

  switch (normalizedUnit) {
    case 'DAY':
      nextDate.setDate(nextDate.getDate() + value);
      break;
    case 'WEEK':
      nextDate.setDate(nextDate.getDate() + value * 7);
      break;
    case 'MONTH':
      nextDate.setMonth(nextDate.getMonth() + value);
      break;
    case 'YEAR':
      nextDate.setFullYear(nextDate.getFullYear() + value);
      break;
  }

  return nextDate.getTime();
}
