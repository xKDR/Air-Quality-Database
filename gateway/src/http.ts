import type { Env } from "./env";

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function html(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function wantsJson(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  const ctype = req.headers.get("content-type") ?? "";
  return accept.includes("application/json") || ctype.includes("application/json");
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
}

/** Parse a JSON or form-encoded body into a flat string map. */
export async function readBody(req: Request): Promise<Record<string, string>> {
  const ctype = req.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  if (ctype.includes("application/json")) {
    const obj = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj ?? {})) out[k] = v == null ? "" : String(v);
    return out;
  }
  const form = await req.formData().catch(() => null);
  if (form) for (const [k, v] of form.entries()) out[k] = typeof v === "string" ? v : "";
  return out;
}

export function bearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (m) return m[1].trim();
  return req.headers.get("x-api-key")?.trim() ?? "";
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// --- CORS (for the browser dashboard) -------------------------------------
export function corsHeaders(env: Env, req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !env.ALLOWED_ORIGINS) return {};
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  if (!(allowed.includes("*") || allowed.includes(origin))) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "authorization, x-api-key, content-type",
    "access-control-expose-headers": "x-row-count, x-truncated, x-query-ms, x-key-id, x-tier",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

export function withHeaders(resp: Response, extra: Record<string, string>): Response {
  if (Object.keys(extra).length === 0) return resp;
  const r = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(extra)) r.headers.set(k, v);
  return r;
}
