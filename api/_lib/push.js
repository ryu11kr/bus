/** Android Web Push (VAPID) */

import { shareEmailLookupKeys } from "./auth.js";

function cleanEnvKey(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

export function getVapidPublicKey() {
  return cleanEnvKey(process.env.VAPID_PUBLIC_KEY);
}

export function isPushConfigured() {
  return Boolean(
    getVapidPublicKey() &&
      cleanEnvKey(process.env.VAPID_PRIVATE_KEY) &&
      cleanEnvKey(process.env.VAPID_SUBJECT)
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
    .select("subscription, updated_at")
    .in("user_email", lookupEmails)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  if (!rows?.length) {
    return { sent: 0, skipped: "no_subscriptions", lookupEmails };
  }

  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(
    cleanEnvKey(process.env.VAPID_SUBJECT),
    getVapidPublicKey(),
    cleanEnvKey(process.env.VAPID_PRIVATE_KEY)
  );

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/",
    requestId: payload.requestId || "",
  });

  let sent = 0;
  /** @type {{ status: number | null, message: string, endpointHost: string }[]} */
  const failures = [];
  await Promise.all(
    rows.map(async (row) => {
      const sub = row.subscription;
      if (!sub?.endpoint) {
        failures.push({
          status: null,
          message: "missing_endpoint",
          endpointHost: "",
        });
        return;
      }
      let endpointHost = "";
      try {
        endpointHost = new URL(sub.endpoint).host;
      } catch {
        endpointHost = "?";
      }
      try {
        await webpush.sendNotification(sub, body, {
          TTL: 60 * 60,
          urgency: "high",
        });
        sent += 1;
      } catch (err) {
        const status = statusCode(err);
        const msg = String(err?.body || err?.message || "send_failed").slice(0, 400);
        console.error("web-push send failed", status, msg);
        failures.push({ status, message: msg, endpointHost });
        if (status === 404 || status === 410 || status === 403 || status === 401) {
          await admin
            .from("bus_push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint);
        }
      }
    })
  );
  return {
    sent,
    tried: rows.length,
    failures,
    skipped: sent ? undefined : "delivery_failed_or_no_endpoint",
  };
}

function statusCode(err) {
  return err && typeof err === "object" && "statusCode" in err ? err.statusCode : null;
}