/** 클라우드 동기화 — 스텝 4: 로그인 + enabled 시 정류장 클라우드 저장·불러오기 */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm";
import {
  bindCloudSaveListener,
  runFullCloudSync,
  setCloudSyncStatusCallback,
} from "./cloud-sync-data.js";
import {
  authFetch,
  hideShareAcceptBusy,
  initBusShareUi,
  refreshIncomingShareRequests,
  showShareAcceptBusy,
  startIncomingSharePolling,
  stopIncomingSharePolling,
  yieldToPaint,
} from "./cloud-share.js";

const DEFAULT_CLOUD_SYNC_CONFIG = {
  enabled: true,
  showTeaser: true,
  showGoogleLogin: true,
  teaserTitle: "정류장 보관",
  teaserMessage:
    "구글로 로그인하면 정류장·시간표 사진을 안전하게 보관합니다. 휴대폰을 바꾸어도 같은 구글 계정으로 로그인하면 예전에 저장한 시간표를 다시 불러올 수 있습니다. 로그인하지 않으면 이 휴대폰에만 저장됩니다.",
};

/** @type {typeof DEFAULT_CLOUD_SYNC_CONFIG | null} */
let cloudSyncCfg = null;

/**
 * @returns {Promise<typeof DEFAULT_CLOUD_SYNC_CONFIG>}
 */
async function loadCloudSyncConfig() {
  const cfg = { ...DEFAULT_CLOUD_SYNC_CONFIG };
  try {
    const response = await fetch("./cloud-sync.config.json", { cache: "no-store" });
    if (!response.ok) return cfg;
    const data = await response.json();
    if (typeof data === "object" && data) {
      if (typeof data.enabled === "boolean") cfg.enabled = data.enabled;
      if (typeof data.showTeaser === "boolean") cfg.showTeaser = data.showTeaser;
      if (typeof data.showGoogleLogin === "boolean") cfg.showGoogleLogin = data.showGoogleLogin;
      if (typeof data.teaserTitle === "string" && data.teaserTitle.trim()) {
        cfg.teaserTitle = data.teaserTitle.trim();
      }
      if (typeof data.teaserMessage === "string" && data.teaserMessage.trim()) {
        cfg.teaserMessage = data.teaserMessage.trim();
      }
    }
  } catch {
    /* 기본값 유지 */
  }
  return cfg;
}

/**
 * @typedef {{ configured: boolean, supabaseUrl: string | null, supabaseAnonKey: string | null }} CloudSyncRuntime
 */

/** @type {CloudSyncRuntime | null} */
let cloudSyncRuntime = null;

/** @type {import("@supabase/supabase-js").SupabaseClient | null} */
let supabaseClient = null;

let cloudSaveListenerBound = false;
let accountDeleteUiBound = false;

/**
 * @returns {Promise<CloudSyncRuntime | null>}
 */
