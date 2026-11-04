// Fonction privée : clé publique des notifications et notification de test.
import { admin, cors, json } from "../_shared/google.ts";
import { pushToUser, vapidPublicKey } from "../_shared/push.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user }, error } = await admin.auth.getUser(jwt);
    if (error || !user) return json({ error: "non_connecte" }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.action === "key") return json({ publicKey: vapidPublicKey });
    if (body.action === "test") {
      const n = await pushToUser(user.id, { title: "Cabine", body: "Les rappels fonctionnent sur cet appareil.", url: "#agenda", tag: "test" });
      return json({ sent: n });
    }
    return json({ error: "action_inconnue" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
