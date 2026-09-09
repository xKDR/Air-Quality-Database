/**
 * India Air Quality API gateway.
 *
 *   GET  /                     documentation (live coverage numbers from the manifest on R2)
 *   GET  /health
 *   GET  /signup, POST /signup, GET /verify      self-serve API keys (email magic link)
 *   *    /admin/*              operator routes (ADMIN_SECRET)
 *   GET  /v1/docs, /v1/openapi.json              interactive docs, no key needed (IP rate-limited)
 *   GET  /v1/files/<key>       bulk Parquet from R2               (API key)
 *   GET  /v1/*                 forwarded to the query service     (API key)
 */
import type { Env } from "./env";
import { isRequestMode } from "./env";
import { handleAdmin } from "./admin";
import { bearer, clientIp, corsHeaders, html, json, withHeaders } from "./http";
import { allow, limiterFor, lookupKey, recordUsage, type KeyRow } from "./keys";
import { adminPage, landingPage, requestKeyPage, type Stats } from "./pages";
import { forwardToOrigin, serveFile } from "./proxy";
import { getSignup, getVerify, postSignup } from "./signup";

const PUBLIC_PATHS = new Set(["/v1/docs", "/v1/openapi.json"]);
const PUBLIC_CALLER: KeyRow = { id: "public-docs", tier: "free", owner_email: "", expires_at: null, revoked_at: null };

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const cors = corsHeaders(env, req);

    try {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (path === "/" && req.method === "GET") {
        return html(200, landingPage(env, await loadStats(env)), { "cache-control": "public, max-age=300" });
      }
      if (path === "/health") return json(200, { ok: true });
      if (path === "/signup" || path === "/request") {
        if (isRequestMode(env)) return html(200, requestKeyPage(env), { "cache-control": "public, max-age=300" });
        if (req.method === "GET") return getSignup(env);
        if (req.method === "POST") return postSignup(req, env, ctx);
      }
      if (path === "/verify" && req.method === "GET") return getVerify(req, env);
      if (path === "/admin" && req.method === "GET") return html(200, adminPage(env), { "x-robots-tag": "noindex" });
      if (path.startsWith("/admin/")) return handleAdmin(req, env);

      if (path.startsWith("/v1/") || path === "/v1") {
        return withHeaders(await handleApi(req, env, ctx, path), cors);
      }
      return json(404, { error: "not_found" });
    } catch (e) {
      console.error("unhandled:", e);
      return withHeaders(json(500, { error: "internal_error" }), cors);
    }
  },
};

async function handleApi(req: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  // Interactive docs are public so people can read them before signing up; "try it out" still needs a key.
  if (PUBLIC_PATHS.has(path) && req.method === "GET" && !bearer(req)) {
    if (!(await allow(env.LIMITER_ANON, clientIp(req)))) return json(429, { error: "rate_limited" });
    return forwardToOrigin(req, env, PUBLIC_CALLER);
  }

  // 1. Identify the caller.
  const key = bearer(req);
  if (!key) {
    return json(401, { error: "missing_api_key", detail: "Send your key as `Authorization: Bearer aqi_...`. Get one at /signup." },
      { "www-authenticate": 'Bearer realm="aqi-api"' });
  }
  const caller = await lookupKey(env, key);
  if (!caller) {
    // Bound brute force per IP; a 256-bit key cannot be guessed, but D1 reads are not free.
    if (!(await allow(env.LIMITER_ANON, clientIp(req)))) return json(429, { error: "rate_limited" });
    return json(401, { error: "invalid_api_key", detail: "This key is unknown, revoked, or expired. Get a new one at /signup." });
  }

  // 2. Rate limit by key, limit chosen by tier. The shared demo key is limited per IP instead.
  const limitKey = caller.tier === "demo" ? clientIp(req) : caller.id;
  if (!(await allow(limiterFor(env, caller.tier), limitKey))) {
    return json(429, { error: "rate_limited", detail: `Too many requests for the ${caller.tier} tier. Slow down or ask for a higher tier.` },
      { "retry-after": "60" });
  }

  // 3. Route.
  let resp: Response;
  if (path.startsWith("/v1/files/")) {
    const key = decodeURIComponent(path.slice("/v1/files/".length));
    if (caller.tier === "demo" && !demoMayRead(env, key)) {
      return json(403, { error: "demo_key", detail: `The demo key can only read the station, parameter and manifest files and the ${env.DEMO_BULK_YEARS || "sample"} month files. Request your own key at /signup for everything.` });
    }
    resp = await serveFile(req, env, key);
  } else {
    resp = await forwardToOrigin(req, env, caller);
  }

  // 4. Account for it without delaying the response.
  const bytes = parseInt(resp.headers.get("content-length") ?? "0", 10) || 0;
  ctx.waitUntil(recordUsage(env, caller.id, bytes));
  return resp;
}

/** The demo key may read the small dimension files and the month files of DEMO_BULK_YEARS. */
function demoMayRead(env: Env, key: string): boolean {
  if (/^v1\/(stations\.parquet|parameters\.parquet|_manifest\.json)$/.test(key)) return true;
  const years = (env.DEMO_BULK_YEARS || "").split(",").map((y) => y.trim()).filter(Boolean);
  const m = /^v1\/measurements\/year=(\d{4})\/month=\d{2}\/data\.parquet$/.exec(key);
  return !!m && years.includes(m[1]);
}

// Coverage numbers for the landing page, read from the manifest the exporter writes to R2.
let statsCache: { at: number; stats: Stats | null } | null = null;
const STATS_TTL_MS = 5 * 60_000;

async function loadStats(env: Env): Promise<Stats | null> {
  if (statsCache && Date.now() - statsCache.at < STATS_TTL_MS) return statsCache.stats;
  let stats: Stats | null = null;
  try {
    const obj = env.BUCKET ? await env.BUCKET.get("v1/_manifest.json") : null;
    if (obj) {
      const m = (await obj.json()) as {
        exported_at: string;
        measurements: { rows: number; months: { year: number; month: number }[] };
        stations: { rows: number };
        parameters: { rows: number };
      };
      const months = m.measurements.months;
      const ym = (x: { year: number; month: number }) => `${x.year}-${String(x.month).padStart(2, "0")}`;
      stats = {
        rows: m.measurements.rows,
        stations: m.stations.rows,
        parameters: m.parameters.rows,
        months: months.length,
        firstMonth: months.length ? ym(months[0]) : "",
        lastMonth: months.length ? ym(months[months.length - 1]) : "",
        exportedAt: m.exported_at,
      };
    }
  } catch (e) {
    console.warn("stats unavailable:", e);
  }
  statsCache = { at: Date.now(), stats };
  return stats;
}
