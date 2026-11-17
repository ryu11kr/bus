/** Android Web Push (VAPID) */

import { shareEmailLookupKeys } from "./auth.js";

export function getVapidPublicKey() {
  return (process.env.VAPID_PUBLIC_KEY || "").trim();
}

export function isPushConfigured() {
  return Boolean(
    getVapidPublicKey() &&
      (process.env.VAPID_PRIVATE_KEY || "").trim() &&
      (process.env.VAPID_SUBJECT || "").trim()
  );
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {string} toEmail
 * @param {{ title: string, body: string, url?: string, requestId?: string }} payload
 */
export async function sendSharePushToEmail(admin, toEmail, payload) {
  if (!isPushConfigured()) return { sent: 0, skipped: "vapid" };

  const lookupEmails = shareEmailLookupKeys(toEmail);
  const { data: rows, error } = await admin
    .from("bus_push_subscriptions")
    .select("subscription")
    .in("user_email", lookupEmails);
  if (error) throw error;
  if (!rows?.length) {
    return { sent: 0, skipped: "no_subscriptions", lookupEmails };
  }

  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(
    (process.env.VAPID_SUBJECT || "").trim(),
    getVapidPublicKey(),
    (process.env.VAPID_PRIVATE_KEY || "").trim()
  );

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/",
    requestId: payload.requestId || "",
  });

  let sent = 0;
  await Promise.all(
    rows.map(async (row) => {
      const sub = row.subscription;
      if (!sub?.endpoint) return;
      try {
        await webpush.sendNotification(sub, body, {
          TTL: 60 * 60,
          urgency: "high",
        });
        sent += 1;
      } catch (err) {
        console.error("web-push send failed", statusCode(err), err?.body || err?.message);
        const status = err?.statusCode;
        if (status === 404 || status === 410 || status === 403 || status === 401) {
          await admin
            .from("bus_push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint);
        }
      }
    })
  );
  return { sent, skipped: sent ? undefined : "delivery_failed_or_no_endpoint" };
}

function statusCode(err) {
  return err && typeof err === "object" && "statusCode" in err ? err.statusCode : null;
}