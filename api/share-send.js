/** POST { toEmail } — 공유 요청 + Android 푸시 */

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

  const toEmail = normalizeEmail(req.body?.toEmail);
  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return res.status(400).json({ error: "invalid_email" });
  }

  const fromEmail = normalizeEmail(user.email);
  if (toEmail === fromEmail) {
    return res.status(400).json({ error: "self_share" });
  }

  const admin = await getAdminClient();
  if (!admin) {
    return res.status(503).json({ error: "server_not_configured" });
  }

  const { data: ownerData } = await admin
    .from("bus_user_data")
    .select("stops")
    .eq("user_id", user.id)
    .maybeSingle();
  const stops = Array.isArray(ownerData?.stops) ? ownerData.stops : [];
  if (!stops.length) {
    return res.status(400).json({
      error: "no_stops",
      message: "먼저 정류장을 등록하고 클라우드에 저장한 뒤 공유해 주세요.",
    });
  }

  await admin
    .from("bus_share_requests")
    .update({ status: "cancelled", responded_at: new Date().toISOString() })
    .eq("from_user_id", user.id)
    .eq("to_email", toEmail)
    .eq("status", "pending");

  const { data: row, error: insErr } = await admin
    .from("bus_share_requests")
    .insert({
      from_user_id: user.id,
      from_email: fromEmail,
      to_email: toEmail,
      status: "pending",
    })
    .select("id")
    .single();
  if (insErr) {
    console.error(insErr);
    return res.status(500).json({ error: "insert_failed" });
  }

  const pushResult = await sendSharePushToEmail(admin, toEmail, {
    title: "내버스시간표",
    body: `${fromEmail} 님이 정류장 정보를 공유했습니다.`,
    url: "/?share=pending",
    requestId: row.id,
  });

  return res.status(200).json({
    ok: true,
    requestId: row.id,
    push: pushResult,
  });
}