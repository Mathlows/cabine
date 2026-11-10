// Fonction publique : page de réservation (créneaux libres, demande de rendez-vous, choix d'un créneau proposé).
import { accessToken, admin, cors, gfetch, json, parisToUtc, sendMail, utcToParis } from "../_shared/google.ts";
import { pushToUser } from "../_shared/push.ts";

const APP_URL = (Deno.env.get("APP_URL") || "https://mathlows.github.io/cabine/").replace(/#.*$/, "");
const appLink = (id: string) => `${APP_URL}#bk-${id}`;

/* Notification sur le téléphone (si les notifications sont activées) — n'empêche jamais la demande d'aboutir. */
async function ping(u: string, id: string, title: string, body: string) {
  try { await pushToUser(u, { title, body, url: appLink(id), tag: `bk-${id}` }); } catch (_) { /* pas de clés ou pas d'appareil */ }
}

type Opening = { date: string; from: string; to: string };
const DAY = 86400000;
const FIELDS = ["kind", "firstName", "lastName", "company", "siret", "address", "cp", "city", "email", "phone", "eventType", "eventDate", "eventLocation", "guests", "music", "message"];

async function loadSettings(u: string) {
  const { data } = await admin.from("booking_settings").select("data").eq("user_id", u).maybeSingle();
  const s = data?.data || {};
  if (!s.enabled) throw new Error("ferme");
  return {
    title: s.title || "Prise de rendez-vous", intro: s.intro || "", duration: Number(s.duration) || 60, noticeHours: Number(s.noticeHours ?? 24),
    openings: (Array.isArray(s.openings) ? s.openings : []) as Opening[], place: s.place || "", calendarId: s.calendarId || "",
  };
}

async function busyIntervals(u: string, from: Date, to: Date, calendarId: string) {
  const busy: [number, number][] = [];
  const { data: evs } = await admin.from("items").select("data").eq("user_id", u).eq("col", "events");
  for (const { data: e } of evs || []) {
    if (!e?.date) continue;
    const s = parisToUtc(e.date, e.start || (e.kind === "rdv" ? "09:00" : "18:00"));
    let en = parisToUtc(e.date, e.end || (e.kind === "rdv" ? "10:00" : "23:59"));
    if (en <= s) en = new Date(en.getTime() + DAY);
    busy.push([s.getTime(), en.getTime()]);
  }
  const { data: reqs } = await admin.from("booking_requests").select("slot_start,slot_end,status,proposals").eq("user_id", u).in("status", ["pending", "proposed"]);
  for (const r of reqs || []) {
    if (r.slot_start && r.status === "pending") busy.push([new Date(r.slot_start).getTime(), new Date(r.slot_end).getTime()]);
    for (const p of r.status === "proposed" ? r.proposals || [] : []) busy.push([new Date(p.start).getTime(), new Date(p.end).getTime()]);
  }
  try {
    const { token } = await accessToken(u);
    const items = [{ id: "primary" }]; if (calendarId && calendarId !== "primary") items.push({ id: calendarId });
    const fb = await gfetch(token, "https://www.googleapis.com/calendar/v3/freeBusy", { method: "POST", body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items }) });
    for (const c of Object.values(fb.calendars || {}) as any[]) for (const b of c.busy || []) busy.push([new Date(b.start).getTime(), new Date(b.end).getTime()]);
  } catch (_) { /* agenda Google non relié : on se contente des dates de l'application */ }
  return busy;
}

async function freeSlots(u: string) {
  const s = await loadSettings(u);
  const now = Date.now();
  const start = now + s.noticeHours * 3600000;
  // plages ouvertes au cas par cas depuis l'agenda de Cabine (heure de Paris)
  const ranges = s.openings
    .filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o?.date || "") && /^\d{2}:\d{2}$/.test(o?.from || "") && /^\d{2}:\d{2}$/.test(o?.to || ""))
    .map((o) => { const a = parisToUtc(o.date, o.from).getTime(); let b = parisToUtc(o.date, o.to).getTime(); if (b <= a) b += DAY; return [a, b] as [number, number]; })
    .filter(([, b]) => b > start && b - now < 366 * DAY);
  const slots: { start: string; end: string }[] = [];
  if (!ranges.length) return { s, slots };
  const busy = await busyIntervals(u, new Date(now), new Date(Math.max(...ranges.map((r) => r[1]))), s.calendarId);
  const len = s.duration * 60000;
  for (const [ra, rb] of ranges) {
    for (let a = ra; a + len <= rb; a += len) {
      const e = a + len;
      if (a >= start && !busy.some(([x, y]) => a < y && e > x)) slots.push({ start: new Date(a).toISOString(), end: new Date(e).toISOString() });
    }
  }
  const seen = new Set<string>();
  return { s, slots: slots.filter((x) => (seen.has(x.start) ? false : (seen.add(x.start), true))).sort((a, b) => a.start.localeCompare(b.start)) };
}

function clean(form: any) {
  const o: Record<string, string> = {};
  for (const k of FIELDS) if (form?.[k] != null) o[k] = String(form[k]).slice(0, 1000).trim();
  return o;
}
const fmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

