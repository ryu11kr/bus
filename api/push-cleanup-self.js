/** POST — 이 계정의 옛 푸시 구독 삭제 (현재 기기 endpoint만 남김) */

import { getAuthUser } from "./_lib/auth.js";
import { getAdminClient } from "./_lib/admin.js";

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

  const user = await getAuthUser(req);
  if (!user?.id) {
    return res.status(401).json({ error: "login_required" });
  }

  const keepEndpoint = String(req.body?.endpoint || "").trim();
  const admin = await getAdminClient();
  if (!admin) {
    return res.status(503).json({ error: "server_not_configured" });
  }

  let query = admin.from("bus_push_subscriptions").delete().eq("user_id", user.id);
  if (keepEndpoint) {
    query = query.neq("endpoint", keepEndpoint);
  }

  const { data: deleted, error } = await query.select("id");
  if (error) {
    console.error(error);
    return res.status(500).json({ error: "cleanup_failed" });
  }

  return res.status(200).json({
    ok: true,
    removed: Array.isArray(deleted) ? deleted.length : 0,
  });
}