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
  const body = {
    configured: isPushConfigured(),
    publicKey: publicKey || null,
  };

  const diagnose =
    req.query?.diagnose === "1" ||
    String(req.url || "").includes("push-vapid-check");
  if (diagnose) {
    const privateKey = String(process.env.VAPID_PRIVATE_KEY || "")
      .trim()
      .replace(/^["']|["']$/g, "");
    const subject = String(process.env.VAPID_SUBJECT || "")
      .trim()
      .replace(/^["']|["']$/g, "");
    let vapidParseOk = false;
    let vapidParseError = "";
    try {
      const webpush = (await import("web-push")).default;
      webpush.setVapidDetails(subject, publicKey, privateKey);
      vapidParseOk = true;
    } catch (err) {
      vapidParseError = String(err?.message || err).slice(0, 200);
    }
    Object.assign(body, {
      vapidParseOk,
      vapidParseError: vapidParseError || null,
      publicKeyLength: publicKey.length,
      privateKeyLength: privateKey.length,
      subjectStartsWithMailto: subject.startsWith("mailto:"),
    });
  }

  return res.status(200).json(body);
}