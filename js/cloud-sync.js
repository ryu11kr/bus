/** 클라우드 동기화 — 스텝 3: 구글 로그인( Supabase Auth ), 데이터 동기화는 미연동 */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm";

const DEFAULT_CLOUD_SYNC_CONFIG = {
  enabled: false,
  showTeaser: true,
  showGoogleLogin: true,
  teaserTitle: "다른 폰에서도 보기",
  teaserMessage:
    "구글 계정으로 로그인해 두면, 나중에 다른 폰에서도 시간표를 불러올 수 있게 준비 중입니다. 지금 저장되는 데이터는 이 기기에만 있습니다.",
};

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

/**
 * @returns {import("@supabase/supabase-js").SupabaseClient | null}
 */
function getSupabaseClient() {
  return supabaseClient;
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
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {typeof DEFAULT_CLOUD_SYNC_CONFIG} cfg
 */
async function initGoogleAuthUi(client, cfg) {
  const authRoot = document.querySelector("#cloud-sync-auth");
  const statusEl = document.querySelector("#cloud-sync-auth-status");
  const loginBtn = document.querySelector("#cloud-sync-google-login");
  const logoutBtn = document.querySelector("#cloud-sync-logout");
  if (!authRoot || !statusEl || !loginBtn || !logoutBtn) return;

  if (!cfg.showGoogleLogin || !cloudSyncRuntime?.configured) {
    authRoot.hidden = true;
    return;
  }

  authRoot.hidden = false;

  /** @param {import("@supabase/supabase-js").Session | null} session */
  function renderSession(session) {
    const signedIn = Boolean(session?.user);
    loginBtn.hidden = signedIn;
    logoutBtn.hidden = !signedIn;
    if (signedIn) {
      statusEl.textContent = formatSignedInLabel(session.user);
    } else {
      statusEl.textContent =
        "로그인해 두면 나중에 다른 폰·PC에서 같은 시간표를 쓸 준비가 됩니다. (아직 옮기기는 다음 단계)";
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
      renderSession(null);
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
    renderSession(data.session);
  } catch (error) {
    console.error(error);
    statusEl.textContent = "로그인을 준비하지 못했습니다. 새로고침 후 다시 시도해 주세요.";
  }

  client.auth.onAuthStateChange((_event, session) => {
    renderSession(session);
  });
}

async function initCloudSyncShell() {
  if (!document.body.classList.contains("bus-app")) return;

  const root = document.querySelector("#cloud-sync-teaser");
  if (!root) return;

  const cfg = await loadCloudSyncConfig();
  cloudSyncRuntime = await loadCloudSyncRuntime();

  if (!cfg.showTeaser) {
    root.hidden = true;
    return;
  }

  root.hidden = false;
  const summary = root.querySelector("summary");
  const message = root.querySelector(".cloud-sync-teaser-msg");
  if (summary) summary.textContent = cfg.teaserTitle;
  if (message) message.textContent = cfg.teaserMessage;

  root.dataset.cloudSyncEnabled = cfg.enabled ? "true" : "false";
  root.dataset.cloudSyncConfigured = cloudSyncRuntime?.configured ? "true" : "false";

  if (cloudSyncRuntime?.configured && cfg.showGoogleLogin) {
    supabaseClient = createClient(cloudSyncRuntime.supabaseUrl, cloudSyncRuntime.supabaseAnonKey, {
      auth: {
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
    await initGoogleAuthUi(supabaseClient, cfg);
  }
}

initCloudSyncShell().catch(() => {});