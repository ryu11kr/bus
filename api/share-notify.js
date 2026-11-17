/** POST { requestId } — 공유 요청 푸시만 (선택) */

import { getAuthUser, normalizeEmail } from "./_lib/auth.js";
import { getAdminClient } from "./_lib/admin.js";
import { sendSharePushToEmail } from "./_lib/push.js";

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
  if (!user?.id || !user.email) {
    return res.status(401).json({ error: "login_required" });
  }

  const requestId = String(req.body?.requestId || "").trim();
  if (!requestId) {
    return res.status(400).json({ error: "missing_request_id" });
  }

  const admin = await getAdminClient();
  if (!admin) {
    return res.status(200).json({ ok: true, push: { skipped: "no_service_role" } });
  }

  const { data: reqRow, error } = await admin
    .from("bus_share_requests")
    .select("id, from_user_id, from_email, to_email, status")
    .eq("id", requestId)
    .maybeSingle();
  if (error || !reqRow) {
    return res.status(404).json({ error: "not_found" });
  }
  if (reqRow.from_user_id !== user.id) {
    return res.status(403).json({ error: "forbidden" });
  }
  if (reqRow.status !== "pending") {
    return res.status(409).json({ error: "not_pending" });
  }

  const pushResult = await sendSharePushToEmail(admin, normalizeEmail(reqRow.to_email), {
    title: "내버스시간표",
    body: `${normalizeEmail(reqRow.from_email)} 님이 정류장 정보를 공유했습니다.`,
    url: "/?share=pending",
    requestId: reqRow.id,
  });

  return res.status(200).json({ ok: true, push: pushResult });
}