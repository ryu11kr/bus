/** POST { subscription } — 푸시 구독 저장 */

import { canonicalShareEmail, getAuthUser } from "./_lib/auth.js";
import { getAdminClient } from "./_lib/admin.js";
import { isPushConfigured } from "./_lib/push.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  if (!isPushConfigured()) {
    return res.status(503).json({ error: "push_not_configured" });
  }

  const user = await getAuthUser(req);
  if (!user?.id || !user.email) {
    return res.status(401).json({ error: "login_required" });
  }

  const subscription = req.body?.subscription;
  if (!subscription?.endpoint) {
    return res.status(400).json({ error: "invalid_subscription" });
  }

  const admin = await getAdminClient();
  if (!admin) {
    return res.status(503).json({ error: "server_not_configured" });
  }

  const { error } = await admin.from("bus_push_subscriptions").upsert(
    {
      user_id: user.id,
      user_email: canonicalShareEmail(user.email),
      endpoint: subscription.endpoint,
      subscription,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,endpoint" }
  );
  if (error) {
    console.error(error);
    return res.status(500).json({ error: "save_failed" });
  }

  return res.status(200).json({ ok: true });
}