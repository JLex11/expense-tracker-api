import { z } from 'zod';
import type { CloudflareBindings } from './types';

export type ParsedReceiptData = {
  amount?: number | null;
  date?: string | null;
  merchant?: string | null;
  currency?: string | null;
  paymentMethod?: 'cash' | 'card' | 'transfer' | 'unknown' | null;
  categoryId?: string | null;
  categoryName?: string | null;
  note?: string | null;
  confidence?: number | null;
  warnings?: string[];
};

export type ReceiptCategoryOption = {
  id: string;
  name: string;
};

const parsedReceiptSchema = z.object({
  amount: z.number().nonnegative().nullable().optional(),
  date: z.string().nullable().optional(),
  merchant: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  paymentMethod: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  categoryName: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  warnings: z.array(z.string()).optional(),
}).passthrough();

type VisionResponse = {
  responses?: Array<{
    fullTextAnnotation?: { text?: string };
    textAnnotations?: Array<{ description?: string }>;
    error?: { message?: string };
  }>;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
};

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function extractReceiptText(image: ArrayBuffer, env: CloudflareBindings) {
  const location = (env.GOOGLE_VISION_LOCATION ?? 'global').toLowerCase();
  const endpoint = location === 'global'
    ? 'https://vision.googleapis.com/v1/images:annotate'
    : `https://${location}-vision.googleapis.com/v1/images:annotate`;

  const response = await fetch(`${endpoint}?key=${encodeURIComponent(env.GOOGLE_VISION_API_KEY)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          image: { content: arrayBufferToBase64(image) },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        },
      ],
    }),
  });

  const payload = await response.json() as VisionResponse;
  const result = payload.responses?.[0];
  if (!response.ok || result?.error) {
    throw new Error(result?.error?.message || 'No se pudo leer la factura');
  }

  const text = result?.fullTextAnnotation?.text || result?.textAnnotations?.[0]?.description || '';
  if (!text.trim()) {
    throw new Error('No se pudo leer la factura');
  }

  return text;
}

export function normalizeParsedReceipt(
  input: unknown,
  fallbackCurrency: string,
  categories: ReceiptCategoryOption[] = [],
): ParsedReceiptData {
  const parsed = parsedReceiptSchema.safeParse(input);
  const data = parsed.success ? parsed.data : {};

  const paymentMethod = normalizePaymentMethod(data.paymentMethod);
  const normalizedDate = data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : null;
  const confidence = typeof data.confidence === 'number'
    ? Math.max(0, Math.min(1, data.confidence))
    : null;
  const merchant = cleanNullableString(data.merchant);
  const note = cleanNullableString(data.note) || merchant;
  const matchedCategory = resolveCategorySelection(categories, data.categoryId);

  return {
    amount: typeof data.amount === 'number' ? data.amount : null,
    date: normalizedDate,
    merchant,
    currency: (cleanNullableString(data.currency) || fallbackCurrency).toUpperCase(),
    paymentMethod,
    categoryId: matchedCategory?.id ?? null,
    categoryName: matchedCategory?.name ?? null,
    note,
    confidence,
    warnings: Array.isArray(data.warnings) ? data.warnings.filter((warning) => warning.trim().length > 0) : [],
  };
}

function cleanNullableString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizePaymentMethod(value: unknown): ParsedReceiptData['paymentMethod'] {
  if (value === 'cash' || value === 'card' || value === 'transfer' || value === 'unknown') {
    return value;
  }

  return null;
}

function resolveCategorySelection(categories: ReceiptCategoryOption[], selectedId: unknown) {
  if (typeof selectedId !== 'string' || selectedId.trim().length === 0) {
    return null;
  }

  return categories.find((category) => category.id === selectedId.trim()) ?? null;
}

export function buildGeminiReceiptPayload(
  rawText: string,
  options: { locale: string; currency: string; timezone: string; categories: ReceiptCategoryOption[] },
) {
  const categoryInstructions = options.categories.length > 0
    ? [
        'Elige la categoria mas probable usando el contexto de la compra, el comercio y los items del OCR.',
        'Solo puedes elegir una categoria de la lista.',
        'Prefiere devolver la mejor candidata aunque no sea perfecta, porque esto se usa como borrador.',
        'Solo devuelve categoryId=null y categoryName=null cuando ninguna categoria sea una candidata razonable.',
        `Categorias disponibles: ${JSON.stringify(options.categories)}`,
      ].join('\n')
    : 'No hay categorias disponibles. Devuelve categoryId=null y categoryName=null.';

  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [
              'Extrae informacion de gasto desde este OCR de factura.',
              `Locale: ${options.locale}`,
              `Currency preferida: ${options.currency}`,
              `Timezone: ${options.timezone}`,
              categoryInstructions,
              'Devuelve solo JSON que cumpla el schema.',
              rawText,
            ].join('\n\n'),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        properties: {
          amount: { type: ['number', 'null'] },
          date: { type: ['string', 'null'] },
          merchant: { type: ['string', 'null'] },
          currency: { type: ['string', 'null'] },
          paymentMethod: { type: ['string', 'null'], enum: ['cash', 'card', 'transfer', 'unknown', null] },
          categoryId: { type: ['string', 'null'] },
          categoryName: { type: ['string', 'null'] },
          note: { type: ['string', 'null'] },
          confidence: { type: ['number', 'null'] },
          warnings: { type: 'array', items: { type: 'string' } },
        },
        required: ['warnings'],
      },
    },
  };
}

export async function parseReceiptText(
  rawText: string,
  env: CloudflareBindings,
  options: { locale: string; currency: string; timezone: string; categories: ReceiptCategoryOption[] },
) {
  const model = encodeURIComponent(env.GEMINI_MODEL || 'gemini-2.5-flash-lite');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildGeminiReceiptPayload(rawText, options)),
  });

  const payload = await response.json() as GeminiResponse;
  const text = payload.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text;
  if (!response.ok || !text) {
    throw new Error(payload.error?.message || 'No se pudo interpretar la factura');
  }

  return normalizeParsedReceipt(JSON.parse(text), options.currency, options.categories);
}
