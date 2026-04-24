import type { ParsedReceiptData, ReceiptCategoryOption } from './receipt-ai';
import { normalizeCategoriesForCache, normalizeReceiptLocale } from './receipt-scan-cache';
import {
  CloudflareKvExtractionCacheStore,
  FuzzyExtractionCache,
  sha256Hex,
  trigrams,
  type ExtractionPayloadCodec,
  type JsonObject,
  type PreparedExtractionDocument,
} from './extraction-cache';

const defaultGeminiModel = 'gemini-2.5-flash-lite';
const receiptOcrCacheContextVersion = 'receipt-ocr-context-v1';
const receiptOcrCacheAlgorithmVersion = 'receipt-ocr-fuzzy-v2';
const receiptOcrPayloadSchemaVersion = 'receipt-parsed-v1';

const NOISE_PREFIXES = new Set([
  'nit',
  'nif',
  'rut',
  'cuit',
  'fecha',
  'hora',
  'cajero',
  'caja',
  'cliente',
  'factura',
  'orden',
  'documento',
  'direccion',
  'telefono',
  'tel',
  'resolucion',
  'autorizacion',
  'aprobacion',
  'transaccion',
  'vendedor',
  'tarjeta',
  'efectivo',
  'cambio',
  'pago',
  'dian',
]);

const TOTAL_KEYWORDS = new Set(['total', 'subtotal', 'saldo', 'importe']);
const PAYMENT_WORDS = new Set(['efectivo', 'cambio', 'tarjeta', 'pago', 'pagado', 'recibido']);
const ADDRESS_WORDS = new Set([
  'cll',
  'calle',
  'cra',
  'carrera',
  'kr',
  'nro',
  'no',
  'num',
  'bloque',
  'bloq',
  'apt',
  'apto',
  'apartamento',
  'torre',
  'barrio',
  'manzana',
  'mz',
  'interior',
  'int',
  'local',
  'oficina',
]);
const META_WORDS = new Set([
  'telefono',
  'whatsapp',
  'folio',
  'turno',
  'cajero',
  'administrador',
  'cliente',
  'factura',
  'orden',
  'pedido',
  'codigo',
  'gracias',
  'devolvemos',
  'recibo',
  'articulos',
  'articulo',
  'compra',
]);
const HEADER_WORDS = new Set(['cant', 'descripcion', 'precio', 'importe', 'codigo', 'producto']);
const STRONG_TOTAL_WORDS = new Set(['total']);

const COMBINING_MARKS_RE = /\p{M}/gu;
const NON_ALNUM_SPACE_RE = /[^a-z0-9\s]/g;
const MULTISPACE_RE = /\s+/g;
const ALPHA_RE = /[a-z]+/g;
const ONLY_DIGITS_SPACES_DATES_RE = /^[\d\s:/-]+$/;
const DATETIME_TOKEN_RE = /\b\d{2}[:/-]\d{2}([:/-]\d{2,4})?\b/;
const DIGITS_ONLY_RE = /^\d+$/;
const HAS_ALPHA_RE = /[a-z]/;
const HAS_DIGIT_RE = /\d/;
const DIGITS_TOKEN_RE = /^\d+$/;
const LINE_SPLIT_RE = /\r?\n/;

export interface ReceiptOcrCacheContextInput {
  locale: string;
  currency: string;
  timezone: string;
  categories: ReceiptCategoryOption[];
  geminiModel?: string;
}

export interface ReceiptOcrCacheContext {
  contextHash: string;
  normalizedLocale: string;
  normalizedCurrency: string;
  normalizedTimezone: string;
  normalizedCategories: ReceiptCategoryOption[];
  geminiModel: string;
  contextVersion: string;
  algorithmVersion: string;
  payloadSchemaVersion: string;
}

export interface PreparedReceiptOcrDocument extends PreparedExtractionDocument {
  normalizedLines: string[];
  itemLines: string[];
  itemTextsSorted: string[];
}

const parsedReceiptCodec: ExtractionPayloadCodec<JsonObject> = {
  serialize(payload) {
    return payload;
  },
  deserialize(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as JsonObject;
  },
};

