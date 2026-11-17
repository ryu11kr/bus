/** 클라우드 동기화 — 스텝 2: Supabase 런타임 설정만 로드 (동기화·로그인 미연동) */

const DEFAULT_CLOUD_SYNC_CONFIG = {
  enabled: false,
  showTeaser: true,
  teaserTitle: "다른 폰에서도 보기",
  teaserMessage:
    "구글 로그인으로 시간표를 안전하게 보관하는 기능을 준비 중입니다. 지금은 이 기기에만 저장됩니다.",
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

/** @returns {CloudSyncRuntime | null} */
function getCloudSyncRuntime() {
  return cloudSyncRuntime;
}

if (typeof window !== "undefined") {
  window.getCloudSyncRuntime = getCloudSyncRuntime;
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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initCloudSyncShell().catch(() => {});
  });
} else {
  initCloudSyncShell().catch(() => {});
}