export interface CloudflareBindings {
  DB: D1Database;
  JWT_SECRET: string;
  CORS_ORIGIN?: string;
}

export interface JWTPayload {
  id: string;
  email: string;
}
