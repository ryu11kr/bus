/** GET — 공유 기능 서버 준비 상태 */

import { getAdminClient } from "./_lib/admin.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const hasServiceRole = Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim());
  const admin = await getAdminClient();

  let shareTableReady = false;
  if (admin) {
    const { error } = await admin.from("bus_share_requests").select("id").limit(1);
    shareTableReady = !error;
  }

  return res.status(200).json({
    hasServiceRole,
    shareTableReady,
    acceptNeedsServiceRole: true,
  });
}