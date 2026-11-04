// Appelée chaque minute par le planificateur : envoie les rappels arrivés à échéance.
// Sans données en entrée et sans effet en double (chaque rappel n'est envoyé qu'une fois).
import { admin, cors, json, parisToUtc } from "../_shared/google.ts";
import { pushToUser } from "../_shared/push.ts";

const label = (m: number) => m >= 1440 ? (m === 1440 ? "demain" : `dans ${Math.round(m / 1440)} jours`) : m >= 60 ? `dans ${m / 60 === Math.round(m / 60) ? m / 60 + " h" : Math.floor(m / 60) + " h " + (m % 60)}` : `dans ${m} min`;
const clientName = (c: any) => !c ? "" : c.kind === "entreprise" ? (c.company || "") : [c.firstName, c.lastName].filter(Boolean).join(" ");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { data: subs } = await admin.from("push_subscriptions").select("user_id");
    const users = [...new Set((subs || []).map((s) => s.user_id))];
    const now = Date.now(); let sent = 0;
    for (const u of users) {
      const { data: st } = await admin.from("items").select("data").eq("user_id", u).eq("col", "settings").eq("id", "main").maybeSingle();
      const cfg = st?.data?.reminders || {};
      const defRdv = cfg.rdv === undefined ? 60 : cfg.rdv, defPresta = cfg.presta === undefined ? null : cfg.presta;
      const { data: evs } = await admin.from("items").select("id,data").eq("user_id", u).eq("col", "events");
      for (const { id, data: e } of evs || []) {
        if (!e?.date) continue;
        const mins = e.reminder === "none" ? null : (typeof e.reminder === "number" ? e.reminder : (e.kind === "rdv" ? defRdv : defPresta));
        if (mins === null || mins === undefined || mins === "none") continue;
        const start = parisToUtc(e.date, e.start || (e.kind === "rdv" ? "09:00" : "20:00")).getTime();
        const fire = start - Number(mins) * 60000;
        if (now < fire || now > start || now - fire > 3 * 3600000) continue;   // pas encore l'heure, ou trop tard
        const fireKey = `${mins}|${e.date}|${e.start || ""}`;
        const { error } = await admin.from("reminders_sent").insert({ user_id: u, event_id: id, fire_key: fireKey });
        if (error) continue;   // déjà envoyé
        let who = "";
        if (e.clientId) { const { data: c } = await admin.from("items").select("data").eq("user_id", u).eq("col", "clients").eq("id", e.clientId).maybeSingle(); who = clientName(c?.data); }
        const title = `${e.kind === "rdv" ? "Rendez-vous" : "Prestation"} ${label(Number(mins))}`;
        const body = [who || e.location || e.eventType || "", e.start ? "à " + e.start.replace(":", " h ") : "", e.kind === "rdv" ? e.location : (who ? e.location : "")].filter(Boolean).join(" · ");
        sent += await pushToUser(u, { title, body: body || "Ouvrez Cabine pour voir le détail", url: `#ev-${id}`, tag: `ev-${id}` });
      }
    }
    return json({ ok: true, sent });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
