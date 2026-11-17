/** GET — 이 기기 푸시 구독이 서버에 저장돼 있는지 */

import { getAuthUser, normalizeEmail } from "./_lib/auth.js";
import { getAdminClient } from "./_lib/admin.js";
import { isPushConfigured } from "./_lib/push.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const user = await getAuthUser(req);
  if (!user?.id) return res.status(401).json({ error: "login_required" });

  const admin = await getAdminClient();
  if (!admin) {
    return res.status(503).json({ error: "server_not_configured" });
  }

  const { count, error } = await admin
    .from("bus_push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (error) {
    console.error(error);
    return res.status(500).json({ error: "query_failed" });
  }

  return res.status(200).json({
    vapidConfigured: isPushConfigured(),
    email: normalizeEmail(user.email || ""),
    subscriptionCount: count ?? 0,
    readyForLockScreenPush: Boolean(isPushConfigured() && (count ?? 0) > 0),
  });
}