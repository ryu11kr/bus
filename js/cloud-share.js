/** 정류장 공유 + Android Web Push */

import { pushLocalStateToCloud, runFullCloudSync } from "./cloud-sync-data.js";

let shareUiBound = false;

const PUSH_OK_STORAGE = "bus-share-push-enabled";
const SHARE_POPUP_DISMISSED_KEY = "bus-share-popup-dismissed";

/** @type {{ id: string, from_email: string } | null} */
let popupCurrentRequest = null;
let sharePopupBound = false;
let shareHintBound = false;

const SHARE_POLL_MS = 12_000;
/** @type {number | null} */
let sharePollTimer = null;
let shareLiveUpdatesBound = false;
let modalScrollLockY = 0;
let modalScrollLockBound = false;

function isBusShareModalOpen() {
  const share = document.querySelector("#bus-share-popup");
  const hint = document.querySelector("#bus-share-hint-dialog");
  return Boolean(share?.open || hint?.open);
}

function syncBusShareModalScrollLock() {
  if (isBusShareModalOpen()) {
    if (!document.body.classList.contains("bus-modal-scroll-lock")) {
      modalScrollLockY = window.scrollY || 0;
      document.body.classList.add("bus-modal-scroll-lock");
      document.body.style.top = `-${modalScrollLockY}px`;
    }
    return;
  }
  if (document.body.classList.contains("bus-modal-scroll-lock")) {
    document.body.classList.remove("bus-modal-scroll-lock");
    document.body.style.top = "";
    window.scrollTo(0, modalScrollLockY);
  }
}

function bindBusShareModalScrollLock() {
  if (modalScrollLockBound) return;
  modalScrollLockBound = true;
  for (const id of ["bus-share-popup", "bus-share-hint-dialog"]) {
    const dialog = document.querySelector(`#${id}`);
    if (!dialog) continue;
    dialog.addEventListener("close", () => {
      syncBusShareModalScrollLock();
    });
  }
}

export function stopIncomingSharePolling() {
  if (sharePollTimer != null) {
    clearInterval(sharePollTimer);
    sharePollTimer = null;
  }
}

/**
 * 앱을 켜 둔 상태에서도 공유 요청·팝업이 뜨도록 주기 조회
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {(text: string) => void} setStatus
 */
export function startIncomingSharePolling(client, setStatus) {
  stopIncomingSharePolling();

  const tick = async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const { data } = await client.auth.getSession();
      const email = normalizeEmail(data.session?.user?.email || "");
      if (!email) return;
      const incoming = document.querySelector("#bus-share-incoming");
      await refreshIncomingShareRequests(client, email, incoming, setStatus);
    } catch (err) {
      console.error(err);
    }
  };

  void tick();
  sharePollTimer = window.setInterval(() => {
    void tick();
  }, SHARE_POLL_MS);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {(text: string) => void} setStatus
 */
export function bindIncomingShareLiveUpdates(client, setStatus) {
  if (shareLiveUpdatesBound || !navigator.serviceWorker) return;
  shareLiveUpdatesBound = true;

  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.type !== "BUS_SHARE_INCOMING") return;
    void (async () => {
      const { data: sess } = await client.auth.getSession();
      const email = normalizeEmail(sess.session?.user?.email || "");
      if (!email) return;
      const incoming = document.querySelector("#bus-share-incoming");
      await refreshIncomingShareRequests(
        client,
        email,
        incoming,
        setStatus,
        typeof data.requestId === "string" ? data.requestId : null
      );
    })();
  });
}

/**
 * @param {string} message
 */
function showBusShareHint(message) {
  const dialog = document.querySelector("#bus-share-hint-dialog");
  const bodyEl = document.querySelector("#bus-share-hint-body");
  const okBtn = document.querySelector("#bus-share-hint-ok");
  if (!dialog || !bodyEl || !okBtn) return;

  if (!shareHintBound) {
    shareHintBound = true;
    okBtn.addEventListener("click", () => {
      if (dialog.open) dialog.close();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      dialog.close();
    });
  }

  bodyEl.textContent = message;
  if (dialog.open) dialog.close();
  bindBusShareModalScrollLock();
  dialog.showModal();
  syncBusShareModalScrollLock();
  okBtn.focus();
}

