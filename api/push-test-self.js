/** POST — 받는 사람 본인에게 테스트 푸시 (진단) */

import { canonicalShareEmail, getAuthUser } from "./_lib/auth.js";
import { getAdminClient } from "./_lib/admin.js";
import { isPushConfigured, sendSharePushToEmail } from "./_lib/push.js";

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
  if (!user?.email) {
    return res.status(401).json({ error: "login_required" });
  }

  const admin = await getAdminClient();
  if (!admin) {
    return res.status(503).json({ error: "server_not_configured" });
  }

  const email = canonicalShareEmail(user.email);
  await admin.from("bus_push_subscriptions").delete().eq("user_id", user.id).lt(
    "updated_at",
    new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  );

  const pushResult = await sendSharePushToEmail(admin, email, {
    title: "내버스시간표",
    body: "테스트 알림입니다. 잠금화면·상단바에 보이면 정상입니다.",
    url: "/?share=pending",
    requestId: "test",
  });

  return res.status(200).json({ ok: true, email, push: pushResult });
}