export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  KEYS: D1Database;
  BUCKET?: R2Bucket;

  LIMITER_FREE?: RateLimit;
  LIMITER_RESEARCH?: RateLimit;
  LIMITER_DASHBOARD?: RateLimit;
  LIMITER_SIGNUP?: RateLimit;
  LIMITER_ANON?: RateLimit;
  LIMITER_DEMO?: RateLimit;

  PUBLIC_URL: string;
  ORIGIN_URL: string;
  TURNSTILE_SITE_KEY: string;
  EMAIL_PROVIDER: string;
  EMAIL_FROM: string;
  CONTACT_EMAIL: string;
  DEMO_API_KEY: string;
  DEMO_BULK_YEARS: string; // comma-separated years the demo key may read as bulk files
  ALLOWED_ORIGINS: string;
  DEV_MODE: string;
  // "request": people email CONTACT_EMAIL and keys are issued from /admin. "email": self-serve magic links (needs EMAIL_PROVIDER).
  SIGNUP_MODE: string;

  // secrets
  ORIGIN_SECRET: string;
  ADMIN_SECRET: string;
  TURNSTILE_SECRET?: string;
  RESEND_API_KEY?: string;
}

export const isDev = (env: Env) => env.DEV_MODE === "true";
export const isRequestMode = (env: Env) => env.SIGNUP_MODE !== "email";