function canonicalGmailAddress(email) {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") {
    local = local.replace(/\./g, "");
    const plus = local.indexOf("+");
    if (plus >= 0) local = local.slice(0, plus);
  }
  return `${local}@${domain}`;
}

function normalizeEmail(email) {
  let raw = String(email || "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  if (!raw.includes("@")) {
    raw = `${raw}@gmail.com`;
  }
  return canonicalGmailAddress(raw);
}

function applicationServerKeysMatch(a, b) {
  if (!a || !b) return false;
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i += 1) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

function describePushSendResult(push) {
  if (!push) return "";
  if (typeof push.sent === "number" && push.sent > 0) {
    return "\n\n잠금·상단 알림을 보냈습니다.";
  }
  const skipped = push.skipped;
  if (skipped === "no_subscriptions") {
    return (
      "\n\n※ 받는 사람 쪽에 서버 구독이 없습니다.\n" +
      "받는 사람: 홈 화면에 추가(PWA) → 「Android 공유 알림 켜기」 → 「잠금 알림 테스트」"
    );
  }
  if (skipped === "vapid") {
    return "\n\n※ Vercel VAPID 3개가 없어 푸시를 보내지 못했습니다.";
  }
  if (skipped === "delivery_failed_or_no_endpoint") {
    return (
      "\n\n※ 푸시 전송에 실패했습니다. 받는 사람이 「Android 공유 알림 켜기」를 다시 누른 뒤 「잠금 알림 테스트」를 해 보세요."
    );
  }
  return "\n\n※ 잠금 알림이 가지 않았을 수 있습니다.";
}

function isAndroidPushCapable() {
  if (!/android/i.test(navigator.userAgent)) return false;
  return "PushManager" in window && "Notification" in window && "serviceWorker" in navigator;
}

function isInstalledPwa() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    Boolean(navigator.standalone)
  );
}

const ANDROID_NOTIFICATION_HELP =
  "※ 잠금 알림이 어려우면 생략하세요.\n" +
  "공유 받을 때는 **홈 화면 내버스시간표 앱만 켜면** 요청이 뜹니다.\n\n" +
  "--- 잠금 알림까지 받고 싶을 때만 ---\n\n" +
  "1) 홈 화면 **내버스시간표** 아이콘으로 실행\n\n" +
  "2) **맨 위 주소창 왼쪽** (자물쇠 또는 ⓘ) 누르기 → **알림** → **허용**\n" +
  "   (주소 직접 입력하는 칸은 없어도 됩니다. 지금 켜 둔 화면에서만 하면 됩니다.)\n\n" +
  "3) 설정 → 앱 → **Chrome** → 알림 켜기\n\n" +
  "그래도 안 되면 PWA 한계입니다. 앱 켜서 수락하는 방식을 쓰세요.";

export function showAndroidNotificationHelp() {
  showBusShareHint(ANDROID_NOTIFICATION_HELP);
}

