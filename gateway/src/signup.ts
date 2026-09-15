import type { Env } from "./env";
import { isDev, isInstantMode } from "./env";
import { isoInMinutes, isoNow, randomToken, sha256hex } from "./crypto";
import { sendVerifyEmail } from "./email";
import { clientIp, html, json, readBody, wantsJson } from "./http";
import { DEFAULT_TIER, issueKey, revokeKeysFor, type Tier } from "./keys";
import { checkEmailPage, keyPage, messagePage, signupPage } from "./pages";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TOKEN_TTL_MIN = 30;

async function verifyTurnstile(env: Env, token: string, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) {
    if (isDev(env)) return true;
    console.error("TURNSTILE_SECRET is not set; refusing signups");
    return false;
  }
  if (!token) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip });
  const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const data = (await resp.json().catch(() => ({}))) as { success?: boolean };
  return data.success === true;
}

export function getSignup(env: Env): Response {
  return html(200, signupPage(env));
}

export async function postSignup(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const asJson = wantsJson(req);
  const body = await readBody(req);
  const email = (body.email ?? "").trim().toLowerCase();
  const name = (body.name ?? "").trim().slice(0, 120);
  const affiliation = (body.affiliation ?? "").trim().slice(0, 200) || null;
  const purpose = (body.purpose ?? "").trim().slice(0, 1000) || null;
  const ip = clientIp(req);

  const fail = (status: number, error: string) =>
    asJson ? json(status, { error }) : html(status, signupPage(env, { error, values: body }));

  if (!EMAIL_RE.test(email) || email.length > 254) return fail(400, "Please enter a valid email address.");
  if (!name) return fail(400, "Please enter your name.");
  if (!body.accept_terms) return fail(400, "Please accept the attribution terms.");
  // Cloudflare Turnstile is the only gate: no signup rate limit, no cap on keys per email.
  if (!(await verifyTurnstile(env, body["cf-turnstile-response"] ?? "", ip))) {
    return fail(400, "The human check failed or expired. Please tick it again and resubmit.");
  }

  const now = isoNow();
  const upsertUser = env.KEYS.prepare(
    "INSERT INTO users (email, name, affiliation, purpose, wants_upgrade, created_at) VALUES (?, ?, ?, ?, 0, ?) " +
    "ON CONFLICT (email) DO UPDATE SET name = excluded.name, affiliation = excluded.affiliation, purpose = excluded.purpose",
  ).bind(email, name, affiliation, purpose, now);

  // Instant mode: the human check passed, so issue a key now and show it once. Every key is the same (full access);
  // signing up never revokes existing keys, because the email address is not verified.
  if (isInstantMode(env)) {
    await upsertUser.run();
    const { id, key } = await issueKey(env, email, DEFAULT_TIER, "instant signup (email not verified)", null);
    if (asJson) return json(201, { ok: true, id, key, tier: DEFAULT_TIER, note: "Store this key now; it cannot be retrieved again." });
    return html(200, keyPage(env, key, DEFAULT_TIER, false), { "cache-control": "no-store" });
  }

  // Email mode: send a one-time confirmation link; the key is issued at /verify.
  const token = randomToken(32);
  const tokenHash = await sha256hex(token);
  await env.KEYS.batch([
    upsertUser,
    env.KEYS.prepare(
      "INSERT INTO verify_tokens (token_hash, email, expires_at, ip) VALUES (?, ?, ?, ?)",
    ).bind(tokenHash, email, isoInMinutes(TOKEN_TTL_MIN), ip),
  ]);

  const link = `${env.PUBLIC_URL.replace(/\/$/, "")}/verify?token=${token}`;
  try {
    await sendVerifyEmail(env, email, link);
  } catch (e) {
    console.error("email send failed:", e);
    return fail(502, "We could not send the confirmation email right now. Please try again later.");
  }

  const devLink = isDev(env) ? link : undefined;
  if (asJson) return json(200, { ok: true, message: "Check your email for a confirmation link.", ...(devLink ? { dev_verify_url: devLink } : {}) });
  return html(200, checkEmailPage(env, email, devLink));
}

export async function getVerify(req: Request, env: Env): Promise<Response> {
  const asJson = wantsJson(req);
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const fail = (status: number, title: string, message: string) =>
    asJson ? json(status, { error: title, detail: message }) : html(status, messagePage(env, title, message));

  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return fail(400, "Invalid link", "This confirmation link is not valid.");
  const tokenHash = await sha256hex(token);
  const row = await env.KEYS.prepare(
    "SELECT email FROM verify_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
  ).bind(tokenHash, isoNow()).first<{ email: string }>();
  if (!row) return fail(400, "Link expired", "This confirmation link has expired or was already used. Sign up again to get a new one.");

  // Burn the token first so a double click cannot mint two keys.
  const burn = await env.KEYS.prepare(
    "UPDATE verify_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL",
  ).bind(isoNow(), tokenHash).run();
  if (!burn.meta.changes) return fail(400, "Link expired", "This confirmation link was already used.");

  // Keep an admin-set tier on rotation; otherwise every key is the default (full access).
  const prev = await env.KEYS.prepare(
    "SELECT tier FROM api_keys WHERE owner_email = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
  ).bind(row.email).first<{ tier: string }>();
  const tier: Tier = (prev?.tier as Tier | undefined) ?? DEFAULT_TIER;

  const rotated = (await revokeKeysFor(env, row.email)) > 0;
  const { id, key } = await issueKey(env, row.email, tier, "self-serve signup", null);
  await env.KEYS.prepare("UPDATE users SET verified_at = COALESCE(verified_at, ?) WHERE email = ?").bind(isoNow(), row.email).run();

  if (asJson) return json(200, { ok: true, id, key, tier, rotated, note: "Store this key now; it cannot be retrieved again." });
  return html(200, keyPage(env, key, tier, rotated));
}
