import type { Env } from "./env";
import { escapeHtml } from "./http";

export async function sendVerifyEmail(env: Env, to: string, link: string): Promise<void> {
  const subject = "Confirm your email to get your India Air Quality API key";
  const text = [
    "Hello,",
    "",
    "Click the link below to confirm your email address and receive your API key:",
    "",
    link,
    "",
    "The link works once and expires in 30 minutes. If you did not request an API key, ignore this email.",
    "",
    "India Air Quality API",
  ].join("\n");
  const html = `<div style="background:#f2f1f0;padding:32px 16px;font-family:Georgia,'Times New Roman',serif;color:#000">
  <div style="max-width:520px;margin:0 auto;background:#f2f1f0">
    <div style="height:6px;background:#f57d6a;width:64px;margin-bottom:22px"></div>
    <p style="font-family:Helvetica,Arial,sans-serif;font-weight:800;font-size:11px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 14px">India Air Quality API · XKDR Forum</p>
    <h1 style="font-family:Helvetica,Arial,sans-serif;font-weight:800;font-size:28px;line-height:1.15;color:#f57d6a;margin:0 0 18px">Confirm your email to get your key.</h1>
    <p style="font-size:15px;line-height:1.7;margin:0 0 22px">Click the button below and your API key appears on the next page. It is shown once, so keep it somewhere safe.</p>
    <p style="margin:0 0 26px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#000;color:#f2f1f0;font-family:Helvetica,Arial,sans-serif;font-weight:800;font-size:11px;letter-spacing:.2em;text-transform:uppercase;padding:15px 30px;text-decoration:none;border:2px solid #000">Get my API key</a></p>
    <p style="font-size:13px;line-height:1.6;color:#4b4b4b;margin:0 0 6px">Or copy this link:<br><a href="${escapeHtml(link)}" style="color:#000;word-break:break-all">${escapeHtml(link)}</a></p>
    <p style="font-size:13px;line-height:1.6;color:#4b4b4b;margin:18px 0 0">The link works once and expires in 30 minutes. If you did not request an API key, ignore this email.</p>
  </div>
</div>`;

  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text, html }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Resend rejected the email (${resp.status}): ${body.slice(0, 300)}`);
    }
    return;
  }
  // "log" provider: the operator reads the link from `wrangler tail` and forwards it by hand.
  console.log(`[email:log] verification link for ${to}: ${link}`);
}
