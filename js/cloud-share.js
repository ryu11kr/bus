/** 정류장 공유 + Android Web Push */

import { pushLocalStateToCloud, runFullCloudSync } from "./cloud-sync-data.js";

let shareUiBound = false;

function normalizeEmail(email) {
  let raw = String(email || "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  if (!raw.includes("@")) {
    raw = `${raw}@gmail.com`;
  }
  return raw;
}

function isAndroidPushCapable() {
  if (!/android/i.test(navigator.userAgent)) return false;
  return "PushManager" in window && "Notification" in window && "serviceWorker" in navigator;
}

function apiBase() {
  return new URL("./api/", window.location.href).href;
}

async function authFetch(path, options = {}) {
  const client = window.getSupabaseClient?.();
  if (!client) throw new Error("no_client");
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("login_required");

  const res = await fetch(new URL(path, apiBase()), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.message || json.error || res.statusText);
    err.code = json.error;
    throw err;
  }
  return json;
}

function describeShareError(err) {
  const code = err?.code || err?.message;
  if (code === "no_stops") {
    return "클라우드에 저장된 정류장이 없습니다. 사진 등록 후 잠시 기다렸다가 다시 보내 주세요.";
  }
  if (code === "self_share") return "본인 이메일로는 보낼 수 없습니다.";
  if (code === "invalid_email") return "Gmail 형식을 확인해 주세요.";
  if (code === "login_required") return "다시 구글 로그인 후 시도해 주세요.";
  if (code === "server_not_configured") {
    return "Vercel에 SUPABASE_SERVICE_ROLE_KEY를 넣고 Redeploy 해 주세요. (수락할 때 필요, 메뉴얼-정류장공유-Vercel넣기.md)";
  }
  if (code === "insert_failed" || code === "PGRST205") {
    return "Supabase SQL Editor에서 bus-share-setup.sql 전체를 Run 해 주세요.";
  }
  if (String(err?.message || "").includes("bus_share_requests")) {
    return "Supabase SQL Editor에서 bus-share-setup.sql 전체를 Run 해 주세요.";
  }
  if (err?.message) return `공유 실패: ${err.message}`;
  return "공유를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} userId
 * @param {string} fromEmail
 * @param {string} toEmail
 */
async function sendShareRequestViaClient(client, userId, fromEmail, toEmail) {
  const { data: cloudRow, error: cloudErr } = await client
    .from("bus_user_data")
    .select("stops")
    .eq("user_id", userId)
    .maybeSingle();
  if (cloudErr) throw cloudErr;

  const stops = Array.isArray(cloudRow?.stops) ? cloudRow.stops : [];
  if (!stops.length) {
    const err = new Error("no_stops");
    err.code = "no_stops";
    throw err;
  }

  await client
    .from("bus_share_requests")
    .update({ status: "cancelled", responded_at: new Date().toISOString() })
    .eq("from_user_id", userId)
    .eq("to_email", toEmail)
    .eq("status", "pending");

  const { data: row, error: insErr } = await client
    .from("bus_share_requests")
    .insert({
      from_user_id: userId,
      from_email: fromEmail,
      to_email: toEmail,
      status: "pending",
    })
    .select("id")
    .single();
  if (insErr) throw insErr;
  return row.id;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {import("@supabase/supabase-js").Session} session
 * @param {(text: string) => void} setStatus
 */
export async function tryEnableAndroidPush(client, session, setStatus) {
  if (!isAndroidPushCapable()) return;
  if (Notification.permission === "denied") return;

  const cfgRes = await fetch(new URL("push-public-key", apiBase()), { cache: "no-store" });
  const cfg = await cfgRes.json();
  if (!cfg.configured || !cfg.publicKey) return;

  const perm =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
  if (perm !== "granted") {
    setStatus?.("알림 권한이 없어 공유 푸시를 받을 수 없습니다.");
    return;
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
    });
  }

  await authFetch("push-subscribe", {
    method: "POST",
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  setStatus?.("Android 공유 알림을 켰습니다.");
  void session;
  void client;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} userEmail
 * @param {HTMLElement} listEl
 * @param {(text: string) => void} setStatus
 */
export async function refreshIncomingShareRequests(client, userEmail, listEl, setStatus) {
  if (!listEl) return;
  const email = normalizeEmail(userEmail);
  if (!email) {
    listEl.hidden = true;
    listEl.replaceChildren();
    return;
  }

  const { data, error } = await client
    .from("bus_share_requests")
    .select("id, from_email, created_at")
    .eq("status", "pending")
    .eq("to_email", email)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    setStatus?.("공유 요청을 불러오지 못했습니다.");
    return;
  }

  listEl.replaceChildren();
  if (!data?.length) {
    listEl.hidden = true;
    return;
  }

  listEl.hidden = false;
  for (const row of data) {
    const card = document.createElement("div");
    card.className = "bus-share-incoming-card";
    card.dataset.requestId = row.id;

    const text = document.createElement("p");
    text.className = "bus-share-incoming-text";
    text.textContent = `${row.from_email} 님이 정류장을 공유했습니다.`;

    const actions = document.createElement("div");
    actions.className = "bus-share-incoming-actions";

    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "big-btn primary bus-share-accept";
    acceptBtn.textContent = "수락";

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className = "big-btn ghost bus-share-reject";
    rejectBtn.textContent = "거절";

    acceptBtn.addEventListener("click", async () => {
      acceptBtn.disabled = true;
      rejectBtn.disabled = true;
      setStatus?.("정류장을 가져오는 중…");
      try {
        try {
          await authFetch("share-accept", {
            method: "POST",
            body: JSON.stringify({ requestId: row.id }),
          });
        } catch (accErr) {
          if (accErr.code === "server_not_configured") {
            throw Object.assign(new Error("server_not_configured"), accErr);
          }
          throw accErr;
        }
        const userId = (await client.auth.getSession()).data.session?.user?.id;
        if (userId) {
          await runFullCloudSync(client, userId);
        }
        setStatus?.("공유한 정류장을 내 목록에 반영했습니다.");
        await refreshIncomingShareRequests(client, userEmail, listEl, setStatus);
      } catch (err) {
        console.error(err);
        setStatus?.(describeShareError(err));
        acceptBtn.disabled = false;
        rejectBtn.disabled = false;
      }
    });

    rejectBtn.addEventListener("click", async () => {
      acceptBtn.disabled = true;
      rejectBtn.disabled = true;
      try {
        await authFetch("share-reject", {
          method: "POST",
          body: JSON.stringify({ requestId: row.id }),
        });
        await refreshIncomingShareRequests(client, userEmail, listEl, setStatus);
      } catch (err) {
        console.error(err);
        setStatus?.("거절하지 못했습니다.");
        acceptBtn.disabled = false;
        rejectBtn.disabled = false;
      }
    });

    actions.append(acceptBtn, rejectBtn);
    card.append(text, actions);
    listEl.append(card);
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {import("@supabase/supabase-js").Session} session
 * @param {(text: string) => void} setStatus
 */
export function initBusShareUi(client, session, setStatus) {
  const root = document.querySelector("#bus-share-panel");
  const sendInput = document.querySelector("#bus-share-to-email");
  const sendBtn = document.querySelector("#bus-share-send");
  const incomingEl = document.querySelector("#bus-share-incoming");
  const pushBtn = document.querySelector("#bus-share-push-enable");

  if (!root || !session?.user) {
    if (root) root.hidden = true;
    return;
  }

  root.hidden = false;

  if (!shareUiBound) {
    shareUiBound = true;

    if (pushBtn) {
      pushBtn.hidden = !isAndroidPushCapable();
      pushBtn.addEventListener("click", () => {
        pushBtn.disabled = true;
        tryEnableAndroidPush(client, session, setStatus)
          .catch((err) => console.error(err))
          .finally(() => {
            pushBtn.disabled = false;
          });
      });
    }

    if (sendBtn && sendInput) {
      sendBtn.addEventListener("click", async () => {
        const toEmail = normalizeEmail(sendInput.value);
        if (!toEmail) {
          setStatus?.("받을 사람 Gmail을 입력해 주세요.");
          return;
        }
        sendBtn.disabled = true;
        setStatus?.("클라우드에 저장한 뒤 공유합니다…");
        try {
          const { data: sess } = await client.auth.getSession();
          const userId = sess.session?.user?.id;
          const fromEmail = normalizeEmail(sess.session?.user?.email || "");
          if (!userId || !fromEmail) {
            const e = new Error("login_required");
            e.code = "login_required";
            throw e;
          }
          if (toEmail === fromEmail) {
            const e = new Error("self_share");
            e.code = "self_share";
            throw e;
          }
          await pushLocalStateToCloud(client, userId);
          const requestId = await sendShareRequestViaClient(client, userId, fromEmail, toEmail);
          try {
            await authFetch("share-notify", {
              method: "POST",
              body: JSON.stringify({ requestId }),
            });
          } catch (pushErr) {
            console.warn(pushErr);
          }
          sendInput.value = "";
          setStatus?.("공유 요청을 보냈습니다. 상대가 수락하면 각자 목록에 반영됩니다.");
        } catch (err) {
          console.error(err);
          setStatus?.(describeShareError(err));
        } finally {
          sendBtn.disabled = false;
        }
      });
    }
  }

  if (pushBtn) pushBtn.hidden = !isAndroidPushCapable();

  const params = new URLSearchParams(window.location.search);
  if (params.get("share") === "pending" && incomingEl) {
    incomingEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}