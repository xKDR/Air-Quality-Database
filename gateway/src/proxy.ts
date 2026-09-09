import type { Env } from "./env";
import { json } from "./http";
import type { KeyRow } from "./keys";

const FILE_KEY_RE = /^v\d+\/[A-Za-z0-9_\-=./]+\.(parquet|json)$/;

/** Stream a bulk file from R2, honouring Range and conditional headers so DuckDB/httpfs can read in place. */
export async function serveFile(req: Request, env: Env, key: string): Promise<Response> {
  if (!env.BUCKET) return json(503, { error: "bulk_unavailable", detail: "Bulk file storage is not configured." });
  if (!FILE_KEY_RE.test(key) || key.includes("..")) return json(404, { error: "not_found" });

  if (req.method === "HEAD") {
    const head = await env.BUCKET.head(key);
    if (!head) return json(404, { error: "not_found" });
    const h = new Headers();
    head.writeHttpMetadata(h);
    h.set("etag", head.httpEtag);
    h.set("content-length", String(head.size));
    h.set("accept-ranges", "bytes");
    return new Response(null, { status: 200, headers: h });
  }

  const obj = await env.BUCKET.get(key, { range: req.headers, onlyIf: req.headers });
  if (!obj) return json(404, { error: "not_found" });
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("etag", obj.httpEtag);
  h.set("accept-ranges", "bytes");
  h.set("cache-control", "private, max-age=300");
  if (!h.has("content-type")) h.set("content-type", key.endsWith(".json") ? "application/json" : "application/vnd.apache.parquet");
  if (!("body" in obj) || obj.body == null) {
    return new Response(null, { status: 304, headers: h }); // precondition (If-None-Match etc.) not met
  }
  if (req.headers.has("range") && obj.range && "offset" in obj.range) {
    const offset = obj.range.offset ?? 0;
    const length = obj.range.length ?? obj.size - offset;
    h.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    h.set("content-length", String(length));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set("content-length", String(obj.size));
  return new Response(obj.body, { status: 200, headers: h });
}

/** Forward a data request to the FastAPI origin, stamping the caller's identity and the gateway secret. */
export async function forwardToOrigin(req: Request, env: Env, caller: KeyRow): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return json(405, { error: "method_not_allowed" });
  if (!env.ORIGIN_URL || !env.ORIGIN_SECRET) return json(503, { error: "origin_unavailable", detail: "Query service is not configured." });

  const inUrl = new URL(req.url);
  const outUrl = new URL(inUrl.pathname + inUrl.search, env.ORIGIN_URL);
  const headers = new Headers();
  headers.set("x-gateway-secret", env.ORIGIN_SECRET);
  headers.set("x-key-id", caller.id);
  headers.set("x-tier", caller.tier);
  headers.set("x-forwarded-for", req.headers.get("cf-connecting-ip") ?? "");
  headers.set("accept", req.headers.get("accept") ?? "*/*");
  const ae = req.headers.get("accept-encoding");
  if (ae) headers.set("accept-encoding", ae);

  let resp: Response;
  try {
    resp = await fetch(outUrl.toString(), { method: req.method, headers, redirect: "manual" });
  } catch (e) {
    console.error("origin fetch failed:", e);
    return json(502, { error: "origin_unreachable", detail: "The query service did not respond. Try again shortly." });
  }
  // Hide origin internals, keep the useful headers.
  const out = new Response(resp.body, { status: resp.status, headers: resp.headers });
  out.headers.delete("server");
  out.headers.set("cache-control", "private, no-store");
  return out;
}
