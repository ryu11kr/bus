/** GET — VAPID 공개키 (Android Web Push) */

import { getVapidPublicKey, isPushConfigured } from "./_lib/push.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  const publicKey = getVapidPublicKey();
  return res.status(200).json({
    configured: isPushConfigured(),
    publicKey: publicKey || null,
  });
}