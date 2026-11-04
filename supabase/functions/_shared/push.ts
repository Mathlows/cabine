// Envoi des notifications (Web Push) avec les clés VAPID du projet.
import webpush from "npm:web-push@3.6.7";
import { admin } from "./google.ts";

const PUB = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const PRIV = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const SUBJECT = Deno.env.get("VAPID_SUBJECT") || "https://mathlows.github.io/cabine/";
if (PUB && PRIV) webpush.setVapidDetails(SUBJECT, PUB, PRIV);
export const vapidPublicKey = PUB;

/* Envoie à tous les appareils de l'utilisateur ; retire les abonnements expirés. Renvoie le nombre d'envois réussis. */
export async function pushToUser(userId: string, payload: Record<string, unknown>) {
  if (!PUB || !PRIV) throw new Error("vapid_absent");
  const { data: subs } = await admin.from("push_subscriptions").select("endpoint,keys").eq("user_id", userId);
  let ok = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
      ok++;
    } catch (e) {
      const code = (e as any)?.statusCode;
      if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    }
  }
  return ok;
}
