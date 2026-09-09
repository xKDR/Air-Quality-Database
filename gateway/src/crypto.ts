export async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(nBytes = 32): string {
  const a = new Uint8Array(nBytes);
  crypto.getRandomValues(a);
  return base64url(a);
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function isoInMinutes(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString();
}

/** Constant-time string comparison for secrets. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