export async function buildReceiptOcrCacheContext(
  input: ReceiptOcrCacheContextInput,
): Promise<ReceiptOcrCacheContext> {
  const normalizedLocale = normalizeReceiptLocale(input.locale);
  const normalizedCurrency = input.currency.trim().toUpperCase();
  const normalizedTimezone = input.timezone.trim();
  const normalizedCategories = normalizeCategoriesForCache(input.categories);
  const geminiModel = input.geminiModel?.trim() || defaultGeminiModel;

  const contextHash = await sha256Hex(JSON.stringify({
    locale: normalizedLocale,
    currency: normalizedCurrency,
    timezone: normalizedTimezone,
    categories: normalizedCategories,
    geminiModel,
    contextVersion: receiptOcrCacheContextVersion,
    algorithmVersion: receiptOcrCacheAlgorithmVersion,
    payloadSchemaVersion: receiptOcrPayloadSchemaVersion,
  }));

  return {
    contextHash,
    normalizedLocale,
    normalizedCurrency,
    normalizedTimezone,
    normalizedCategories,
    geminiModel,
    contextVersion: receiptOcrCacheContextVersion,
    algorithmVersion: receiptOcrCacheAlgorithmVersion,
    payloadSchemaVersion: receiptOcrPayloadSchemaVersion,
  };
}

export function createReceiptOcrCache(kv: KVNamespace) {
  return new FuzzyExtractionCache<JsonObject>({
    store: new CloudflareKvExtractionCacheStore(kv, {
      keyPrefix: 'receipt-ocr-cache:v1',
      ttlSeconds: 60 * 60 * 24 * 90,
    }),
    payloadCodec: parsedReceiptCodec,
    algorithmVersion: receiptOcrCacheAlgorithmVersion,
    payloadSchemaVersion: receiptOcrPayloadSchemaVersion,
    textThreshold: 0.74,
    maxCandidates: 50,
  });
}

export function extractReceiptCacheDocument(rawOcr: string): PreparedReceiptOcrDocument {
  const normalizedLines: string[] = [];
  const rawLines = rawOcr.split(LINE_SPLIT_RE);

  for (const rawLine of rawLines) {
    const normalized = normalizeText(rawLine);
    if (normalized) {
      normalizedLines.push(normalized);
    }
  }

  const itemLines: string[] = [];
  const totalLine = pickBestTotalLine(normalizedLines);

  for (const line of normalizedLines) {
    if (line === totalLine) {
      continue;
    }

    const amounts = extractMonetaryValues(line);
    if (looksLikeItemLine(line, amounts)) {
      itemLines.push(line);
    }
  }

  const itemTexts: string[] = [];
  const itemAmounts: string[] = [];

  for (const line of itemLines) {
    const amounts = extractMonetaryValues(line);
    for (const amount of amounts) {
      itemAmounts.push(amount);
    }

    const textWithoutAmounts = line
      .split(' ')
      .filter((token) => !DIGITS_TOKEN_RE.test(token))
      .join(' ')
      .replace(MULTISPACE_RE, ' ')
      .trim();
    const normalizedItemText = normalizeItemTextOcrAware(textWithoutAmounts);

    if (normalizedItemText) {
      itemTexts.push(normalizedItemText);
    }
  }

  let totalAmount: string | null = null;
  if (totalLine) {
    const totals = extractMonetaryValues(totalLine);
    if (totals.length > 0) {
      totalAmount = pickLargestAmount(totals);
    }
  }

  const itemTextsSorted = [...itemTexts].sort();
  const itemAmountsSorted = [...itemAmounts].sort();
  const canonicalText = itemTextsSorted.join(' | ');
  const exactFingerprint = `${canonicalText} ## ${itemAmountsSorted.join('|')} ## ${totalAmount ?? ''}`;

  return {
    normalizedLines,
    itemLines,
    itemTextsSorted,
    cleanedText: buildCleanedGeminiInput(normalizedLines),
    canonicalText,
    exactFingerprint,
    trigramArray: Array.from(trigrams(canonicalText)),
    itemAmountsSorted,
    totalAmount,
    numbersSignature: `${itemAmountsSorted.join('|')}##${totalAmount ?? ''}`,
  };
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS_RE, '')
    .replace(NON_ALNUM_SPACE_RE, ' ')
    .replace(MULTISPACE_RE, ' ')
    .trim();
}

export function normalizeItemTextOcrAware(text: string): string {
  const words = text.split(' ');
  for (let index = 0; index < words.length; index += 1) {
    words[index] = normalizeOcrWord(words[index]);
  }

  return words.join(' ').trim();
}

export function normalizeOcrWord(word: string): string {
  if (DIGITS_ONLY_RE.test(word)) {
    return word;
  }

  const chars = Array.from(word);
  let hasAlpha = false;
  for (const char of chars) {
    if (char >= 'a' && char <= 'z') {
      hasAlpha = true;
      break;
    }
  }

  if (!hasAlpha) {
    return word;
  }

  let out = '';
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const prev = index > 0 ? chars[index - 1] : '';
    const next = index + 1 < chars.length ? chars[index + 1] : '';
    const nearLetters = (prev >= 'a' && prev <= 'z') || (next >= 'a' && next <= 'z');

    if (nearLetters) {
      if (char === '0') {
        out += 'o';
        continue;
      }

      if (char === '1') {
        out += 'i';
        continue;
      }

      if (char === '5') {
        out += 's';
        continue;
      }

      if (char === '8') {
        out += 'b';
        continue;
      }
    }

    out += char;
  }

  return out;
}

