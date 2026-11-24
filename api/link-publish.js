/** POST { stop } — 공개 링크 토큰 발급 (로그인 불필요) */

import { getAdminClient } from "./_lib/admin.js";
import { sanitizeStopForLink } from "./_lib/linkStopPayload.js";

const TTL_DAYS = 180;
const MAX_PHOTOS = 12;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const admin = await getAdminClient();
  if (!admin) {
    return res.status(503).json({ error: "server_not_configured" });
  }

  const stop = sanitizeStopForLink(req.body?.stop);
  if (!stop) {
    return res.status(400).json({ error: "invalid_stop" });
  }
  if (stop.photos.length > MAX_PHOTOS) {
    return res.status(400).json({ error: "too_many_photos" });
  }

  const token = crypto.randomUUID();
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + TTL_DAYS);

  const { error } = await admin.from("bus_link_shares").insert({
    token,
    stop_name: stop.name,
    payload: stop,
    expires_at: expires.toISOString(),
  });

  if (error) {
    console.error("bus_link_shares insert", error);
    return res.status(500).json({
      error: "insert_failed",
      message: error.message,
    });
  }

  return res.status(200).json({
    token,
    expiresAt: expires.toISOString(),
  });
}