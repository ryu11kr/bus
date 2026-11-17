/** 정류장 공유 + Android Web Push */

import { pushLocalStateToCloud, runFullCloudSync } from "./cloud-sync-data.js";

let shareUiBound = false;

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
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
        await authFetch("share-accept", {
          method: "POST",
          body: JSON.stringify({ requestId: row.id }),
        });
        const userId = (await client.auth.getSession()).data.session?.user?.id;
        if (userId) {
          await runFullCloudSync(client, userId);
        }
        setStatus?.("공유한 정류장을 내 목록에 반영했습니다.");
        await refreshIncomingShareRequests(client, userEmail, listEl, setStatus);
      } catch (err) {
        console.error(err);
        setStatus?.("가져오지 못했습니다. 잠시 후 다시 시도해 주세요.");
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
          if (!userId) throw new Error("login_required");
          await pushLocalStateToCloud(client, userId);
          await authFetch("share-send", {
            method: "POST",
            body: JSON.stringify({ toEmail }),
          });
          sendInput.value = "";
          setStatus?.("공유 요청을 보냈습니다. 상대가 수락하면 각자 목록에 반영됩니다.");
        } catch (err) {
          console.error(err);
          if (err.code === "no_stops") {
            setStatus?.("등록한 정류장이 없습니다. 먼저 사진을 등록해 주세요.");
          } else if (err.code === "self_share") {
            setStatus?.("본인 이메일로는 보낼 수 없습니다.");
          } else if (err.code === "server_not_configured") {
            setStatus?.("서버에 SUPABASE_SERVICE_ROLE_KEY가 필요합니다. 메뉴얼을 확인해 주세요.");
          } else {
            setStatus?.("공유를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.");
          }
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