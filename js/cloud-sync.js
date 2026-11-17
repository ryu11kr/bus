/** 클라우드 동기화 — 스텝 4: 로그인 + enabled 시 정류장 클라우드 저장·불러오기 */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm";
import {
  bindCloudSaveListener,
  runFullCloudSync,
  setCloudSyncStatusCallback,
} from "./cloud-sync-data.js";

const DEFAULT_CLOUD_SYNC_CONFIG = {
  enabled: true,
  showTeaser: true,
  showGoogleLogin: true,
  teaserTitle: "시간표 안전하게 보관",
  teaserMessage:
    "구글로 로그인하면 정류장·시간표 사진을 안전하게 보관합니다. 휴대폰을 바꾸거나 새로 사도, 같은 구글 계정으로 로그인하면 예전에 저장한 시간표를 다시 불러올 수 있습니다. 로그인하지 않으면 이 휴대폰에만 저장됩니다.",
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
  const path = window.location.pathname || "/";
  if (path.endsWith("/index.html")) {
    return `${window.location.origin}${path.replace(/index\.html$/i, "")}`;
  }
  return `${window.location.origin}${path}`;
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
async function handleSessionCloudSync(session, cfg) {
  if (!cfg.enabled || !supabaseClient || !session?.user?.id) return;
  const userId = session.user.id;
  if (!cloudSaveListenerBound) {
    bindCloudSaveListener(supabaseClient, userId, cfg.enabled);
    cloudSaveListenerBound = true;
  }
  await runFullCloudSync(supabaseClient, userId);
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

  /** @param {import("@supabase/supabase-js").Session | null} session */
  async function renderSession(session) {
    const signedIn = Boolean(session?.user);
    loginBtn.hidden = signedIn;
    logoutBtn.hidden = !signedIn;
    if (signedIn) {
      statusEl.textContent = formatSignedInLabel(session.user);
      if (cfg.enabled) {
        await handleSessionCloudSync(session, cfg);
      } else if (syncEl) {
        syncEl.hidden = true;
      }
    } else {
      cloudSaveListenerBound = false;
      statusEl.textContent = cfg.enabled
        ? "아래 구글로 로그인해 두면, 휴대폰을 바꿔도 시간표를 다시 불러올 수 있습니다."
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
      await client.auth.signOut();
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
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    await renderSession(data.session);
  } catch (error) {
    console.error(error);
    statusEl.textContent = "로그인을 준비하지 못했습니다. 새로고침 후 다시 시도해 주세요.";
  }

  client.auth.onAuthStateChange((_event, session) => {
    renderSession(session).catch(() => {});
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
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
    await initGoogleAuthUi(supabaseClient, cloudSyncCfg);
  }
}

initCloudSyncShell().catch(() => {});