function buildCleanedGeminiInput(lines: string[]): string {
  const cleaned: string[] = [];

  for (const line of lines) {
    if (cleaned[cleaned.length - 1] !== line) {
      cleaned.push(line);
    }
  }

  return cleaned.join('\n');
}

function extractMonetaryValues(line: string): string[] {
  const tokens = line.split(' ').filter(Boolean);
  const values: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!DIGITS_TOKEN_RE.test(token)) {
      continue;
    }

    if (token.length >= 4) {
      values.push(stripLeadingZeros(token));
      continue;
    }

    const parsed = parseSpacedAmount(tokens, index);
    if (!parsed) {
      continue;
    }

    values.push(parsed.value);
    index = parsed.lastIndex;
  }

  return values.filter(Boolean);
}

function firstToken(line: string): string {
  const spaceIndex = line.indexOf(' ');
  return spaceIndex === -1 ? line : line.slice(0, spaceIndex);
}

function hasAnyToken(line: string, dictionary: Set<string>): boolean {
  let start = 0;
  for (let index = 0; index <= line.length; index += 1) {
    if (index === line.length || line.charCodeAt(index) === 32) {
      if (index > start && dictionary.has(line.slice(start, index))) {
        return true;
      }

      start = index + 1;
    }
  }

  return false;
}

function isTotalLine(line: string, amounts = extractMonetaryValues(line)): boolean {
  return amounts.length > 0 && hasAnyToken(line, TOTAL_KEYWORDS) && !hasPaymentWord(alphaTokens(line));
}

function startsWithNoisePrefix(line: string): boolean {
  return line.length > 0 && NOISE_PREFIXES.has(firstToken(line));
}

function isDatetimeOrReference(line: string): boolean {
  if (ONLY_DIGITS_SPACES_DATES_RE.test(line) || DATETIME_TOKEN_RE.test(line)) {
    return true;
  }

  const tokens = line.split(' ').filter(Boolean);
  if (tokens.length >= 4 && tokens.every((token) => DIGITS_TOKEN_RE.test(token) || token === 'am' || token === 'pm')) {
    return true;
  }

  return false;
}

function alphaTokens(line: string): string[] {
  return line.match(ALPHA_RE) ?? [];
}

function hasPaymentWord(words: string[]): boolean {
  for (let index = 0; index < words.length; index += 1) {
    if (PAYMENT_WORDS.has(words[index])) {
      return true;
    }
  }

  return false;
}

function hasMixedAlphaNumericToken(line: string): boolean {
  let start = 0;
  for (let index = 0; index <= line.length; index += 1) {
    if (index === line.length || line.charCodeAt(index) === 32) {
      if (index > start) {
        const token = line.slice(start, index);
        if (HAS_ALPHA_RE.test(token) && HAS_DIGIT_RE.test(token)) {
          return true;
        }
      }

      start = index + 1;
    }
  }

  return false;
}

function looksLikeItemLine(line: string, amounts = extractMonetaryValues(line)): boolean {
  if (isTotalLine(line, amounts)) {
    return false;
  }

  if (isDatetimeOrReference(line)) {
    return false;
  }

  if (amounts.length === 0) {
    return false;
  }

  const words = alphaTokens(line);
  if (words.length === 0) {
    return false;
  }

  if (hasPaymentWord(words)) {
    return false;
  }

  if (startsWithNoisePrefix(line)) {
    return false;
  }

  if (containsAnyWord(words, ADDRESS_WORDS) || containsAnyWord(words, META_WORDS) || containsAnyWord(words, HEADER_WORDS)) {
    return false;
  }

  if (line.startsWith('no de articulos')) {
    return false;
  }

  let score = 0;
  if (startsWithQuantity(line)) {
    score += 2;
  }
  if (amounts.length >= 1 && amounts.length <= 2) {
    score += 2;
  } else if (amounts.length >= 3) {
    score -= 2;
  }
  if (words.length >= 1 && words.length <= 6) {
    score += 2;
  } else if (words.length > 8) {
    score -= 2;
  }
  if (hasMixedAlphaNumericToken(line)) {
    score += 1;
  }
  if (containsLikelyProductWord(words)) {
    score += 1;
  }
  if (containsAnyWord(words, TOTAL_KEYWORDS)) {
    score -= 3;
  }

  return score >= 3;
}

