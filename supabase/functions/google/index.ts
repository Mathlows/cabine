// Fonction privée (appelée par l'application connectée) : e-mails Gmail et Google Agenda.
import { accessToken, admin, cors, gfetch, json, sendMail, TZ } from "../_shared/google.ts";

const CAL = "https://www.googleapis.com/calendar/v3";

function addDay(date: string) { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

function toGoogle(ev: any) {
  const start = ev.start || "20:00";
  const end = ev.end || "23:59";
  const endDate = end <= start ? addDay(ev.date) : ev.date;
  return {
    summary: ev.summary,
    location: ev.location || undefined,
    description: ev.description || undefined,
    start: { dateTime: `${ev.date}T${start}:00`, timeZone: TZ },
    end: { dateTime: `${endDate}T${end}:00`, timeZone: TZ },
    extendedProperties: { private: { cabineId: ev.id, cabineKind: ev.kind || "presta" } },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user }, error } = await admin.auth.getUser(jwt);
    if (error || !user) return json({ error: "non_connecte" }, 401);
    const body = await req.json();
    const { token, email } = await accessToken(user.id);
    const calId = encodeURIComponent(body.calendarId || "primary");

    switch (body.action) {
      case "status":
        return json({ connected: true, email });

      case "send": {
        const to = String(body.to || "").trim();
        if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+(\s*,\s*[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+)*$/.test(to)) return json({ error: "adresse_invalide" }, 400);
        const r = await sendMail(token, email, body.fromName || "", to, String(body.subject || ""), String(body.text || ""), body.attachments || []);
        return json({ ok: true, id: r.id });
      }

      case "calendars": {
        const r = await gfetch(token, `${CAL}/users/me/calendarList?minAccessRole=writer`);
        return json({ items: (r.items || []).map((c: any) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: !!c.primary, color: c.backgroundColor || "" })) });
      }

      case "overlay": {
        // événements des autres agendas, en lecture seule, pour la période affichée
        const ids: string[] = (Array.isArray(body.calendarIds) ? body.calendarIds : []).slice(0, 10);
        const timeMin = new Date(body.timeMin).toISOString(), timeMax = new Date(body.timeMax).toISOString();
        const out: any[] = [];
        await Promise.all(ids.map(async (id) => {
          let pageToken = "";
          do {
            const q = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
            if (pageToken) q.set("pageToken", pageToken);
            const r = await gfetch(token, `${CAL}/calendars/${encodeURIComponent(id)}/events?${q}`).catch(() => ({ items: [] }));
            for (const e of r.items || []) {
              if (e.status === "cancelled" || e.transparency === "transparent" && !e.start?.date) continue;
              out.push({ id: e.id, calendarId: id, summary: e.summary || "(sans titre)", location: e.location || "",
                start: e.start?.dateTime || e.start?.date || "", end: e.end?.dateTime || e.end?.date || "", allDay: !!e.start?.date, link: e.htmlLink || "", cabineId: e.extendedProperties?.private?.cabineId || "" });
            }
            pageToken = r.nextPageToken || "";
          } while (pageToken);
        }));
        return json({ items: out });
      }

      case "scan": {
        // tous les événements des agendas modifiables, pour repérer les doublons (lecture seule)
        const cals = await gfetch(token, `${CAL}/users/me/calendarList?minAccessRole=writer`);
        const timeMin = new Date(Date.now() - 1000 * 3600 * 24 * 120).toISOString(), timeMax = new Date(Date.now() + 1000 * 3600 * 24 * 730).toISOString();
        const out: any[] = [];
        for (const c of (cals.items || []).slice(0, 15)) {
          let pageToken = "";
          do {
            const q = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", maxResults: "2500" });
            if (pageToken) q.set("pageToken", pageToken);
            const r = await gfetch(token, `${CAL}/calendars/${encodeURIComponent(c.id)}/events?${q}`).catch(() => ({ items: [] }));
            for (const e of r.items || []) {
              if (e.status === "cancelled") continue;
              out.push({ id: e.id, calendarId: c.id, calName: c.summaryOverride || c.summary, summary: e.summary || "", location: e.location || "",
                start: e.start?.dateTime || e.start?.date || "", allDay: !!e.start?.date, created: e.created || "", cabineId: e.extendedProperties?.private?.cabineId || "", recurring: !!e.recurringEventId });
            }
            pageToken = r.nextPageToken || "";
          } while (pageToken);
        }
        return json({ items: out });
      }

      case "delete-many": {
        const items = (Array.isArray(body.items) ? body.items : []).slice(0, 300);
        let ok = 0;
        for (const it of items) {
          await gfetch(token, `${CAL}/calendars/${encodeURIComponent(it.calendarId)}/events/${encodeURIComponent(it.id)}`, { method: "DELETE" }).then(() => ok++).catch(() => {});
        }
        return json({ deleted: ok });
      }

      case "create-calendar": {
        const r = await gfetch(token, `${CAL}/calendars`, { method: "POST", body: JSON.stringify({ summary: body.name || "DJ", timeZone: TZ }) });
        return json({ id: r.id, name: r.summary });
      }

      case "upsert": {
        const g = toGoogle(body.event);
        const ev = body.event;
        // la date est dans un autre agenda (changement d'agenda) : on la déplace au lieu d'en créer une copie
        if (ev.googleId && ev.googleCal && ev.googleCal !== (body.calendarId || "primary")) {
          await gfetch(token, `${CAL}/calendars/${encodeURIComponent(ev.googleCal)}/events/${encodeURIComponent(ev.googleId)}/move?destination=${calId}`, { method: "POST" }).catch(() => {});
        }
        // pas d'identifiant connu : on cherche d'abord une date déjà créée par Cabine (autre appareil, essai précédent)
        if (!ev.googleId) {
          const q = new URLSearchParams({ privateExtendedProperty: `cabineId=${ev.id}`, showDeleted: "false", maxResults: "5" });
          const found = await gfetch(token, `${CAL}/calendars/${calId}/events?${q}`).catch(() => ({ items: [] }));
          const keep = (found.items || []).find((x: any) => x.status !== "cancelled");
          if (keep) body.event.googleId = keep.id;
        }
        const r = body.event.googleId
          ? await gfetch(token, `${CAL}/calendars/${calId}/events/${encodeURIComponent(body.event.googleId)}`, { method: "PATCH", body: JSON.stringify(g) }).catch(async (e) => {
              if (String(e.message).startsWith("google_404") || String(e.message).startsWith("google_410")) return gfetch(token, `${CAL}/calendars/${calId}/events`, { method: "POST", body: JSON.stringify(g) });
              throw e;
            })
          : await gfetch(token, `${CAL}/calendars/${calId}/events`, { method: "POST", body: JSON.stringify(g) });
        return json({ googleId: r.id, updated: r.updated, calendarId: body.calendarId || "primary" });
      }

      case "delete": {
        if (body.googleId) await gfetch(token, `${CAL}/calendars/${calId}/events/${encodeURIComponent(body.googleId)}`, { method: "DELETE" }).catch(() => {});
        return json({ ok: true });
      }

      case "pull": {
        // événements modifiés depuis la dernière synchronisation
        const out: any[] = [];
        let pageToken = "";
        const since = body.since || new Date(Date.now() - 1000 * 3600 * 24 * 60).toISOString();
        do {
          const q = new URLSearchParams({ updatedMin: since, showDeleted: "true", singleEvents: "true", maxResults: "250", timeMin: new Date(Date.now() - 1000 * 3600 * 24 * 365).toISOString() });
          if (pageToken) q.set("pageToken", pageToken);
          const r = await gfetch(token, `${CAL}/calendars/${calId}/events?${q}`);
          for (const e of r.items || []) {
            out.push({
              googleId: e.id, status: e.status, summary: e.summary || "", location: e.location || "", description: e.description || "",
              start: e.start?.dateTime || e.start?.date || "", end: e.end?.dateTime || e.end?.date || "", allDay: !!e.start?.date,
              cabineId: e.extendedProperties?.private?.cabineId || "", updated: e.updated,
            });
          }
          pageToken = r.nextPageToken || "";
        } while (pageToken);
        return json({ items: out, now: new Date().toISOString() });
      }

      default:
        return json({ error: "action_inconnue" }, 400);
    }
  } catch (e) {
    const msg = String((e as Error).message || e);
    return json({ error: msg }, msg === "google_not_connected" ? 409 : 500);
  }
});
