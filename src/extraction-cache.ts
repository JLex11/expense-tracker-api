export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ExtractionCacheDecision = 'exact_hit' | 'fuzzy_hit' | 'miss';

export interface PreparedExtractionDocument {
  cleanedText: string;
  canonicalText: string;
  exactFingerprint: string;
  trigramArray: string[];
  itemAmountsSorted: string[];
  totalAmount: string | null;
  numbersSignature: string;
}

export interface StoredExtractionCacheEntry {
  exactHash: string;
  canonicalText: string;
  trigramArray: string[];
  itemAmountsSorted: string[];
  totalAmount: string | null;
  numbersSignature: string;
  payload: JsonValue;
  createdAt: number;
  algorithmVersion: string;
  payloadSchemaVersion: string;
}

export interface ExtractionCacheStore {
  getExact(contextHash: string, exactHash: string): Promise<StoredExtractionCacheEntry | null>;
  listByNumbersSignature(
    contextHash: string,
    numbersSignatureHash: string,
    limit: number,
  ): Promise<StoredExtractionCacheEntry[]>;
  putEntry(
    contextHash: string,
    numbersSignatureHash: string,
    entry: StoredExtractionCacheEntry,
  ): Promise<void>;
}

export interface ExtractionPayloadCodec<TPayload extends JsonValue> {
  serialize(payload: TPayload): JsonValue;
  deserialize(value: JsonValue): TPayload | null;
}

export interface ExtractionCacheLookupResult<TPayload extends JsonValue> {
  decision: ExtractionCacheDecision;
  payload: TPayload | null;
  analyzed: PreparedExtractionDocument;
  textSimilarity: number;
  matchedExactHash: string | null;
}

interface FuzzyExtractionCacheOptions<TPayload extends JsonValue> {
  store: ExtractionCacheStore;
  payloadCodec: ExtractionPayloadCodec<TPayload>;
  textThreshold?: number;
  maxCandidates?: number;
  algorithmVersion: string;
  payloadSchemaVersion: string;
}

export class FuzzyExtractionCache<TPayload extends JsonValue> {
  private readonly textThreshold: number;
  private readonly maxCandidates: number;

  constructor(private readonly options: FuzzyExtractionCacheOptions<TPayload>) {
    this.textThreshold = options.textThreshold ?? 0.74;
    this.maxCandidates = options.maxCandidates ?? 50;
  }

  async lookupPrepared(
    prepared: PreparedExtractionDocument,
    contextHash: string,
  ): Promise<ExtractionCacheLookupResult<TPayload>> {
    const exactHash = await sha256Hex(prepared.exactFingerprint);
    const exactEntry = await this.options.store.getExact(contextHash, exactHash);
    const decodedExactPayload = exactEntry ? this.options.payloadCodec.deserialize(exactEntry.payload) : null;

    if (exactEntry && decodedExactPayload !== null) {
      return {
        decision: 'exact_hit',
        payload: decodedExactPayload,
        analyzed: prepared,
        textSimilarity: 1,
        matchedExactHash: exactHash,
      };
    }

    if (prepared.canonicalText.length === 0) {
      return {
        decision: 'miss',
        payload: null,
        analyzed: prepared,
        textSimilarity: 0,
        matchedExactHash: null,
      };
    }

    const numbersSignatureHash = await sha256Hex(prepared.numbersSignature);
    const candidates = await this.options.store.listByNumbersSignature(
      contextHash,
      numbersSignatureHash,
      this.maxCandidates,
    );

    let bestCandidate: StoredExtractionCacheEntry | null = null;
    let bestPayload: TPayload | null = null;
    let bestSimilarity = 0;

    const queryTrigrams = new Set(prepared.trigramArray);

    for (const candidate of candidates) {
      if (!sameStringArray(candidate.itemAmountsSorted, prepared.itemAmountsSorted)) {
        continue;
      }

      if (candidate.totalAmount !== prepared.totalAmount) {
        continue;
      }

      const decodedPayload = this.options.payloadCodec.deserialize(candidate.payload);
      if (decodedPayload === null) {
        continue;
      }

      const similarity = round4(jaccard(queryTrigrams, new Set(candidate.trigramArray)));
      if (bestCandidate === null || similarity > bestSimilarity) {
        bestCandidate = candidate;
        bestPayload = decodedPayload;
        bestSimilarity = similarity;
      }
    }

    if (bestCandidate && bestPayload !== null && bestSimilarity >= this.textThreshold) {
      return {
        decision: 'fuzzy_hit',
        payload: bestPayload,
        analyzed: prepared,
        textSimilarity: bestSimilarity,
        matchedExactHash: bestCandidate.exactHash,
      };
    }

    return {
      decision: 'miss',
      payload: null,
      analyzed: prepared,
      textSimilarity: bestSimilarity,
      matchedExactHash: bestCandidate?.exactHash ?? null,
    };
  }

