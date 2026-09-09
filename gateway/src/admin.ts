import type { Env } from "./env";
import { isoNow, timingSafeEqual } from "./crypto";
import { bearer, json, readBody } from "./http";
import { clearKeyCache, DEFAULT_TIER, isValidTier, issueKey, TIERS } from "./keys";

function authorized(req: Request, env: Env): boolean {
  if (!env.ADMIN_SECRET) return false;
  return timingSafeEqual(bearer(req), env.ADMIN_SECRET);
}

/**
 * Operator routes, protected by ADMIN_SECRET:
 *   POST   /admin/keys              {email, tier?, note?, expires_at?}  -> issue a key (no email verification)
 *   GET    /admin/keys?email=       -> list keys (all, or for one email)
 *   PATCH  /admin/keys/:id          {tier}      -> change tier
 *   DELETE /admin/keys/:id          -> revoke
 *   GET    /admin/users?wants_upgrade=1
 *   GET    /admin/usage?days=7
 */
export async function handleAdmin(req: Request, env: Env): Promise<Response> {
  if (!authorized(req, env)) return json(401, { error: "unauthorized" });
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean); // ["admin", "keys", ":id"]
  const resource = parts[1];
  const id = parts[2];

  if (resource === "keys") {
    if (req.method === "POST" && !id) {
      const b = await readBody(req);
      const email = (b.email ?? "").trim().toLowerCase();
      const tier = (b.tier || DEFAULT_TIER).trim();
      if (!email.includes("@")) return json(400, { error: "email required" });
      if (!isValidTier(tier)) return json(400, { error: `tier must be one of ${TIERS.join(", ")}` });
      const expiresAt = b.expires_at?.trim() || null;
      await env.KEYS.prepare(
        "INSERT INTO users (email, name, created_at, verified_at) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO NOTHING",
      ).bind(email, b.name?.trim() || null, isoNow(), isoNow()).run();
      const issued = await issueKey(env, email, tier, b.note?.trim() || "issued by admin", expiresAt);
      return json(201, { ...issued, email, tier, expires_at: expiresAt, note: "Shown once." });
    }
    if (req.method === "GET" && !id) {
      const email = url.searchParams.get("email")?.trim().toLowerCase();
      const stmt = email
        ? env.KEYS.prepare("SELECT id, owner_email, tier, note, created_at, expires_at, revoked_at, last_used_at FROM api_keys WHERE owner_email = ? ORDER BY created_at DESC").bind(email)
        : env.KEYS.prepare("SELECT id, owner_email, tier, note, created_at, expires_at, revoked_at, last_used_at FROM api_keys ORDER BY created_at DESC LIMIT 500");
      const { results } = await stmt.all();
      return json(200, { keys: results });
    }
    if (req.method === "PATCH" && id) {
      const b = await readBody(req);
      const tier = (b.tier ?? "").trim();
      if (!isValidTier(tier)) return json(400, { error: `tier must be one of ${TIERS.join(", ")}` });
      const r = await env.KEYS.prepare("UPDATE api_keys SET tier = ? WHERE id = ?").bind(tier, id).run();
      if (!r.meta.changes) return json(404, { error: "no such key" });
      clearKeyCache();
      return json(200, { id, tier, note: "Cached lookups may keep the old tier for up to 60 seconds." });
    }
    if (req.method === "DELETE" && id) {
      const r = await env.KEYS.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(isoNow(), id).run();
      if (!r.meta.changes) return json(404, { error: "no such active key" });
      clearKeyCache();
      return json(200, { id, revoked: true, note: "Cached lookups may keep working for up to 60 seconds." });
    }
  }

  if (resource === "users" && req.method === "GET") {
    const onlyUpgrade = url.searchParams.get("wants_upgrade") === "1";
    const { results } = await env.KEYS.prepare(
      "SELECT u.email, u.name, u.affiliation, u.purpose, u.wants_upgrade, u.created_at, u.verified_at, " +
      "(SELECT id FROM api_keys k WHERE k.owner_email = u.email AND k.revoked_at IS NULL ORDER BY created_at DESC LIMIT 1) AS active_key_id, " +
      "(SELECT tier FROM api_keys k WHERE k.owner_email = u.email AND k.revoked_at IS NULL ORDER BY created_at DESC LIMIT 1) AS tier " +
      "FROM users u " + (onlyUpgrade ? "WHERE u.wants_upgrade = 1 " : "") + "ORDER BY u.created_at DESC LIMIT 1000",
    ).all();
    return json(200, { users: results });
  }

  if (resource === "usage" && req.method === "GET") {
    const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get("days") ?? "7", 10) || 7));
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const { results } = await env.KEYS.prepare(
      "SELECT u.key_id, coalesce(k.owner_email, '(demo key)') AS owner_email, coalesce(k.tier, 'demo') AS tier, sum(u.requests) AS requests, sum(u.bytes) AS bytes, max(u.day) AS last_day " +
      "FROM usage_daily u LEFT JOIN api_keys k ON k.id = u.key_id WHERE u.day >= ? GROUP BY u.key_id ORDER BY requests DESC LIMIT 500",
    ).bind(since).all();
    return json(200, { since, days, usage: results });
  }

  return json(404, { error: "not found" });
}