function pickBestTotalLine(lines: string[]): string | null {
  let bestLine: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const amounts = extractMonetaryValues(line);
    if (amounts.length === 0) {
      continue;
    }

    const words = alphaTokens(line);
    if (!containsAnyWord(words, TOTAL_KEYWORDS)) {
      continue;
    }

    if (hasPaymentWord(words)) {
      continue;
    }

    let score = 0;
    if (containsAnyWord(words, STRONG_TOTAL_WORDS)) {
      score += 8;
    }
    if (line.startsWith('total')) {
      score += 4;
    }
    if (containsAnyWord(words, ADDRESS_WORDS) || containsAnyWord(words, META_WORDS)) {
      score -= 5;
    }
    score += Math.min(index, 20);
    score += normalizeAmountMagnitude(pickLargestAmount(amounts));

    if (score > bestScore) {
      bestScore = score;
      bestLine = line;
    }
  }

  return bestLine;
}

function containsAnyWord(words: string[], dictionary: Set<string>): boolean {
  for (let index = 0; index < words.length; index += 1) {
    if (dictionary.has(words[index])) {
      return true;
    }
  }

  return false;
}

function containsLikelyProductWord(words: string[]): boolean {
  let useful = 0;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (
      !NOISE_PREFIXES.has(word)
      && !PAYMENT_WORDS.has(word)
      && !ADDRESS_WORDS.has(word)
      && !META_WORDS.has(word)
      && !HEADER_WORDS.has(word)
      && !TOTAL_KEYWORDS.has(word)
    ) {
      useful += 1;
    }
  }

  return useful >= 1;
}

function startsWithQuantity(line: string): boolean {
  const token = firstToken(line);
  if (!DIGITS_TOKEN_RE.test(token)) {
    return false;
  }

  const quantity = Number(token);
  return Number.isFinite(quantity) && quantity >= 1 && quantity <= 999;
}

function parseSpacedAmount(tokens: string[], startIndex: number): { value: string; lastIndex: number } | null {
  const first = tokens[startIndex];
  if (!DIGITS_TOKEN_RE.test(first) || first.length > 3) {
    return null;
  }

  let index = startIndex + 1;
  const integerGroups = [first];
  let hasGroupedThousands = false;
  let cents: string | null = null;

  while (index < tokens.length && DIGITS_TOKEN_RE.test(tokens[index]) && tokens[index].length === 3) {
    integerGroups.push(tokens[index]);
    hasGroupedThousands = true;
    index += 1;
  }

  let hasCents = false;
  if (index < tokens.length && DIGITS_TOKEN_RE.test(tokens[index]) && tokens[index].length === 2) {
    hasCents = true;
    cents = tokens[index];
    index += 1;
  }

  if (!hasGroupedThousands && !(first.length === 3 && hasCents) && !looksLikeSplitDecimal(tokens, startIndex, hasCents)) {
    return null;
  }

  const integerPart = stripLeadingZeros(integerGroups.join(''));
  return {
    value: cents && cents !== '00' ? `${integerPart}.${cents}` : integerPart,
    lastIndex: index - 1,
  };
}

function looksLikeSplitDecimal(tokens: string[], startIndex: number, hasCents: boolean): boolean {
  if (!hasCents) {
    return false;
  }

  const first = tokens[startIndex];
  if (first.length >= 2) {
    return true;
  }

  if (startIndex === 0) {
    return false;
  }

  const previous = tokens[startIndex - 1];
  return !DIGITS_TOKEN_RE.test(previous) && (
    STRONG_TOTAL_WORDS.has(previous)
    || TOTAL_KEYWORDS.has(previous)
    || PAYMENT_WORDS.has(previous)
  );
}

function stripLeadingZeros(value: string): string {
  const normalized = value.replace(/^0+(?=\d)/, '');
  return normalized.length > 0 ? normalized : '0';
}

function pickLargestAmount(amounts: string[]): string {
  let best = amounts[0] ?? '0';
  let bestValue = Number(best);

  for (let index = 1; index < amounts.length; index += 1) {
    const current = amounts[index];
    const currentValue = Number(current);
    if (currentValue > bestValue) {
      best = current;
      bestValue = currentValue;
    }
  }

  return best;
}

function normalizeAmountMagnitude(amount: string): number {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.min(Math.floor(Math.log10(Math.max(numeric, 1))), 6);
}

export function isParsedReceiptDataJson(value: unknown): value is ParsedReceiptData {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