  async storePrepared(prepared: PreparedExtractionDocument, contextHash: string, payload: TPayload): Promise<void> {
    const exactHash = await sha256Hex(prepared.exactFingerprint);
    const numbersSignatureHash = await sha256Hex(prepared.numbersSignature);

    await this.options.store.putEntry(contextHash, numbersSignatureHash, {
      exactHash,
      canonicalText: prepared.canonicalText,
      trigramArray: prepared.trigramArray,
      itemAmountsSorted: [...prepared.itemAmountsSorted],
      totalAmount: prepared.totalAmount,
      numbersSignature: prepared.numbersSignature,
      payload: this.options.payloadCodec.serialize(payload),
      createdAt: Date.now(),
      algorithmVersion: this.options.algorithmVersion,
      payloadSchemaVersion: this.options.payloadSchemaVersion,
    });
  }
}

export interface CloudflareKvExtractionCacheStoreOptions {
  keyPrefix?: string;
  ttlSeconds?: number;
}

export class CloudflareKvExtractionCacheStore implements ExtractionCacheStore {
  private readonly keyPrefix: string;
  private readonly ttlSeconds?: number;

  constructor(
    private readonly kv: KVNamespace,
    options: CloudflareKvExtractionCacheStoreOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? 'receipt-ocr-cache:v1';
    this.ttlSeconds = options.ttlSeconds;
  }

  async getExact(contextHash: string, exactHash: string): Promise<StoredExtractionCacheEntry | null> {
    const value = await this.kv.get(this.entryKey(contextHash, exactHash), 'json');
    return isStoredExtractionCacheEntry(value) ? value : null;
  }

  async listByNumbersSignature(
    contextHash: string,
    numbersSignatureHash: string,
    limit: number,
  ): Promise<StoredExtractionCacheEntry[]> {
    const markerKeys = await this.kv.list({
      prefix: this.indexPrefix(contextHash, numbersSignatureHash),
      limit,
    });

    const entries = await Promise.all(
      markerKeys.keys.map((key) => this.getExact(contextHash, key.name.slice(key.name.lastIndexOf(':') + 1))),
    );

    return entries.filter((entry): entry is StoredExtractionCacheEntry => entry !== null);
  }

  async putEntry(
    contextHash: string,
    numbersSignatureHash: string,
    entry: StoredExtractionCacheEntry,
  ): Promise<void> {
    const options = this.ttlSeconds ? { expirationTtl: this.ttlSeconds } : undefined;

    await Promise.all([
      this.kv.put(this.entryKey(contextHash, entry.exactHash), JSON.stringify(entry), options),
      this.kv.put(this.indexKey(contextHash, numbersSignatureHash, entry.exactHash), '1', options),
    ]);
  }

  private entryKey(contextHash: string, exactHash: string): string {
    return `${this.keyPrefix}:entry:${contextHash}:${exactHash}`;
  }

  private indexPrefix(contextHash: string, numbersSignatureHash: string): string {
    return `${this.keyPrefix}:idx:${contextHash}:${numbersSignatureHash}:`;
  }

  private indexKey(contextHash: string, numbersSignatureHash: string, exactHash: string): string {
    return `${this.indexPrefix(contextHash, numbersSignatureHash)}${exactHash}`;
  }
}

export async function sha256Hex(value: string | ArrayBuffer | Uint8Array): Promise<string> {
  const input = typeof value === 'string'
    ? new TextEncoder().encode(value)
    : value instanceof Uint8Array
      ? value
      : new Uint8Array(value);
  const digest = await crypto.subtle.digest('SHA-256', input);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function trigrams(text: string): Set<string> {
  const padded = `  ${text}  `;
  if (padded.length < 3) {
    return new Set([padded]);
  }

  const out = new Set<string>();
  for (let index = 0; index < padded.length - 2; index += 1) {
    out.add(padded.slice(index, index + 3));
  }

  return out;
}

export function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }

  const smaller = left.size <= right.size ? left : right;
  const bigger = left.size <= right.size ? right : left;

  let intersection = 0;
  for (const value of smaller) {
    if (bigger.has(value)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function isStoredExtractionCacheEntry(value: unknown): value is StoredExtractionCacheEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<StoredExtractionCacheEntry>;
  return typeof candidate.exactHash === 'string'
    && typeof candidate.canonicalText === 'string'
    && Array.isArray(candidate.trigramArray)
    && Array.isArray(candidate.itemAmountsSorted)
    && typeof candidate.numbersSignature === 'string'
    && typeof candidate.createdAt === 'number'
    && typeof candidate.algorithmVersion === 'string'
    && typeof candidate.payloadSchemaVersion === 'string'
    && 'payload' in candidate;
}
