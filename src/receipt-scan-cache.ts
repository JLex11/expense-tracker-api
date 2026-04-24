import type { ReceiptCategoryOption } from './receipt-ai';

const defaultGeminiModel = 'gemini-2.5-flash-lite';

export const receiptScanCacheVersion = 'v1';

export function normalizeReceiptLocale(locale: string) {
  return locale.trim().slice(0, 12) || 'es';
}

export function normalizeCategoriesForCache(categories: ReceiptCategoryOption[]) {
  return categories
    .map((category) => ({
      id: category.id.trim(),
      name: category.name.trim(),
    }))
    .filter((category) => category.id.length > 0 && category.name.length > 0)
    .sort((left, right) => {
      const idComparison = left.id.localeCompare(right.id);
      if (idComparison !== 0) {
        return idComparison;
      }

      return left.name.localeCompare(right.name);
    });
}

export async function buildReceiptScanHashes(input: {
  image: ArrayBuffer;
  locale: string;
  currency: string;
  timezone: string;
  categories: ReceiptCategoryOption[];
  geminiModel?: string;
  cacheVersion?: string;
}) {
  const normalizedLocale = normalizeReceiptLocale(input.locale);
  const normalizedCurrency = input.currency.trim().toUpperCase();
  const normalizedTimezone = input.timezone.trim();
  const normalizedCategories = normalizeCategoriesForCache(input.categories);
  const geminiModel = input.geminiModel?.trim() || defaultGeminiModel;
  const cacheVersion = input.cacheVersion ?? receiptScanCacheVersion;
  const imageHash = await sha256Hex(input.image);
  const processingKey = await sha256Hex(JSON.stringify({
    imageHash,
    locale: normalizedLocale,
    currency: normalizedCurrency,
    timezone: normalizedTimezone,
    categories: normalizedCategories,
    geminiModel,
    cacheVersion,
  }));

  return {
    imageHash,
    processingKey,
    normalizedLocale,
    normalizedCurrency,
    normalizedTimezone,
    normalizedCategories,
    geminiModel,
    cacheVersion,
  };
}

async function sha256Hex(value: ArrayBuffer | string) {
  const input = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  const digest = await crypto.subtle.digest('SHA-256', input);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
