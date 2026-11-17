/** 클라우드 동기화 — 스텝 1: 설정만 읽고 안내 문구 표시 (enabled 시에도 저장 로직 미연동) */

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

async function initCloudSyncShell() {
  if (!document.body.classList.contains("bus-app")) return;

  const root = document.querySelector("#cloud-sync-teaser");
  if (!root) return;

  const cfg = await loadCloudSyncConfig();

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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initCloudSyncShell().catch(() => {});
  });
} else {
  initCloudSyncShell().catch(() => {});
}