// Outils communs : accès Google (Gmail + Agenda) avec le jeton enregistré du propriétaire.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export async function accessToken(userId: string): Promise<{ token: string; email: string }> {
  const { data, error } = await admin.from("google_tokens").select("refresh_token,email").eq("user_id", userId).maybeSingle();
  if (error || !data) throw new Error("google_not_connected");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: data.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("google_refresh_failed: " + (j.error_description || j.error));
  return { token: j.access_token, email: data.email || "" };
}

export async function gfetch(token: string, url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`google_${r.status}: ${j?.error?.message || "erreur"}`);
  return j;
}

// --- e-mail (Gmail API) ---
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
const encWord = (s: string) => `=?UTF-8?B?${b64(s)}?=`;
const wrap = (s: string) => s.replace(/(.{76})/g, "$1\r\n");
export type Attachment = { filename: string; base64: string; mime?: string };
export async function sendMail(token: string, from: string, fromName: string, to: string, subject: string, text: string, attachments: Attachment[] = [], replyTo = "") {
  const boundary = "cabine_" + crypto.randomUUID();
  const head = [
    `From: ${fromName ? encWord(fromName) + " " : ""}<${from}>`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : "",
    `Subject: ${encWord(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].filter(Boolean).join("\r\n");
  let body = `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(b64(text))}\r\n`;
  for (const a of attachments) {
    body += `--${boundary}\r\nContent-Type: ${a.mime || "application/pdf"}; name="${encWord(a.filename)}"\r\nContent-Disposition: attachment; filename="${encWord(a.filename)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(a.base64)}\r\n`;
  }
  body += `--${boundary}--`;
  const raw = btoa(head + "\r\n\r\n" + body).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return gfetch(token, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", body: JSON.stringify({ raw }) });
}

// --- fuseau horaire Paris ---
export const TZ = "Europe/Paris";
export function parisToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asParis = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
  return new Date(guess - (asParis - guess));
}
export function utcToParis(dt: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(dt);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}
