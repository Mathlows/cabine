// Fonction privée : dépôt des factures électroniques sur la plateforme agréée SuperPDP et suivi des statuts.
// Identifiants : secrets SUPERPDP_CLIENT_ID / SUPERPDP_CLIENT_SECRET (environnement de test ou de production).
import { admin, cors, json } from "../_shared/google.ts";

const API = Deno.env.get("SUPERPDP_API_URL") || "https://api.superpdp.tech/v1.beta";
const AUTH = Deno.env.get("SUPERPDP_AUTH_URL") || "https://api.superpdp.tech/oauth2/token";
let cached = { token: "", until: 0 };

async function token() {
  if (cached.token && Date.now() < cached.until) return cached.token;
  const id = (Deno.env.get("SUPERPDP_CLIENT_ID") || "").trim(), secret = (Deno.env.get("SUPERPDP_CLIENT_SECRET") || "").trim();
  if (!id || !secret) throw new Error("pa_non_configuree");
  // identifiants dans le formulaire, puis en en-tête si la plateforme le préfère
  let r = await fetch(AUTH, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }).toString() });
  if (r.status === 401 || r.status === 400) {
    r = await fetch(AUTH, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(id + ":" + secret) },
      body: new URLSearchParams({ grant_type: "client_credentials" }).toString() });
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`pa_auth_${r.status}: ${j.error_description || j.error || "refus"}`);
  cached = { token: j.access_token, until: Date.now() + ((j.expires_in ?? 600) - 60) * 1000 };
  return cached.token;
}
async function call(method: string, path: string, body?: BodyInit, type?: string) {
  const r = await fetch(API + path, { method, body, headers: { Authorization: "Bearer " + await token(), ...(type ? { "Content-Type": type } : {}), Accept: "application/json" } });
  const text = await r.text(); let j: any = {}; try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text.slice(0, 500) }; }
  if (!r.ok) throw new Error(`pa_${r.status}: ${j?.error?.message || j?.message || j?.error || j?.raw || "erreur"}`);
  return j;
}
const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user }, error } = await admin.auth.getUser(jwt);
    if (error || !user) return json({ error: "non_connecte" }, 401);
    const owner = Deno.env.get("OWNER_EMAIL");
    if (owner && user.email?.toLowerCase() !== owner.toLowerCase()) return json({ error: "non_autorise" }, 403);
    const body = await req.json();
    switch (body.action) {
      case "status": {
        const me = await call("GET", "/companies/me");
        return json({ ok: true, env: me?.env || "", sandbox: me?.env === "sandbox", company: { name: me?.trade_name || me?.formal_name || "", id: me?.id ?? null, siren: me?.number || "" } });
      }
      case "send": {
        // Dépôt du Factur-X (PDF/A-3 avec XML CII intégré)
        // Factur-X (application/pdf) ou XML CII seul (application/xml), selon ce qu'accepte le destinataire
        const bytes = b64ToBytes(String(body.base64 || ""));
        const type = body.contentType === "application/xml" ? "application/xml" : "application/pdf";
        if (bytes.length < (type === "application/pdf" ? 1000 : 200)) return json({ error: "fichier_invalide" }, 400);
        const q = new URLSearchParams({ external_id: String(body.externalId || "") });
        const r = await call("POST", "/invoices?" + q, bytes, type);
        return json({ ok: true, id: r?.id ?? null, events: r?.events ?? [] });
      }
      case "events": {
        // Derniers statuts des factures envoyées
        const q = new URLSearchParams({ direction: "out", limit: String(body.limit || 100) }); q.append("expand[]", "events");
        const r = await call("GET", "/invoices?" + q);
        const rows = (Array.isArray(r) ? r : r?.data || []).map((i: any) => ({
          id: i.id, externalId: i.external_id, number: i.en_invoice?.number || i.external_id,
          events: (i.events || []).map((e: any) => ({ code: e.status_code, at: e.created_at, message: e.message || e.details?.[0]?.reason || "" })),
        }));
        return json({ rows });
      }
      default: return json({ error: "action_inconnue" }, 400);
    }
  } catch (e) {
    const msg = String((e as Error).message || e);
    return json({ error: msg }, msg === "pa_non_configuree" ? 409 : 502);
  }
});