async function loadCloudSyncRuntime() {
  try {
    const response = await fetch(`./cloud-sync.runtime.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || typeof data !== "object") return null;
    const configured = Boolean(data.configured && data.supabaseUrl && data.supabaseAnonKey);
    return {
      configured,
      supabaseUrl: configured ? String(data.supabaseUrl) : null,
      supabaseAnonKey: configured ? String(data.supabaseAnonKey) : null,
    };
  } catch {
    return null;
  }
}

window.getCloudSyncRuntime = () => cloudSyncRuntime;
window.getSupabaseClient = () => supabaseClient;

function authRedirectUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  let path = url.pathname || "/";
  if (path.endsWith("/index.html")) {
    path = path.replace(/\/index\.html$/i, "/");
  }
  if (!path.endsWith("/")) {
    path += "/";
  }
  return `${url.origin}${path}`;
}

/** 삼성 인터넷 등에서 localStorage 실패 시 sessionStorage 백업 */
function createAuthStorage() {
  const mirror = "bus-auth-mirror:";
  return {
    getItem(key) {
      try {
        const v = window.localStorage.getItem(key);
        if (v != null) return v;
      } catch {
        /* ignore */
      }
      try {
        return window.sessionStorage.getItem(mirror + key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* ignore */
      }
      try {
        window.sessionStorage.setItem(mirror + key, value);
      } catch {
        /* ignore */
      }
    },
    removeItem(key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      try {
        window.sessionStorage.removeItem(mirror + key);
      } catch {
        /* ignore */
      }
    },
  };
}

/** 로그아웃 후 새로고침 시 세션 잔류 방지 */
function purgeSupabaseAuthKeys() {
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      const remove = [];
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (!key) continue;
        if (key.startsWith("sb-") || key.startsWith("bus-auth-mirror:")) {
          remove.push(key);
        }
      }
      remove.forEach((key) => store.removeItem(key));
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {number} timeoutMs
 */
function waitForAuthReady(client, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let settled = false;
    /** @type {{ unsubscribe: () => void } | null} */
    let subscription = null;
    const finish = (session) => {
      if (settled) return;
      settled = true;
      subscription?.unsubscribe();
      resolve(session);
    };

    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (session?.user || event === "SIGNED_IN") {
        finish(session);
      }
    });
    subscription = data.subscription;

    client.auth.getSession().then(({ data: sessData, error }) => {
      if (error) console.error(error);
      if (sessData.session?.user) finish(sessData.session);
    });

    window.setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 */
/** @returns {"ok" | "error" | "none"} */
async function completeOAuthReturnIfNeeded(client) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return "none";

  const existing = await client.auth.getSession();
  if (existing.data.session?.user) {
    window.history.replaceState({}, document.title, authRedirectUrl());
    return "ok";
  }

  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) {
    console.error(error);
    return "error";
  }

  window.history.replaceState({}, document.title, authRedirectUrl());
  return "ok";
}

function formatSignedInLabel(user) {
  if (!user) return "로그인됐습니다.";
  const meta = user.user_metadata || {};
  const name = meta.full_name || meta.name;
  const email = user.email;
  if (name && email) return `${name} (${email})`;
  if (email) return email;
  return "구글 계정으로 로그인됨";
}

/**
 * @param {import("@supabase/supabase-js").Session | null} session
 * @param {typeof DEFAULT_CLOUD_SYNC_CONFIG} cfg
 */
function startSessionCloudSync(session, cfg) {
  if (!cfg.enabled || !supabaseClient || !session?.user?.id) return;
  const userId = session.user.id;
  if (!cloudSaveListenerBound) {
    bindCloudSaveListener(supabaseClient, userId, cfg.enabled);
    cloudSaveListenerBound = true;
  }
  runFullCloudSync(supabaseClient, userId).catch((error) => {
    console.error(error);
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {(session: import("@supabase/supabase-js").Session | null) => Promise<void>} renderSession
 */
function bindAccountDeleteUi(client, renderSession) {
  if (accountDeleteUiBound) return;
  accountDeleteUiBound = true;

  const btn = document.querySelector("#bus-account-delete-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const ok = window.confirm(
      "정말 서비스를 탈퇴하시겠습니까?\n\n" +
        "· 구글 로그인 연동이 삭제됩니다.\n" +
        "· 클라우드에 저장된 정류장·시간표 사진이 모두 삭제됩니다.\n" +
        "· 이 휴대폰의 정류장 목록도 지워집니다.\n\n" +
        "삭제 후에는 복구할 수 없습니다."
    );
    if (!ok) return;

    btn.disabled = true;
    showShareAcceptBusy("서비스 탈퇴를 처리하는 중입니다…", null);
    await yieldToPaint();
    try {
      showShareAcceptBusy("클라우드 데이터를 삭제하는 중입니다…", null);
      await yieldToPaint();
      await authFetch("account-delete", { method: "POST", body: JSON.stringify({}) });
      showShareAcceptBusy("이 기기의 데이터를 정리하는 중입니다…", null);
      await yieldToPaint();
      stopIncomingSharePolling();
      cloudSaveListenerBound = false;
      if (typeof window.busAppClearAllLocalData === "function") {
        window.busAppClearAllLocalData();
      }
      try {
        await client.auth.signOut({ scope: "global" });
      } catch {
        await client.auth.signOut({ scope: "local" });
      }
      purgeSupabaseAuthKeys();
      await renderSession(null);
      hideShareAcceptBusy();
      if (typeof window.setBusStatus === "function") {
        window.setBusStatus("서비스 탈퇴가 완료되었습니다.");
      }
    } catch (error) {
      hideShareAcceptBusy();
      console.error(error);
      const code = error?.code || error?.message;
      let msg = "서비스 탈퇴에 실패했습니다. 잠시 후 다시 시도해 주세요.";
      if (code === "login_required") msg = "다시 로그인한 뒤 탈퇴를 진행해 주세요.";
      if (code === "server_not_configured") {
        msg = "서버 설정이 되지 않아 탈퇴할 수 없습니다. 운영자에게 문의해 주세요.";
      }
      if (typeof window.setBusStatus === "function") {
        window.setBusStatus(msg);
      }
    } finally {
      hideShareAcceptBusy();
      btn.disabled = false;
    }
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {typeof DEFAULT_CLOUD_SYNC_CONFIG} cfg
 */
async function initGoogleAuthUi(client, cfg) {
  const authRoot = document.querySelector("#cloud-sync-auth");
  const statusEl = document.querySelector("#cloud-sync-auth-status");
  const syncEl = document.querySelector("#cloud-sync-sync-status");
  const loginBtn = document.querySelector("#cloud-sync-google-login");
  const logoutBtn = document.querySelector("#cloud-sync-logout");
  const introEl = document.querySelector("#cloud-sync-teaser-intro");
  if (!authRoot || !statusEl || !loginBtn || !logoutBtn) return;

  if (!cfg.showGoogleLogin || !cloudSyncRuntime?.configured) {
    authRoot.hidden = true;
    return;
  }

  authRoot.hidden = false;

  setCloudSyncStatusCallback((text) => {
    if (!syncEl) return;
    if (!text) {
      syncEl.hidden = true;
      syncEl.textContent = "";
      return;
    }
    syncEl.hidden = false;
    syncEl.textContent = text;
  });

  let renderSerial = 0;

  /** @param {import("@supabase/supabase-js").Session | null} session */
  async function renderSession(session) {
    const ticket = ++renderSerial;
    const signedIn = Boolean(session?.user);
    loginBtn.hidden = signedIn;
    logoutBtn.hidden = !signedIn;
    loginBtn.disabled = false;
    if (introEl) introEl.hidden = signedIn;
    const deleteTeaser = document.querySelector("#bus-account-delete-teaser");
    if (deleteTeaser) {
      deleteTeaser.hidden = !signedIn;
      if (!signedIn) deleteTeaser.open = false;
    }

    if (signedIn) {
      statusEl.textContent = formatSignedInLabel(session.user);
      bindAccountDeleteUi(client, renderSession);
      if (cfg.enabled) {
        startSessionCloudSync(session, cfg);
      } else if (syncEl) {
        syncEl.hidden = true;
      }
      const setShareStatus = (text) => {
        if (!syncEl) return;
        if (!text) {
          syncEl.hidden = true;
          syncEl.textContent = "";
          return;
        }
        syncEl.hidden = false;
        syncEl.textContent = text;
      };
      initBusShareUi(client, session, setShareStatus);
      void refreshIncomingShareRequests(
        client,
        session.user.email || "",
        document.querySelector("#bus-share-incoming"),
        setShareStatus
      );
      startIncomingSharePolling(client, setShareStatus);
      if (ticket !== renderSerial) return;
    } else {
      stopIncomingSharePolling();
      const shareTeaser = document.querySelector("#bus-share-teaser");
      const incomingEl = document.querySelector("#bus-share-incoming");
      if (shareTeaser) shareTeaser.hidden = true;
      if (incomingEl) {
        incomingEl.hidden = true;
        incomingEl.replaceChildren();
      }
      if (introEl) introEl.hidden = false;
      cloudSaveListenerBound = false;
      statusEl.textContent = cfg.enabled
        ? "구글 로그인을 하시면 다른 구글 로그인 사용자에게 내 버스정류장 정보를 공유할 수 있습니다."
        : "아래 구글로 로그인해 시간표를 안전하게 보관할 수 있습니다.";
      if (syncEl) {
        syncEl.hidden = true;
        syncEl.textContent = "";
      }
    }
  }

  loginBtn.addEventListener("click", async () => {
    loginBtn.disabled = true;
    statusEl.textContent = "구글 로그인 화면으로 이동합니다…";
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: authRedirectUrl() },
      });
      if (error) throw error;
    } catch (error) {
      console.error(error);
      statusEl.textContent =
        "로그인을 시작하지 못했습니다. Supabase·구글 설정을 확인하거나 잠시 후 다시 시도해 주세요.";
      loginBtn.disabled = false;
    }
  });

  logoutBtn.addEventListener("click", async () => {
    logoutBtn.disabled = true;
    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) console.error(error);
      purgeSupabaseAuthKeys();
      cloudSaveListenerBound = false;
      await renderSession(null);
    } catch (error) {
      console.error(error);
      statusEl.textContent = "로그아웃하지 못했습니다. 다시 시도해 주세요.";
    } finally {
      logoutBtn.disabled = false;
    }
  });

  statusEl.textContent = "로그인 상태 확인 중…";
  try {
    const oauthResult = await completeOAuthReturnIfNeeded(client);
    let session = (await client.auth.getSession()).data.session;

    if (!session?.user && oauthResult === "ok") {
      const { data: refreshed, error: refreshErr } = await client.auth.refreshSession();
      if (refreshErr) console.error(refreshErr);
      session = refreshed.session || session;
    }
    if (!session?.user && oauthResult === "none") {
      session = await waitForAuthReady(client, 2500);
    }

    if (oauthResult === "error") {
      statusEl.textContent =
        "로그인을 마치지 못했습니다. 새로고침 후 다시 「구글로 로그인」을 눌러 주세요.";
      await renderSession(null);
    } else if (session?.user) {
      await renderSession(session);
    } else {
      await renderSession(null);
    }
  } catch (error) {
    console.error(error);
    statusEl.textContent = "로그인을 준비하지 못했습니다. 새로고침 후 다시 시도해 주세요.";
    loginBtn.disabled = false;
  }

  client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || event === "USER_DELETED") {
      cloudSaveListenerBound = false;
      purgeSupabaseAuthKeys();
      renderSession(null).catch(() => {});
      return;
    }
    if (session?.user) {
      renderSession(session).catch(() => {});
    }
  });

  async function refreshSessionFromStorage() {
    const { data, error } = await client.auth.getSession();
    if (error) return;
    if (data.session?.user) {
      await renderSession(data.session);
    } else {
      await renderSession(null);
    }
  }

  window.addEventListener("pageshow", () => {
    refreshSessionFromStorage().catch(() => {});
  });
  let lastForegroundSync = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    refreshSessionFromStorage().catch(() => {});
    if (!cfg.enabled) return;
    const now = Date.now();
    if (now - lastForegroundSync < 2500) return;
    lastForegroundSync = now;
    client.auth.getSession().then(({ data: sessionData }) => {
      const userId = sessionData.session?.user?.id;
      if (!userId) return;
      runFullCloudSync(client, userId).catch((error) => console.error(error));
      const email = sessionData.session?.user?.email || "";
      const incoming = document.querySelector("#bus-share-incoming");
      if (incoming && email) {
        refreshIncomingShareRequests(client, email, incoming, (text) => {
          if (!syncEl) return;
          if (!text) return;
          syncEl.hidden = false;
          syncEl.textContent = text;
        }).catch(() => {});
      }
    });
  });
}

async function initCloudSyncShell() {
  if (!document.body.classList.contains("bus-app")) return;

  const root = document.querySelector("#cloud-sync-teaser");
  if (!root) return;

  cloudSyncCfg = await loadCloudSyncConfig();
  cloudSyncRuntime = await loadCloudSyncRuntime();

  if (!cloudSyncCfg.showTeaser) {
    root.hidden = true;
    return;
  }

  root.hidden = false;
  const summary = root.querySelector("summary");
  const message = root.querySelector(".cloud-sync-teaser-msg");
  if (summary) summary.textContent = cloudSyncCfg.teaserTitle;
  if (message) message.textContent = cloudSyncCfg.teaserMessage;

  root.dataset.cloudSyncEnabled = cloudSyncCfg.enabled ? "true" : "false";
  root.dataset.cloudSyncConfigured = cloudSyncRuntime?.configured ? "true" : "false";

  if (cloudSyncRuntime?.configured && cloudSyncCfg.showGoogleLogin) {
    supabaseClient = createClient(cloudSyncRuntime.supabaseUrl, cloudSyncRuntime.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        storage: createAuthStorage(),
      },
    });
    await initGoogleAuthUi(supabaseClient, cloudSyncCfg);
  }
}

initCloudSyncShell().catch(() => {});