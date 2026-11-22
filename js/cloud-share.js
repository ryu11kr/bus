/** 정류장 공유 — 앱 안 팝업·목록 (잠금 화면 푸시 없음) */

import {
  getLocalBusStopCount,
  pushLocalStateToCloud,
  runFullCloudSync,
} from "./cloud-sync-data.js";

let shareUiBound = false;

const SHARE_POPUP_DISMISSED_KEY = "bus-share-popup-dismissed";

/** @type {{ id: string, from_email: string } | null} */
let popupCurrentRequest = null;
let sharePopupBound = false;
let shareHintBound = false;

const SHARE_POLL_MS = 5_000;
/** @type {number | null} */
let sharePollTimer = null;
let modalScrollLockY = 0;
let modalScrollLockBound = false;

function isBusShareModalOpen() {
  const share = document.querySelector("#bus-share-popup");
  const hint = document.querySelector("#bus-share-hint-dialog");
  return Boolean(share?.open || hint?.open);
}

function isBusFormNameOrLabelDialogOpen() {
  const stopName = document.querySelector("#stop-name-dialog");
  const photoLabel = document.querySelector("#photo-label-dialog");
  const statusDialog = document.querySelector("#bus-status-dialog");
  return Boolean(stopName?.open || photoLabel?.open || statusDialog?.open);
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
  if (isBusFormNameOrLabelDialogOpen()) return;
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

function yieldToPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

let shareAcceptBusyActive = false;

function resetSharePopupBusyUi() {
  const popup = document.querySelector("#bus-share-popup");
  const actions = popup?.querySelector(".bus-share-popup-actions");
  popup?.classList.remove("is-busy");
  if (actions) actions.hidden = false;
}

/**
 * @param {string} message
 * @param {(text: string) => void} [setStatus]
 */
function showShareAcceptBusy(message, setStatus) {
  shareAcceptBusyActive = true;
  setStatus?.(message);
  const popup = document.querySelector("#bus-share-popup");
  const bodyEl = document.querySelector("#bus-share-popup-body");
  if (popup?.open) {
    popup.classList.add("is-busy");
    const actions = popup.querySelector(".bus-share-popup-actions");
    if (actions) actions.hidden = true;
    if (bodyEl) bodyEl.textContent = message;
    return;
  }
  const overlay = document.querySelector("#bus-share-busy");
  const textEl = document.querySelector("#bus-share-busy-text");
  if (overlay && textEl) {
    textEl.textContent = message;
    overlay.hidden = false;
    overlay.setAttribute("aria-busy", "true");
  }
}

/**
 * @param {(text: string) => void} [setStatus]
 */
function hideShareAcceptBusy(setStatus) {
  if (!shareAcceptBusyActive) return;
  shareAcceptBusyActive = false;
  const overlay = document.querySelector("#bus-share-busy");
  if (overlay) {
    overlay.hidden = true;
    overlay.setAttribute("aria-busy", "false");
  }
  resetSharePopupBusyUi();
  setStatus?.("");
}

/** 소문자만 맞춤. 받는 사람 Gmail은 로그인 주소와 글자 그대로 같아야 함 */
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

function apiBase() {
  return new URL("./api/", window.location.href).href;
}

export async function authFetch(path, options = {}) {
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
  showShareAcceptBusy("공유를 수락하는 중…", setStatus);
  await yieldToPaint();
  try {
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
    showShareAcceptBusy("정류장을 가져오는 중…", setStatus);
    await yieldToPaint();
    const userId = (await client.auth.getSession()).data.session?.user?.id;
    if (userId) {
      await runFullCloudSync(client, userId);
    }
    markPopupDismissed(requestId);
    showBusShareHint("공유받은 정류장을 내 목록에 반영했습니다.");
    await refreshIncomingShareRequests(client, userEmail, listEl, setStatus, requestId);
  } finally {
    hideShareAcceptBusy(setStatus);
  }
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
    const hit = pendingRows.find((r) => String(r.id) === String(targetId)) || null;
    if (hit && (forceFromUrl || !dismissed.has(String(hit.id)))) {
      row = hit;
    }
  }
  if (!row && forceFromUrl) {
    row = pendingRows[0];
  }
  if (!row) {
    row = pendingRows.find((r) => !dismissed.has(String(r.id))) || null;
  }
  if (!row) return;
  if (dismissed.has(String(row.id)) && !forceFromUrl) return;
  if (dialog.open && popupCurrentRequest?.id === row.id) return;

  popupCurrentRequest = { id: String(row.id), from_email: row.from_email };
  resetSharePopupBusyUi();
  bodyEl.textContent = `${row.from_email} 님이 버스 정류장 정보를 공유했습니다.`;
  bindSharePopupOnce(client, userEmail, listEl, setStatus);
  bindBusShareModalScrollLock();
  dialog.showModal();
  syncBusShareModalScrollLock();

  const shareTeaser = document.querySelector("#bus-share-teaser");
  if (shareTeaser && !shareTeaser.hidden && !shareTeaser.open) {
    shareTeaser.open = true;
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

let busShareTeaserListenerBound = false;

/**
 * @param {import("@supabase/supabase-js").Session | null | undefined} session
 * @param {number | undefined} stopCount
 */
export function syncBusShareTeaserVisibility(session, stopCount) {
  const teaser = document.querySelector("#bus-share-teaser");
  if (!teaser) return;
  const signedIn = Boolean(session?.user);
  const count =
    typeof stopCount === "number" && Number.isFinite(stopCount)
      ? stopCount
      : getLocalBusStopCount();
  const show = signedIn && count > 0;
  teaser.hidden = !show;
  if (!show) teaser.open = false;
}

function bindBusShareTeaserStopListener() {
  if (busShareTeaserListenerBound) return;
  busShareTeaserListenerBound = true;
  window.addEventListener("bus-stops-changed", (ev) => {
    const logoutBtn = document.querySelector("#cloud-sync-logout");
    const signedIn = Boolean(logoutBtn && !logoutBtn.hidden);
    const stopCount =
      typeof ev?.detail?.count === "number" ? ev.detail.count : undefined;
    syncBusShareTeaserVisibility(signedIn ? { user: {} } : null, stopCount);
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {import("@supabase/supabase-js").Session} session
 * @param {(text: string) => void} setStatus
 */
export function initBusShareUi(client, session, setStatus) {
  const teaser = document.querySelector("#bus-share-teaser");
  const sendInput = document.querySelector("#bus-share-to-email");
  const sendBtn = document.querySelector("#bus-share-send");
  const incomingEl = document.querySelector("#bus-share-incoming");

  bindBusShareTeaserStopListener();

  if (!session?.user) {
    syncBusShareTeaserVisibility(null);
    return;
  }

  syncBusShareTeaserVisibility(session);
  bindBusShareModalScrollLock();

  if (!shareUiBound) {
    shareUiBound = true;

    if (sendBtn && sendInput) {
      sendBtn.addEventListener("click", async () => {
        const raw = String(sendInput.value || "").trim();
        if (!raw) {
          showBusShareHint("받을 사람 지메일 아이디를 입력해 주세요.");
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
          await sendShareRequestViaClient(client, userId, fromEmail, toEmail);
          sendInput.value = "";
          setStatus?.("");
          showBusShareHint(`공유 요청을 보냈습니다.\n\n받는 사람: ${toEmail}`);
        } catch (err) {
          console.error(err);
          setStatus?.(describeShareError(err));
        } finally {
          sendBtn.disabled = false;
        }
      });
    }
  }

  void refreshIncomingShareRequests(
    client,
    session.user.email || "",
    incomingEl,
    setStatus
  );

  const params = new URLSearchParams(window.location.search);
  if (params.get("share") === "pending" && incomingEl) {
    incomingEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}