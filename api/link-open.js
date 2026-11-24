/** GET ?token= — 공개 링크로 정류장 읽기 (로그인 불필요) */

import { getAdminClient } from "./_lib/admin.js";
import { sanitizeStopForLink } from "./_lib/linkStopPayload.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  const token = String(req.query?.token || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return res.status(400).json({ error: "invalid_token" });
  }

  const admin = await getAdminClient();
  if (!admin) {
    return res.status(503).json({ error: "server_not_configured" });
  }

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("bus_link_shares")
    .select("payload, expires_at")
    .eq("token", token)
    .gt("expires_at", now)
    .maybeSingle();

  if (error) {
    console.error("bus_link_shares select", error);
    return res.status(500).json({ error: "read_failed" });
  }
  if (!data?.payload) {
    return res.status(404).json({ error: "not_found_or_expired" });
  }

  const stop = sanitizeStopForLink(data.payload);
  if (!stop) {
    return res.status(500).json({ error: "corrupt_payload" });
  }

  return res.status(200).json({ stop, expiresAt: data.expires_at });
}