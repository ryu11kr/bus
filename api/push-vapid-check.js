/** GET — VAPID 키 형식·짝이 맞는지 (배포 확인용) */

import { getVapidPublicKey, isPushConfigured } from "./_lib/push.js";

function cleanEnvKey(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const publicKey = getVapidPublicKey();
  const privateKey = cleanEnvKey(process.env.VAPID_PRIVATE_KEY);
  const subject = cleanEnvKey(process.env.VAPID_SUBJECT);

  let vapidParseOk = false;
  let vapidParseError = "";
  try {
    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidParseOk = true;
  } catch (err) {
    vapidParseError = String(err?.message || err).slice(0, 200);
  }

  return res.status(200).json({
    configured: isPushConfigured(),
    vapidParseOk,
    vapidParseError: vapidParseError || null,
    publicKeyLength: publicKey.length,
    privateKeyLength: privateKey.length,
    subjectStartsWithMailto: subject.startsWith("mailto:"),
  });
}