function describeNotificationEnvironment() {
  const sw = navigator.serviceWorker?.controller;
  const swUrl = sw?.scriptURL ? new URL(sw.scriptURL, location.href).pathname : "없음";
  return [
    `홈 화면 앱(PWA): ${isInstalledPwa() ? "예" : "아니오 — Chrome 탭이면 잠금 푸시가 거의 안 옵니다"}`,
    `알림 권한: ${typeof Notification !== "undefined" ? Notification.permission : "미지원"}`,
    `서비스 워커: ${sw ? "실행 중" : "없음 (페이지 새로고침 필요)"}`,
    sw ? `워커: ${swUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * FCM 없이 기기·PWA·권한만 검사 (눌렀을 때 바로 떠야 함)
 */
async function runLocalNotificationTest() {
  if (!isAndroidPushCapable()) {
    return "Android PWA에서만 지원합니다.";
  }
  if (Notification.permission !== "granted") {
    return "알림 권한이 허용이 아닙니다.\n설정 → 앱 → 내버스시간표 → 알림을 켜 주세요.";
  }
  const reg = await navigator.serviceWorker.ready;
  const icon = new URL("./icons/icon-192.png", location.href).href;
  const tag = `local-page-${Date.now()}`;
  try {
    await reg.showNotification("기기 알림 테스트", {
      body: "상단·잠금에 이 문구가 보이면 폰 설정은 정상입니다.",
      icon,
      tag,
      renotify: true,
      vibrate: [200, 100, 200],
    });
  } catch (err) {
    console.warn(err);
    reg.active?.postMessage({ type: "LOCAL_NOTIFICATION_TEST" });
  }
  return (
    `${describeNotificationEnvironment()}\n\n` +
    "방금 「기기 알림 테스트」를 띄웠습니다.\n" +
    "3초 안에 상단·알림창에 안 보이면 「삼성·알림 설정 안내」를 누르세요.\n" +
    "(목록에 내버스시간표가 없어도 Chrome 알림을 켜면 됩니다.)"
  );
}

function formatServerPushResult(res) {
  const push = res?.push;
  const lines = [describeNotificationEnvironment(), ""];
  if (!push) {
    lines.push("서버 응답에 push 정보가 없습니다.");
    return lines.join("\n");
  }
  lines.push(`서버 구독 수(시도): ${push.tried ?? "?"}`);
  lines.push(`전송 성공: ${push.sent ?? 0}`);
  if (push.skipped) lines.push(`결과: ${push.skipped}`);
  const failures = Array.isArray(push.failures) ? push.failures : [];
  const onlyStale410 =
    failures.length > 0 && failures.every((f) => f.status === 410);
  const sent = push.sent ?? 0;

  if (failures.length) {
    if (sent > 0 && onlyStale410) {
      lines.push(
        `\n※ 예전에 알림 켰다/끈 적 있어 서버에 옛 토큰이 ${failures.length}개 남아 있었습니다. (본인 잘못 아님)`
      );
      lines.push(`지금 이 기기로는 전송 성공 ${sent}건입니다. 옛 토큰은 서버가 지우는 중입니다.`);
    } else {
      lines.push("\n실패 상세:");
      for (const f of failures) {
        lines.push(
          `• ${f.endpointHost || "?"} HTTP ${f.status ?? "?"}: ${String(f.message || "").slice(0, 120)}`
        );
      }
      const has403 = failures.some((f) => f.status === 403 || f.status === 401);
      if (has403) {
        lines.push(
          "\n403/401 = Vercel VAPID 공개·비밀 키가 짝이 아닙니다.\n" +
            "메뉴얼대로 키를 새로 만들고 세 개를 같이 넣은 뒤 Redeploy 하세요."
        );
      }
      if (onlyStale410) {
        lines.push(
          "\n410 = 만료된 옛 구독입니다. 「알림 꺼졌을 때 · 다시 켜기 준비」 후 「Android 공유 알림 켜기」를 한 번 더 하세요."
        );
      }
    }
  }
  if (sent > 0) {
    lines.push(
      "\n서버는 FCM에 보냈습니다. 10초 안에 알림이 없으면:\n" +
        "먼저 「기기 알림 테스트」가 보이는지 확인하세요.\n" +
        "로컬은 되는데 서버만 안 되면 앱을 완전 종료한 뒤 다시 시도."
    );
  } else if (!failures.length) {
    lines.push("\n구독이 없습니다. 「Android 공유 알림 켜기」를 다시 누르세요.");
  }
  return lines.join("\n");
}

async function hasActivePushSubscription() {
  if (!isAndroidPushCapable() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return Boolean(sub);
  } catch {
    return false;
  }
}

function clearPushOkStorage() {
  try {
    localStorage.removeItem(PUSH_OK_STORAGE);
  } catch {
    /* ignore */
  }
}

/** 알림 끈 뒤 「공유 알림 켜기」가 다시 나오게 */
export async function resetLocalPushRegistration() {
  clearPushOkStorage();
  if (!isAndroidPushCapable()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (err) {
    console.warn("resetLocalPushRegistration", err);
  }
}

const PUSH_ENABLE_LABEL = "Android 공유 알림 켜기";
const PUSH_DENIED_LABEL = "1단계: Chrome에서 알림 허용하기";

function syncPushBanner(perm, showEnable) {
  const banner = document.querySelector("#bus-share-push-banner");
  if (!banner || !isAndroidPushCapable()) {
    if (banner) banner.hidden = true;
    return;
  }
  if (!showEnable) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }
  banner.hidden = false;
  if (perm === "denied") {
    banner.textContent =
      "지금 알림이 차단(denied)입니다. 이 버튼만으로는 허용 팝업이 안 뜹니다. " +
      "먼저 위 주소창 왼쪽 ⓘ/자물쇠 → 알림 → 허용 한 뒤, 다시 아래 버튼을 누르세요.";
    return;
  }
  if (!isInstalledPwa()) {
    banner.textContent =
      "Chrome 탭이 아니라 홈 화면「내버스시간표」아이콘으로 여는 것을 권장합니다. 그래도 아래에서 알림을 켤 수 있습니다.";
    return;
  }
  if (perm === "default") {
    banner.textContent = "아래 버튼을 누르면 알림 허용 팝업이 뜹니다.";
    return;
  }
  banner.textContent = "알림 구독을 다시 등록하려면 아래 버튼을 누르세요.";
}

function expandPushSectionIfNeeded() {
  const details = document.querySelector(".bus-share-push-advanced");
  if (!details || !isAndroidPushCapable()) return;
  if (Notification.permission !== "granted") {
    details.open = true;
  }
}

/**
 * @param {HTMLButtonElement | null} pushBtn
 */
export async function syncPushEnableButton(pushBtn) {
  if (!pushBtn) return;
  if (!isAndroidPushCapable()) {
    pushBtn.hidden = true;
    syncPushBanner("unsupported", false);
    return;
  }

  const perm = Notification.permission;

  if (perm !== "granted") {
    clearPushOkStorage();
    pushBtn.hidden = false;
    pushBtn.textContent = perm === "denied" ? PUSH_DENIED_LABEL : PUSH_ENABLE_LABEL;
    syncPushBanner(perm, true);
    expandPushSectionIfNeeded();
    return;
  }

  const subscribed = await hasActivePushSubscription();
  let markedOk = false;
  try {
    markedOk = localStorage.getItem(PUSH_OK_STORAGE) === "1";
  } catch {
    /* ignore */
  }

  if (subscribed && markedOk) {
    pushBtn.hidden = true;
    syncPushBanner(perm, false);
    return;
  }

  if (!subscribed) {
    clearPushOkStorage();
  }
  pushBtn.textContent = PUSH_ENABLE_LABEL;
  pushBtn.hidden = false;
  syncPushBanner(perm, true);
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
async function fetchVapidPublicKey() {
  const cfgRes = await fetch(new URL("push-public-key", apiBase()), { cache: "no-store" });
  return cfgRes.json();
}

/**
 * 브라우저 구독 + 서버 저장 (권한은 이미 granted 일 때)
 */
async function registerPushSubscriptionOnServer() {
  const cfg = await fetchVapidPublicKey();
  if (!cfg.configured || !cfg.publicKey) return false;

  const reg = await navigator.serviceWorker.ready;
  const desiredKey = urlBase64ToUint8Array(cfg.publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const curKey = sub.options?.applicationServerKey;
    if (curKey && !applicationServerKeysMatch(curKey, desiredKey)) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: desiredKey,
    });
  }

  const subJson = sub.toJSON();
  await authFetch("push-subscribe", {
    method: "POST",
    body: JSON.stringify({ subscription: subJson }),
  });
  return true;
}

/** 로그인 후 구독이 서버에 빠진 경우 보정 */
export async function ensurePushSubscriptionOnServer() {
  if (!isAndroidPushCapable()) return;
  if (Notification.permission !== "granted") return;
  try {
    const ok = await registerPushSubscriptionOnServer();
    if (ok) {
      try {
        localStorage.setItem(PUSH_OK_STORAGE, "1");
      } catch {
        /* ignore */
      }
      const pushBtn = document.querySelector("#bus-share-push-enable");
      if (pushBtn) pushBtn.hidden = true;
    }
  } catch (err) {
    console.warn("ensurePushSubscriptionOnServer", err);
  }
}

/**
 * @param {(text: string) => void} [setStatus]
 */
export async function refreshPushReadiness(setStatus) {
  if (!isAndroidPushCapable()) return;
  const testBtn = document.querySelector("#bus-share-push-test");
  const localTestBtn = document.querySelector("#bus-share-push-local-test");
  if (localTestBtn) {
    localTestBtn.hidden = Notification.permission !== "granted";
  }
  try {
    const st = await authFetch("push-status");
    if (testBtn) {
      testBtn.hidden = !(st.readyForLockScreenPush || Notification.permission === "granted");
    }
    if (st.readyForLockScreenPush) {
      return;
    }
    const parts = [];
    if (!st.vapidConfigured) parts.push("서버 VAPID 미설정");
    if ((st.subscriptionCount ?? 0) < 1) {
      parts.push("서버에 이 기기 구독 없음 → 「Android 공유 알림 켜기」");
    }
    if (parts.length) setStatus?.(parts.join(" · "));
  } catch (err) {
    console.warn("refreshPushReadiness", err);
    if (testBtn) testBtn.hidden = true;
  }
}

export async function tryEnableAndroidPush(client, session, setStatus) {
  if (!isAndroidPushCapable()) {
    setStatus?.(
      "Android Chrome·삼성 인터넷에서 PWA(홈 화면 추가) 후에만 푸시를 켤 수 있습니다."
    );
    return false;
  }
  if (!isInstalledPwa()) {
    showBusShareHint(
      "지금은 Chrome **탭**으로 열린 상태입니다.\n\n" +
        "잠금화면 푸시는 **홈 화면에 추가한 내버스시간표 아이콘**으로 실행해야 합니다.\n\n" +
        "설치 → 그 아이콘으로 다시 로그인 → 「Android 공유 알림 켜기」"
    );
    return false;
  }
  if (Notification.permission === "denied") {
    showBusShareHint(
      "알림이 **차단(denied)** 이라 이 화면에서는 허용 팝업이 안 뜹니다.\n\n" +
        "【지금 이 Chrome 탭에서】\n" +
        "맨 위 주소창 **왼쪽 ⓘ 또는 자물쇠** 누르기 → **알림** → **허용**\n\n" +
        "허용한 뒤 이 페이지로 돌아와서\n" +
        "「Android 공유 알림 켜기」를 다시 누르세요.\n\n" +
        "ⓘ 메뉴가 없으면: Chrome ⋮ → 설정 → 사이트 설정 → 알림 → bus.uxpwa.com → 허용"
    );
    return false;
  }

  setStatus?.("푸시 설정 확인 중…");
  try {
    const cfg = await fetchVapidPublicKey();
    if (!cfg.configured || !cfg.publicKey) {
      setStatus?.(
        "서버에 VAPID 키가 없습니다. Vercel에 VAPID_PUBLIC_KEY·PRIVATE_KEY·SUBJECT 넣고 Redeploy (메뉴얼-정류장공유-Vercel넣기.md)."
      );
      return false;
    }
  } catch (err) {
    console.error(err);
    setStatus?.("푸시 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
    return false;
  }

  const perm =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
  if (perm !== "granted") {
    setStatus?.("알림 권한이 없어 공유 푸시를 받을 수 없습니다.");
    return false;
  }

  try {
    await navigator.serviceWorker.ready;
    await registerPushSubscriptionOnServer();
  } catch (err) {
    console.error(err);
    setStatus?.(
      "푸시 등록에 실패했습니다. 홈 화면에 추가했는지 확인하고, 삼성 인터넷이면 최신 버전인지 확인해 주세요."
    );
    return false;
  }

  setStatus?.("Android 공유 알림을 켰습니다. 이제 앱을 닫아도 공유 요청 알림을 받을 수 있습니다.");
  try {
    localStorage.setItem(PUSH_OK_STORAGE, "1");
  } catch {
    /* ignore */
  }
  const pushBtn = document.querySelector("#bus-share-push-enable");
  if (pushBtn) pushBtn.hidden = true;
  await refreshPushReadiness(setStatus);
  void session;
  void client;
  return true;
}

function getDismissedPopupIds() {
  try {
    const raw = sessionStorage.getItem(SHARE_POPUP_DISMISSED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function markPopupDismissed(requestId) {
  const s = getDismissedPopupIds();
  s.add(String(requestId));
  try {
    sessionStorage.setItem(SHARE_POPUP_DISMISSED_KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} userEmail
 * @param {HTMLElement | null} listEl
 * @param {(text: string) => void} setStatus
 * @param {string} requestId
 */
async function acceptShareRequest(client, userEmail, listEl, setStatus, requestId) {
  setStatus?.("정류장을 가져오는 중…");
  try {
    await authFetch("share-accept", {
      method: "POST",
      body: JSON.stringify({ requestId }),
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
  markPopupDismissed(requestId);
  setStatus?.("공유한 정류장을 내 목록에 반영했습니다.");
  await refreshIncomingShareRequests(client, userEmail, listEl, setStatus, requestId);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} userEmail
 * @param {HTMLElement | null} listEl
 * @param {(text: string) => void} setStatus
 * @param {string} requestId
 */
async function rejectShareRequest(client, userEmail, listEl, setStatus, requestId) {
  await authFetch("share-reject", {
    method: "POST",
    body: JSON.stringify({ requestId }),
  });
  markPopupDismissed(requestId);
  await refreshIncomingShareRequests(client, userEmail, listEl, setStatus, requestId);
}

/**
 * @param {Array<{ id: string, from_email: string }>} pendingRows
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} userEmail
 * @param {HTMLElement | null} listEl
 * @param {(text: string) => void} setStatus
 * @param {string | null} preferRequestId
 */
function maybeShowSharePopup(pendingRows, client, userEmail, listEl, setStatus, preferRequestId) {
  const dialog = document.querySelector("#bus-share-popup");
  const bodyEl = document.querySelector("#bus-share-popup-body");
  if (!dialog || !bodyEl || !pendingRows?.length) return;

  const params = new URLSearchParams(window.location.search);
  const forceFromUrl = params.get("share") === "pending";
  const urlRequestId = params.get("requestId");
  const targetId = preferRequestId || urlRequestId;
  const dismissed = getDismissedPopupIds();

  let row = null;
  if (targetId) {
    row = pendingRows.find((r) => String(r.id) === String(targetId)) || null;
  }
  if (!row && forceFromUrl) {
    row = pendingRows[0];
  }
  if (!row) {
    row = pendingRows.find((r) => !dismissed.has(String(r.id))) || null;
  }
  if (!row) return;
  if (dialog.open && popupCurrentRequest?.id === row.id) return;

  popupCurrentRequest = { id: String(row.id), from_email: row.from_email };
  bodyEl.textContent = `${row.from_email} 님이 버스 정류장 정보를 공유했습니다.`;
  bindSharePopupOnce(client, userEmail, listEl, setStatus);
  bindBusShareModalScrollLock();
  dialog.showModal();
  syncBusShareModalScrollLock();

  const teaser = document.querySelector("#cloud-sync-teaser");
  if (teaser && !teaser.open) {
    teaser.open = true;
  }

  if (forceFromUrl || urlRequestId) {
    try {
      params.delete("share");
      params.delete("requestId");
      const q = params.toString();
      const path = `${window.location.pathname}${q ? `?${q}` : ""}`;
      window.history.replaceState({}, document.title, path);
    } catch {
      /* ignore */
    }
  }
}

function bindSharePopupOnce(client, userEmail, listEl, setStatus) {
  if (sharePopupBound) return;
  sharePopupBound = true;

  const dialog = document.querySelector("#bus-share-popup");
  const acceptBtn = document.querySelector("#bus-share-popup-accept");
  const rejectBtn = document.querySelector("#bus-share-popup-reject");
  const laterBtn = document.querySelector("#bus-share-popup-later");
  if (!dialog || !acceptBtn || !rejectBtn || !laterBtn) return;

  const closeDialog = () => {
    if (dialog.open) dialog.close();
    popupCurrentRequest = null;
  };

  laterBtn.addEventListener("click", () => {
    if (popupCurrentRequest?.id) markPopupDismissed(popupCurrentRequest.id);
    closeDialog();
  });

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (popupCurrentRequest?.id) markPopupDismissed(popupCurrentRequest.id);
    closeDialog();
  });

  acceptBtn.addEventListener("click", async () => {
    if (!popupCurrentRequest?.id) return;
    const requestId = popupCurrentRequest.id;
    acceptBtn.disabled = true;
    rejectBtn.disabled = true;
    laterBtn.disabled = true;
    try {
      await acceptShareRequest(client, userEmail, listEl, setStatus, requestId);
      closeDialog();
    } catch (err) {
      console.error(err);
      setStatus?.(describeShareError(err));
    } finally {
      acceptBtn.disabled = false;
      rejectBtn.disabled = false;
      laterBtn.disabled = false;
    }
  });

  rejectBtn.addEventListener("click", async () => {
    if (!popupCurrentRequest?.id) return;
    const requestId = popupCurrentRequest.id;
    acceptBtn.disabled = true;
    rejectBtn.disabled = true;
    laterBtn.disabled = true;
    try {
      await rejectShareRequest(client, userEmail, listEl, setStatus, requestId);
      closeDialog();
    } catch (err) {
      console.error(err);
      setStatus?.("거절하지 못했습니다.");
    } finally {
      acceptBtn.disabled = false;
      rejectBtn.disabled = false;
      laterBtn.disabled = false;
    }
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} userEmail
 * @param {HTMLElement} listEl
 * @param {(text: string) => void} setStatus
 * @param {string | null} [preferRequestId]
 */
export async function refreshIncomingShareRequests(
  client,
  userEmail,
  listEl,
  setStatus,
  preferRequestId = null
) {
  const email = normalizeEmail(userEmail);
  if (!email) {
    if (listEl) {
      listEl.hidden = true;
      listEl.replaceChildren();
    }
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

  if (listEl) {
    listEl.replaceChildren();
    if (!data?.length) {
      listEl.hidden = true;
      maybeShowSharePopup([], client, userEmail, listEl, setStatus, preferRequestId);
      return;
    }
    listEl.hidden = false;
  }

  if (!data?.length) {
    return;
  }

  maybeShowSharePopup(data, client, userEmail, listEl, setStatus, preferRequestId);

  if (!listEl) return;
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
      try {
        await acceptShareRequest(client, userEmail, listEl, setStatus, row.id);
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
        await rejectShareRequest(client, userEmail, listEl, setStatus, row.id);
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
  const pushTestBtn = document.querySelector("#bus-share-push-test");
  const pushLocalTestBtn = document.querySelector("#bus-share-push-local-test");
  const pushHelpBtn = document.querySelector("#bus-share-push-help");
  const pushResetBtn = document.querySelector("#bus-share-push-reset");

  if (!root || !session?.user) {
    if (root) root.hidden = true;
    return;
  }

  root.hidden = false;
  bindBusShareModalScrollLock();

  if (!shareUiBound) {
    shareUiBound = true;

    if (pushBtn) {
      pushBtn.addEventListener("click", () => {
        if (Notification.permission === "denied") {
          showBusShareHint(
            "먼저 주소창 **왼쪽 ⓘ/자물쇠 → 알림 → 허용** 하세요.\n\n" +
              "차단 상태에서는 앱이 허용 창을 띄울 수 없습니다."
          );
          return;
        }
        pushBtn.disabled = true;
        setStatus?.("알림 설정 중…");
        tryEnableAndroidPush(client, session, setStatus)
          .catch((err) => {
            console.error(err);
            setStatus?.(describeShareError(err));
          })
          .finally(() => {
            pushBtn.disabled = false;
            void syncPushEnableButton(pushBtn);
          });
      });
    }

    if (pushHelpBtn) {
      pushHelpBtn.addEventListener("click", () => showAndroidNotificationHelp());
    }

    if (pushResetBtn) {
      pushResetBtn.addEventListener("click", () => {
        pushResetBtn.disabled = true;
        void resetLocalPushRegistration()
          .then(() => syncPushEnableButton(pushBtn))
          .then(async () => {
            await syncPushEnableButton(pushBtn);
            const perm = Notification.permission;
            const msg =
              perm === "denied"
                ? "초기화했습니다. 알림이 **차단** 상태입니다.\n\n" +
                  "주소창 왼쪽 ⓘ → 알림 **허용** 후\n" +
                  "「Android 공유 알림 켜기」를 누르세요."
                : "초기화했습니다.\n\n「Android 공유 알림 켜기」 버튼이 보이면 눌러 허용하세요.";
            showBusShareHint(msg);
          })
          .finally(() => {
            pushResetBtn.disabled = false;
          });
      });
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || !pushBtn) return;
      void syncPushEnableButton(pushBtn);
    });

    if (pushLocalTestBtn) {
      pushLocalTestBtn.addEventListener("click", () => {
        pushLocalTestBtn.disabled = true;
        runLocalNotificationTest()
          .then((msg) => showBusShareHint(msg))
          .catch((err) => {
            console.error(err);
            showBusShareHint(
              `로컬 알림 실패: ${err?.message || err}\n\n${describeNotificationEnvironment()}`
            );
          })
          .finally(() => {
            pushLocalTestBtn.disabled = false;
          });
      });
    }

    if (pushTestBtn) {
      pushTestBtn.addEventListener("click", () => {
        pushTestBtn.disabled = true;
        setStatus?.("서버 푸시 테스트 중…");
        authFetch("push-test-self", { method: "POST", body: "{}" })
          .then((res) => {
            setStatus?.("");
            showBusShareHint(formatServerPushResult(res));
          })
          .catch((err) => {
            console.error(err);
            showBusShareHint(
              `서버 요청 실패: ${err?.message || err}\n\n${describeNotificationEnvironment()}`
            );
          })
          .finally(() => {
            pushTestBtn.disabled = false;
          });
      });
    }

    if (sendBtn && sendInput) {
      sendBtn.addEventListener("click", async () => {
        const raw = String(sendInput.value || "").trim();
        if (!raw) {
          showBusShareHint("받을 사람 Gmail을 입력해 주세요.");
          sendInput.focus();
          return;
        }
        const toEmail = normalizeEmail(raw);
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
          let hint =
            "공유 요청을 보냈습니다. 상대가 수락하면 각자 목록에 반영됩니다.";
          try {
            const notifyRes = await authFetch("share-notify", {
              method: "POST",
              body: JSON.stringify({ requestId }),
            });
            hint += describePushSendResult(notifyRes?.push);
          } catch (pushErr) {
            console.warn(pushErr);
            hint += "\n\n(잠금 알림 서버 연결 실패 — 공유 요청 자체는 보냈습니다.)";
          }
          sendInput.value = "";
          setStatus?.("");
          showBusShareHint(hint);
        } catch (err) {
          console.error(err);
          setStatus?.(describeShareError(err));
        } finally {
          sendBtn.disabled = false;
        }
      });
    }
  }

  void syncPushEnableButton(pushBtn);
  void refreshPushReadiness(setStatus);

  const params = new URLSearchParams(window.location.search);
  if (params.get("share") === "pending" && incomingEl) {
    incomingEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}