import type { Env, RateLimit } from "./env";
import { isoNow, randomToken, sha256hex } from "./crypto";

export type Tier = "full" | "free" | "research" | "dashboard" | "admin" | "demo";
// "full": no rate limit, no row cap (the default for issued keys). The others exist for special cases,
// e.g. a "dashboard" key embedded in a public web page.
export const TIERS: Tier[] = ["full", "free", "research", "dashboard", "admin", "demo"];
export const DEFAULT_TIER: Tier = "full";
export const KEY_PREFIX = "aqi_";

export interface KeyRow {
  id: string;
  tier: Tier;
  owner_email: string;
  expires_at: string | null;
  revoked_at: string | null;
}

// Positive lookups are cached per isolate for a minute, so revocations take up to 60 s to bite.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { row: KeyRow; exp: number }>();

export function isValidTier(t: string): t is Tier {
  return (TIERS as string[]).includes(t);
}

export const DEMO_ROW: KeyRow = { id: "demo", tier: "demo", owner_email: "", expires_at: null, revoked_at: null };

export async function lookupKey(env: Env, key: string): Promise<KeyRow | null> {
  if (!key.startsWith(KEY_PREFIX) || key.length < 20 || key.length > 200) return null;
  // The public demo key lives in config, not D1, so rotating it is a one-line change.
  if (env.DEMO_API_KEY && key === env.DEMO_API_KEY) return DEMO_ROW;
  const hash = await sha256hex(key);
  const now = Date.now();
  const hit = cache.get(hash);
  if (hit && hit.exp > now) return hit.row;

  const row = await env.KEYS.prepare(
    "SELECT id, tier, owner_email, expires_at, revoked_at FROM api_keys WHERE key_hash = ?",
  ).bind(hash).first<KeyRow>();
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && row.expires_at < isoNow()) return null;
  cache.set(hash, { row, exp: now + CACHE_TTL_MS });
  return row;
}

export async function issueKey(env: Env, email: string, tier: Tier, note: string | null, expiresAt: string | null): Promise<{ id: string; key: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = KEY_PREFIX + randomToken(32);
    const id = key.slice(KEY_PREFIX.length, KEY_PREFIX.length + 8);
    const hash = await sha256hex(key);
    try {
      await env.KEYS.prepare(
        "INSERT INTO api_keys (id, key_hash, owner_email, tier, note, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(id, hash, email, tier, note, isoNow(), expiresAt).run();
      return { id, key };
    } catch (e) {
      if (attempt === 2) throw e; // id collision is astronomically unlikely; retry a couple of times anyway
    }
  }
  throw new Error("unreachable");
}

export async function revokeKeysFor(env: Env, email: string): Promise<number> {
  const r = await env.KEYS.prepare(
    "UPDATE api_keys SET revoked_at = ? WHERE owner_email = ? AND revoked_at IS NULL",
  ).bind(isoNow(), email).run();
  clearKeyCache();
  return r.meta.changes ?? 0;
}

/** Drop cached lookups in this isolate (other isolates expire theirs within CACHE_TTL_MS). */
export function clearKeyCache(): void {
  cache.clear();
}

export function limiterFor(env: Env, tier: Tier): RateLimit | undefined {
  switch (tier) {
    case "research": return env.LIMITER_RESEARCH;
    case "dashboard": return env.LIMITER_DASHBOARD;
    case "demo": return env.LIMITER_DEMO;
    case "full":
    case "admin": return undefined; // unlimited
    default: return env.LIMITER_FREE;
  }
}

/** Returns true when the request is within limits (or no limiter is configured). */
export async function allow(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch (e) {
    console.warn("rate limiter unavailable:", e);
    return true;
  }
}

export async function recordUsage(env: Env, keyId: string, bytes: number): Promise<void> {
  const day = isoNow().slice(0, 10);
  try {
    await env.KEYS.batch([
      env.KEYS.prepare(
        "INSERT INTO usage_daily (key_id, day, requests, bytes) VALUES (?, ?, 1, ?) " +
        "ON CONFLICT (key_id, day) DO UPDATE SET requests = requests + 1, bytes = bytes + excluded.bytes",
      ).bind(keyId, day, bytes),
      env.KEYS.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(isoNow(), keyId),
    ]);
  } catch (e) {
    console.warn("usage record failed:", e);
  }
}
