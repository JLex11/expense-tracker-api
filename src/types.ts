export interface CloudflareBindings {
  DB: D1Database;
  JWT_SECRET: string;
}

export interface JWTPayload {
  id: string;
  email: string;
}