async function notify(u: string, subject: string, text: string, to?: string) {
  try {
    const { token, email } = await accessToken(u);
    await sendMail(token, email, "", to || email, subject, text);
  } catch (_) { /* pas de Gmail relié : la demande reste visible dans l'application */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    if (body.action === "info") {
      if (body.t) {
        const { data: r } = await admin.from("booking_requests").select("user_id,status,proposals,form").eq("token", body.t).maybeSingle();
        if (!r || r.status !== "proposed") return json({ error: "lien_expire" }, 404);
        const s = await loadSettings(r.user_id);
        return json({ title: s.title, intro: s.intro, place: s.place, proposals: (r.proposals || []).filter((p: any) => new Date(p.start).getTime() > Date.now()), name: r.form?.firstName || r.form?.company || "" });
      }
      const { s, slots } = await freeSlots(String(body.u || ""));
      return json({ title: s.title, intro: s.intro, place: s.place, duration: s.duration, slots });
    }
    if (body.action === "request") {
      const u = String(body.u || "");
      const form = clean(body.form);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email || "")) return json({ error: "email_invalide" }, 400);
      if (!(form.lastName || form.company)) return json({ error: "nom_manquant" }, 400);
      const { slots } = await freeSlots(u);
      // aucun créneau ouvert : la demande part sans créneau, vous en proposerez depuis Cabine
      const slot = body.slot ? slots.find((x) => x.start === body.slot?.start) : (slots.length ? undefined : null);
      if (slot === undefined) return json({ error: "creneau_indisponible" }, 409);
      const { count } = await admin.from("booking_requests").select("id", { count: "exact", head: true }).eq("user_id", u).eq("status", "pending").filter("form->>email", "eq", form.email);
      if ((count || 0) >= 3) return json({ error: "trop_de_demandes" }, 429);
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count: day } = await admin.from("booking_requests").select("id", { count: "exact", head: true }).eq("user_id", u).gte("created_at", since);
      if ((day || 0) >= 20) return json({ error: "trop_de_demandes" }, 429);
      const { data: row, error } = await admin.from("booking_requests").insert({ user_id: u, slot_start: slot?.start ?? null, slot_end: slot?.end ?? null, form }).select("id").single();
      if (error) throw error;
      const who = [form.firstName, form.lastName].filter(Boolean).join(" ") || form.company;
      const when = slot ? fmt(slot.start) : "sans créneau, à vous de proposer";
      await ping(u, row.id, "Nouvelle demande de rendez-vous", `${who} · ${when}${form.eventType ? " · " + form.eventType : ""}`);
      await notify(u, `Nouvelle demande de rendez-vous : ${who}`, `${who} ${slot ? "demande un rendez-vous le " + fmt(slot.start) : "souhaite un rendez-vous (aucun créneau n'était ouvert) : proposez-lui des créneaux"}.\n\nÉvénement : ${form.eventType || "—"} le ${form.eventDate || "—"} à ${form.eventLocation || "—"}\nE-mail : ${form.email}\nTéléphone : ${form.phone || "—"}\n\nMessage :\n${form.message || "—"}\n\nValidez ou proposez un autre créneau dans Cabine :\n${appLink(row.id)}`);
      await notify(u, "Votre demande de rendez-vous a bien été reçue", slot ? `Bonjour ${form.firstName || who},\n\nJ'ai bien reçu votre demande de rendez-vous pour le ${fmt(slot.start)}. Je vous confirme le créneau très vite.\n\nÀ bientôt !` : `Bonjour ${form.firstName || who},\n\nJ'ai bien reçu votre demande de rendez-vous. Je vous propose des créneaux très vite par e-mail.\n\nÀ bientôt !`, form.email);
      return json({ ok: true });
    }
    if (body.action === "pick") {
      const { data: r } = await admin.from("booking_requests").select("*").eq("token", String(body.t || "")).maybeSingle();
      if (!r || r.status !== "proposed") return json({ error: "lien_expire" }, 404);
      const p = (r.proposals || []).find((x: any) => x.start === body.slot?.start);
      if (!p) return json({ error: "creneau_indisponible" }, 409);
      await admin.from("booking_requests").update({ status: "pending", slot_start: p.start, slot_end: p.end, form: { ...r.form, picked: "1" } }).eq("id", r.id);
      const who = [r.form?.firstName, r.form?.lastName].filter(Boolean).join(" ") || r.form?.company;
      await ping(r.user_id, r.id, `${who} a choisi un créneau`, `${fmt(p.start)} · à valider dans Cabine`);
      await notify(r.user_id, `${who} a choisi un créneau`, `${who} a choisi le ${fmt(p.start)}.\n\nValidez-le dans Cabine :\n${appLink(r.id)}`);
      return json({ ok: true });
    }
    return json({ error: "action_inconnue" }, 400);
  } catch (e) {
    const msg = String((e as Error).message || e);
    return json({ error: msg }, msg === "ferme" ? 404 : 500);
  }
});
