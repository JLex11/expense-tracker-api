export interface CloudflareBindings {
  DB: D1Database;
  JWT_SECRET: string;
  CORS_ORIGIN?: string;
  RECEIPT_IMAGES: R2Bucket;
  RECEIPT_SCAN_QUEUE: Queue<ReceiptScanQueueMessage>;
  RECEIPT_FUZZY_CACHE?: KVNamespace;
  GOOGLE_VISION_API_KEY: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
  GOOGLE_VISION_LOCATION?: string;
}

export interface JWTPayload {
  id: string;
  email: string;
}

export interface ReceiptScanQueueMessage {
  scanId: string;
}
