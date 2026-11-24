/** @type {{ cachePrefix?: string; name?: string; description?: string } | null} */
let pwaConfig = null;

const installBtn = document.querySelector("#install-btn");
const updateBtn = document.querySelector("#update-btn");
const installHint = document.querySelector("#install-hint");
const cacheList = document.querySelector("#cache-list");
const refreshCacheBtn = document.querySelector("#refresh-cache");
const netState = document.querySelector("#net-state");
const displayState = document.querySelector("#display-state");
const swState = document.querySelector("#sw-state");
const swVersion = document.querySelector("#sw-version");

let deferredPrompt = null;
let registration = null;
let reloadOnControllerChange = false;
let versionPollId = null;
const watchedRegistrations = new WeakSet();
let lastListedBuild = null;
let registeredTargetBuild = 0;

const PHOTO_MAX_WIDTH = 1680;
const PHOTO_JPEG_QUALITY = 0.9;

init();

async function init() {
  await loadConfig();
  applyConfigToHero();
  renderNetwork();
  renderDisplayMode();
  bindInstall();
  bindServiceWorker();
  initApp();
  window.addEventListener("online", renderNetwork);
  window.addEventListener("offline", renderNetwork);
}

const BUS_STORAGE_KEY = "bus-stops-v2";

/**
 * @typedef {{ id: string, name: string, photoThumb: string, ocrText: string, sections: { title: string | null, lines: string[] }[], updatedAt: string }} BusStop
 */

/** @type {BusStop[]} */
let busStops = [];
/** @type {string | null} */
let activeStopId = null;
/** @type {string | null} */
let activePhotoId = null;
/** @type {string | null} */
let replacePhotoId = null;
/** @type {{ photoThumb: string } | null} */
let pendingStopDraft = null;
/** @type {"new" | "replace" | "rename" | "add-photo" | "replace-photo" | "photo-label" | "rename-photo-label" | null} */
let pendingStopAction = null;
/** @type {string | null} */
let pendingPhotoLabelEditId = null;
/** @type {string | null} */
let pendingNewStopName = null;
/** @type {string | null} */
let replaceStopId = null;
/** 사진 처리 중 — 자동 업데이트 새로고침 방지 */
let photoPipelineBusy = false;
let busRouteSync = true;
/** @type {BusStop | null} */
let linkViewStop = null;

/** 새 앱 로직은 이 함수에 넣으세요. */
function initApp() {
  if (!document.body.classList.contains("bus-app")) return;

  loadBusState();
  bindBusUi();
  bindBusFormModalScrollLock();
  bindBusStatusDialog();
  bindAppShareUi();
  bindPhotoViewer();
  bindSamsungPinchGuard();
  bindAppUpdateUi();
  bindBusHistory();
  const initialRoute =
    typeof window.busRoutes?.parse === "function" ? window.busRoutes.parse() : { view: "list" };
  busRouteSync = false;
  if (initialRoute.view === "list" && !location.hash) {
    showListView({ skipRoute: true });
    commitBusRoute({ view: "list" }, { replace: true });
  } else {
    navigateBusRoute(initialRoute, { skipRoute: true });
    commitBusRoute(initialRoute, { replace: true });
  }
  busRouteSync = true;
  updateInstallButtonVisibility();
  renderStopList();
}

const APP_VERSION_SEEN_KEY = "bus-app-version-seen-build";
const APP_UPDATE_COMPLETE_KEY = "bus-show-update-complete";
let appVersionPollId = null;
let appUpdateCompleteDialogBound = false;

function markAppUpdateCompletePending() {
  try {
    sessionStorage.setItem(APP_UPDATE_COMPLETE_KEY, "1");
  } catch {
    /* ignore */
  }
}

function maybeShowAppUpdateCompleteDialog() {
  try {
    if (sessionStorage.getItem(APP_UPDATE_COMPLETE_KEY) !== "1") return;
    sessionStorage.removeItem(APP_UPDATE_COMPLETE_KEY);
  } catch {
    return;
  }
  const dialog = document.querySelector("#app-update-complete-dialog");
  const okBtn = document.querySelector("#app-update-complete-ok");
  if (!dialog || !okBtn) return;

  if (!appUpdateCompleteDialogBound) {
    appUpdateCompleteDialogBound = true;
    okBtn.addEventListener("click", () => {
      if (dialog.open) dialog.close();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      dialog.close();
    });
  }

  const banner = document.querySelector("#app-update-banner");
  if (banner) banner.hidden = true;

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
    okBtn.focus();
  }
}

function bindAppUpdateUi() {
  document.querySelector("#app-update-apply")?.addEventListener("click", () => {
    applyAppUpdate();
  });
  maybeShowAppUpdateCompleteDialog();
  bootstrapAppVersionCheck().catch(() => {});
  if (appVersionPollId) clearInterval(appVersionPollId);
  appVersionPollId = window.setInterval(() => {
    checkAppVersionUpdate().catch(() => {});
    syncServiceWorker().catch(() => {});
  }, 20_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkAppVersionUpdate().catch(() => {});
      syncServiceWorker().catch(() => {});
    } else {
      collapseListPanelDetails();
    }
  });
  window.addEventListener("pagehide", collapseListPanelDetails);
}

async function fetchAppVersionMeta() {
  const tryUrls = ["/api/app-version", "./version.json"];
  for (const path of tryUrls) {
    try {
      const response = await fetch(`${path}?t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (data?.build != null) return data;
    } catch {
    }
  }
  return null;
}

/** @returns {{ build?: number, commitSha?: string, updatedAt?: string } | null} */
function readSeenAppVersion() {
  const raw = localStorage.getItem(APP_VERSION_SEEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? { build: n } : null;
}

function writeSeenAppVersion(meta) {
  if (!meta?.build) return;
  localStorage.setItem(
    APP_VERSION_SEEN_KEY,
    JSON.stringify({
      build: meta.build,
      commitSha: meta.commitSha || null,
      updatedAt: meta.updatedAt || null,
    })
  );
}

function serverVersionIsNewer(meta, seen) {
  if (!meta?.build || !seen) return false;
  if (meta.commitSha && seen.commitSha) return meta.commitSha !== seen.commitSha;
  if (meta.updatedAt && seen.updatedAt) return meta.updatedAt !== seen.updatedAt;
  return Number(meta.build) !== Number(seen.build);
}

async function bootstrapAppVersionCheck() {
  const meta = await fetchAppVersionMeta();
  if (!meta?.build) return;
  const seen = readSeenAppVersion();
  if (!seen) {
    writeSeenAppVersion(meta);
    return;
  }
  if (serverVersionIsNewer(meta, seen)) {
    showAppUpdateBanner(meta);
  }
}

async function checkAppVersionUpdate() {
  const meta = await fetchAppVersionMeta();
  if (!meta?.build) return;
  const seen = readSeenAppVersion();
  if (!seen) {
    writeSeenAppVersion(meta);
    return;
  }
  if (serverVersionIsNewer(meta, seen)) {
    showAppUpdateBanner(meta);
  }
}

async function purgeInstalledAppCaches() {
  if (!("caches" in window)) return;
  const prefix = cachePrefix();
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key === prefix || key.startsWith(`${prefix}-`)).map((key) => caches.delete(key))
    );
  } catch (error) {
    console.error(error);
  }
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.active) {
      reg.active.postMessage({ type: "PURGE_CACHES" });
    }
  } catch {
    /* ignore */
  }
}

function showAppUpdateBanner(meta) {
  const banner = document.querySelector("#app-update-banner");
  if (banner && !banner.hidden) return;
  if (banner) {
    banner.hidden = false;
    if (meta?.build != null) banner.dataset.pendingBuild = String(meta.build);
    if (meta?.commitSha) banner.dataset.pendingSha = meta.commitSha;
  }
  if (updateBtn) {
    updateBtn.hidden = false;
    updateBtn.disabled = false;
    updateBtn.className = "big-btn primary";
  }
  setBusStatus("");
  syncServiceWorker().catch(() => {});
}

async function applyAppUpdate() {
  const banner = document.querySelector("#app-update-banner");
  const pending = banner?.dataset.pendingBuild;
  const pendingSha = banner?.dataset.pendingSha;

  await purgeInstalledAppCaches();

  const finish = async () => {
    const meta = await fetchAppVersionMeta();
    if (meta) writeSeenAppVersion(meta);
    else if (pending || pendingSha) {
      writeSeenAppVersion({
        build: pending ? Number(pending) : 0,
        commitSha: pendingSha || null,
      });
    }
    markAppUpdateCompletePending();
    const url = new URL(location.href);
    url.searchParams.set("v", pending || String(Date.now()));
    location.replace(url.toString());
  };

  if (registration) {
    try {
      await registration.update();
    } catch {
    }
  }
  if (registration?.waiting) {
    reloadOnControllerChange = true;
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
    window.setTimeout(() => {
      finish();
    }, 400);
    return;
  }
  await finish();
}


function bindBusUi() {
  const fileCamera = document.querySelector("#file-camera");
  const fileAlbum = document.querySelector("#file-album");
  const btnNewCamera = document.querySelector("#btn-new-camera");
  const btnNewAlbum = document.querySelector("#btn-new-album");
  const btnBack = document.querySelector("#btn-back-list");
  const btnShareStop = document.querySelector("#btn-share-stop");
  const btnRename = document.querySelector("#btn-rename-stop");
  const btnAddCamera = document.querySelector("#btn-add-photo-camera");
  const btnAddAlbum = document.querySelector("#btn-add-photo-album");
  const btnDelete = document.querySelector("#btn-delete-stop");
  const nameDialog = document.querySelector("#stop-name-dialog");
  const nameForm = document.querySelector("#stop-name-form");
  const nameCancel = document.querySelector("#stop-name-cancel");
  const photoLabelDialog = document.querySelector("#photo-label-dialog");
  const photoLabelForm = document.querySelector("#photo-label-form");
  const photoLabelCancel = document.querySelector("#photo-label-cancel");

  fileCamera?.addEventListener("change", () => handleBusPhoto(fileCamera));
  fileAlbum?.addEventListener("change", () => handleBusPhoto(fileAlbum));

  btnNewCamera?.addEventListener("click", () => {
    pendingStopAction = "new";
    const input = document.querySelector("#file-camera");
    if (input) input.value = "";
    input?.click();
  });
  btnNewAlbum?.addEventListener("click", () => {
    pendingStopAction = "new";
    const input = document.querySelector("#file-album");
    if (input) input.value = "";
    input?.click();
  });
  btnBack?.addEventListener("click", () => goBackOrList());
  btnShareStop?.addEventListener("click", () => {
    shareActiveStopLink().catch(() => {});
  });

  btnRename?.addEventListener("click", () => {
    const stop = getActiveStop();
    if (!stop) return;
    pendingStopAction = "rename";
    openNameDialog("stop-rename", { stopName: stop.name });
  });

  function beginAddPhoto(useCamera) {
    const stop = getActiveStop();
    if (!stop) return;
    if (getStopPhotos(stop).length >= maxPhotosPerStop()) {
      setBusStatus(`한 정류장에는 사진 ${maxPhotosPerStop()}장까지 넣을 수 있습니다.`);
      return;
    }
    pendingStopAction = "add-photo";
    replaceStopId = stop.id;
    replacePhotoId = null;
    const input = document.querySelector(useCamera ? "#file-camera" : "#file-album");
    if (input) input.value = "";
    input?.click();
  }

  btnAddCamera?.addEventListener("click", () => beginAddPhoto(true));
  btnAddAlbum?.addEventListener("click", () => beginAddPhoto(false));

  btnDelete?.addEventListener("click", () => {
    const stop = getActiveStop();
    if (!stop) return;
    if (!window.confirm(`"${stop.name}" 정류장을 삭제할까요?`)) return;
    busStops = busStops.filter((s) => s.id !== stop.id);
    activeStopId = null;
    saveBusState();
    showListView();
    renderStopList();
    setBusStatus("정류장을 삭제했습니다.");
  });

  nameCancel?.addEventListener("click", () => {
    pendingStopDraft = null;
    pendingStopAction = null;
    replaceStopId = null;
    replacePhotoId = null;
    pendingNewStopName = null;
    nameDialog?.close();
  });

  nameForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#stop-name-input");
    const name = input?.value?.trim();
    if (!name) return;

    if (pendingStopAction === "rename") {
      const stop = getActiveStop();
      if (stop) {
        stop.name = name;
        stop.updatedAt = new Date().toISOString();
        saveBusState();
        renderStopDetail(stop.id);
        renderStopList();
        setBusStatus("이름을 바꿨습니다.");
      }
    } else if (pendingStopAction === "new" && pendingStopDraft) {
      pendingNewStopName = name;
      pendingStopAction = "new-photo-label";
      nameDialog?.close();
      openPhotoLabelDialog("");
      setBusStatus("이제 이 사진 애칭(버스 번호 등)을 적어 주세요.");
      return;
    }

    pendingStopDraft = null;
    pendingStopAction = null;
    replaceStopId = null;
    replacePhotoId = null;
    pendingNewStopName = null;
    nameDialog?.close();
  });

  photoLabelCancel?.addEventListener("click", () => {
    if (pendingStopAction === "new-photo-label") {
      pendingStopDraft = null;
      pendingNewStopName = null;
    }
    pendingStopAction = null;
    replaceStopId = null;
    replacePhotoId = null;
    pendingPhotoLabelEditId = null;
    photoLabelDialog?.close();
  });

  photoLabelForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const photoLabelInput = document.querySelector("#photo-label-input");
    const photoLabelHelp = document.querySelector("#photo-label-dialog-help");
    const photoLabel = photoLabelInput?.value?.trim();
    if (!photoLabel) {
      if (photoLabelHelp) {
        photoLabelHelp.textContent =
          "버스 번호나 평일·주말처럼 구분할 이름을 적은 뒤 저장을 눌러 주세요.";
      }
      photoLabelInput?.focus();
      return;
    }

    /** @type {string} */
    let statusMessage = "";
    const action = pendingStopAction;
    const draft = pendingStopDraft;
    const newName = pendingNewStopName;
    const editPhotoId = pendingPhotoLabelEditId;
    const addStopId = replaceStopId;

    pendingStopDraft = null;
    pendingStopAction = null;
    replaceStopId = null;
    replacePhotoId = null;
    pendingPhotoLabelEditId = null;
    pendingNewStopName = null;
    photoLabelDialog?.close();
    syncBusFormModalScrollLock();

    if (action === "rename-photo-label" && editPhotoId) {
      const stop = getActiveStop();
      if (stop) {
        const photos = getStopPhotos(stop);
        const hit = photos.find((p) => p.id === editPhotoId);
        if (hit) hit.label = photoLabel;
        stop.photos = photos;
        stop.updatedAt = new Date().toISOString();
        normalizeStopPhotos(stop);
        saveBusState();
        renderStopDetail(stop.id);
        renderStopList();
        statusMessage = "사진 애칭을 바꿨습니다.";
      }
    } else if (action === "photo-label" && draft && addStopId) {
      const stop = busStops.find((s) => s.id === addStopId);
      if (stop) {
        if (getStopPhotos(stop).length >= maxPhotosPerStop()) {
          statusMessage = `한 정류장에는 사진 ${maxPhotosPerStop()}장까지 넣을 수 있습니다.`;
        } else {
          const photo = photoFromDraft(draft, photoLabel);
          if (!Array.isArray(stop.photos)) stop.photos = getStopPhotos(stop);
          stop.photos.push(photo);
          stop.updatedAt = new Date().toISOString();
          normalizeStopPhotos(stop);
          activeStopId = stop.id;
          activePhotoId = photo.id;
          saveBusState();
          renderStopDetail(stop.id);
          renderStopList();
          statusMessage = "시간표 사진을 추가했습니다.";
        }
      }
    } else if (action === "new-photo-label" && draft && newName) {
      const stop = createStopFromDraft(draft, newName, photoLabel);
      busStops.unshift(stop);
      activeStopId = stop.id;
      activePhotoId = getStopPhotos(stop).at(-1)?.id || null;
      saveBusState();
      renderStopDetail(stop.id);
      renderStopList();
      statusMessage = "정류장을 저장했습니다.";
    }

    if (photoLabelHelp) {
      photoLabelHelp.textContent =
        "버스 번호나 평일·주말처럼, 이 시간표 사진만 구분할 이름을 적어 주세요.";
    }
    if (statusMessage) setBusStatus(statusMessage);
  });
}

/** 삼성 인터넷 등: 홈·목록에서 브라우저 핀치 확대 차단 (뷰어 안만 허용) */
function bindSamsungPinchGuard() {
  if (!document.body.classList.contains("bus-app")) return;

  const allowPinch = (target) =>
    target instanceof Element && Boolean(target.closest("#photo-viewer-stage"));

  const blockTwoFinger = (e) => {
    if (e.touches.length < 2) return;
    if (allowPinch(e.target)) return;
    e.preventDefault();
  };

  document.addEventListener("touchstart", blockTwoFinger, { passive: false, capture: true });
  document.addEventListener("touchmove", blockTwoFinger, { passive: false, capture: true });
}

let photoViewerScrollLockY = 0;

let busFormModalScrollLockY = 0;
let busFormModalScrollLockBound = false;

function isBusFormDialogOpen() {
  const ids = ["stop-name-dialog", "photo-label-dialog", "bus-status-dialog"];
  return ids.some((id) => document.querySelector(`#${id}`)?.open);
}

function isOtherBusModalScrollLockOpen() {
  const share = document.querySelector("#bus-share-popup");
  const hint = document.querySelector("#bus-share-hint-dialog");
  return Boolean(share?.open || hint?.open);
}

function syncBusFormModalScrollLock() {
  if (isBusFormDialogOpen()) {
    if (
      !document.body.classList.contains("bus-modal-scroll-lock") &&
      !document.body.classList.contains("photo-viewer-lock")
    ) {
      busFormModalScrollLockY = window.scrollY || 0;
      document.body.classList.add("bus-modal-scroll-lock");
      document.body.style.top = `-${busFormModalScrollLockY}px`;
    }
    return;
  }
  if (
    !isOtherBusModalScrollLockOpen() &&
    document.body.classList.contains("bus-modal-scroll-lock") &&
    !document.body.classList.contains("photo-viewer-lock")
  ) {
    document.body.classList.remove("bus-modal-scroll-lock");
    document.body.style.top = "";
    window.scrollTo(0, busFormModalScrollLockY);
  }
}

function bindBusFormModalScrollLock() {
  if (busFormModalScrollLockBound) return;
  busFormModalScrollLockBound = true;
  for (const id of ["stop-name-dialog", "photo-label-dialog", "bus-status-dialog"]) {
    document.querySelector(`#${id}`)?.addEventListener("close", syncBusFormModalScrollLock);
  }
}

let busStatusDialogBound = false;

/** @param {string} text */
function shouldBusStatusUseModal(text) {
  if (!text) return false;
  if (document.querySelector("#photo-label-dialog")?.open) return false;
  if (document.querySelector("#stop-name-dialog")?.open) return false;
  if (/…/.test(text) || /중입니다/.test(text)) return false;
  if (text.startsWith("이제 이 사진 애칭")) return false;
  if (text.startsWith("보정을 마쳤습니다")) return false;
  if (text === "이 사진 애칭(버스 번호 등)을 적어 주세요.") return false;
  if (/했습니다[.!]?$/.test(text) || /했어요[.!]?$/.test(text)) return false;
  if (text.includes("복사했습니다") || text.includes("공유했습니다")) return false;
  if (text.includes("예전 링크") || text.includes("옛 링크")) return false;
  if (text.includes("공유 링크")) return false;
  return true;
}

function bindBusStatusDialog() {
  const dialog = document.querySelector("#bus-status-dialog");
  const okBtn = document.querySelector("#bus-status-dialog-ok");
  if (!dialog || !okBtn || busStatusDialogBound) return;
  busStatusDialogBound = true;
  okBtn.addEventListener("click", () => {
    if (dialog.open) dialog.close();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dialog.close();
  });
}

/** @param {string} message */
function showBusStatusModal(message) {
  const dialog = document.querySelector("#bus-status-dialog");
  const bodyEl = document.querySelector("#bus-status-dialog-body");
  const okBtn = document.querySelector("#bus-status-dialog-ok");
  if (!dialog || !bodyEl || !okBtn) return;
  bindBusStatusDialog();
  bodyEl.textContent = message;
  if (dialog.open) dialog.close();
  dialog.showModal();
  syncBusFormModalScrollLock();
  okBtn.focus();
}

function lockPageForPhotoViewer() {
  photoViewerScrollLockY = window.scrollY || 0;
  document.body.classList.add("photo-viewer-lock");
  document.body.style.top = `-${photoViewerScrollLockY}px`;
}

function unlockPageForPhotoViewer() {
  document.body.classList.remove("photo-viewer-lock");
  document.body.style.top = "";
  window.scrollTo(0, photoViewerScrollLockY);
}

/** 상세 화면 사진 — 전체 화면 핀치·팬 (이 레이어만) */
function bindPhotoViewer() {
  const dialog = document.querySelector("#photo-viewer");
  const stage = document.querySelector("#photo-viewer-stage");
  const pan = document.querySelector("#photo-viewer-pan");
  const img = document.querySelector("#photo-viewer-img");
  const stopNameEl = document.querySelector("#photo-viewer-stop-name");
  const photoLabelEl = document.querySelector("#photo-viewer-photo-label");
  const btnClose = document.querySelector("#photo-viewer-close");
  const btnFit = document.querySelector("#photo-viewer-fit");
  const btnZoomIn = document.querySelector("#photo-viewer-zoom-in");
  const btnZoomOut = document.querySelector("#photo-viewer-zoom-out");
  if (!dialog || !stage || !pan || !img) return;

  const MAX_USER_ZOOM = 3;

  let fitScale = 1;
  let userZoom = 1;
  let tx = 0;
  let ty = 0;
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let panPointerId = null;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginTx = 0;
  let panOriginTy = 0;
  let panDidMove = false;

  function stageMetrics() {
    return { w: stage.clientWidth, h: stage.clientHeight };
  }

  function totalScale() {
    return fitScale * userZoom;
  }

  function clampPan() {
    const { w, h } = stageMetrics();
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const s = totalScale();
    const dw = iw * s;
    const dh = ih * s;
    const margin = 24;
    const minTx = Math.min(margin, w - dw - margin);
    const maxTx = Math.max(w - dw - margin, margin);
    const minTy = Math.min(margin, h - dh - margin);
    const maxTy = Math.max(h - dh - margin, margin);
    if (dw <= w) tx = (w - dw) / 2;
    else tx = Math.min(maxTx, Math.max(minTx, tx));
    if (dh <= h) ty = (h - dh) / 2;
    else ty = Math.min(maxTy, Math.max(minTy, ty));
  }

  function applyViewerTransform() {
    clampPan();
    const s = totalScale();
    pan.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    updateViewerZoomButtons();
  }

  function updateViewerZoomButtons() {
    const atFit = userZoom <= 1.01;
    if (btnZoomOut) btnZoomOut.disabled = atFit;
    if (btnFit) btnFit.disabled = atFit;
  }

  function setZoomFit() {
    if (!img.naturalWidth) return;
    const { w, h } = stageMetrics();
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    fitScale = Math.min(w / iw, h / ih, 1);
    userZoom = 1;
    img.style.width = `${iw}px`;
    img.style.height = `${ih}px`;
    const s = totalScale();
    tx = (w - iw * s) / 2;
    ty = (h - ih * s) / 2;
    applyViewerTransform();
    stage.classList.toggle("photo-viewer-stage--pan", canPanImage());
  }

  function zoomInStep() {
    userZoom = Math.min(MAX_USER_ZOOM, userZoom * 1.35);
    applyViewerTransform();
    stage.classList.toggle("photo-viewer-stage--pan", canPanImage());
  }

  function zoomOutStep() {
    if (userZoom <= 1.01) {
      setZoomFit();
      return;
    }
    userZoom = Math.max(1, userZoom / 1.35);
    if (userZoom <= 1.01) {
      setZoomFit();
      return;
    }
    applyViewerTransform();
    stage.classList.toggle("photo-viewer-stage--pan", canPanImage());
  }

  function canPanImage() {
    if (userZoom > 1.01) return true;
    const { w, h } = stageMetrics();
    const s = totalScale();
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    return dw > w + 2 || dh > h + 2;
  }

  function touchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  function layoutAfterViewerOpen() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!dialog.open) return;
        setZoomFit();
      });
    });
  }

  function openPhotoViewer(photoOverride) {
    const stop = getActiveStop();
    const photo = photoOverride || getActivePhoto(stop);
    if (!stop || !photo?.photoThumb) return;
    const photos = getStopPhotos(stop);
    const index = Math.max(
      0,
      photos.findIndex((p) => p.id === photo.id)
    );
    const hasLabel = photoHasCustomLabel(photo);
    const label = hasLabel ? displayPhotoLabel(photo, index) : "버스 번호·애칭 적기";
    if (stopNameEl) {
      stopNameEl.textContent = label;
      stopNameEl.classList.toggle("is-placeholder", !hasLabel);
    }
    if (photoLabelEl) {
      photoLabelEl.textContent = "";
      photoLabelEl.hidden = true;
    }
    img.alt = `${stop.name} ${label} 시간표`;
    const src = photo.photoThumb;
    const onReady = () => {
      lockPageForPhotoViewer();
      if (typeof dialog.showModal === "function") dialog.showModal();
      layoutAfterViewerOpen();
    };
    img.onload = () => onReady();
    if (img.src !== src) {
      img.src = src;
    } else if (img.complete && img.naturalWidth > 0) {
      onReady();
    } else {
      img.src = src;
    }
  }

  function closePhotoViewer() {
    dialog.close();
  }

  const blockNativeImageDrag = (e) => {
    e.preventDefault();
  };
  dialog.addEventListener("dragstart", blockNativeImageDrag);
  stage.addEventListener("dragstart", blockNativeImageDrag);
  pan.addEventListener("dragstart", blockNativeImageDrag);
  img.addEventListener("dragstart", blockNativeImageDrag);
  dialog.addEventListener("selectstart", blockNativeImageDrag);

  window.busAppOpenPhotoViewer = (photo) => openPhotoViewer(photo);

  btnClose?.addEventListener("click", closePhotoViewer);
  btnFit?.addEventListener("click", setZoomFit);
  btnZoomIn?.addEventListener("click", zoomInStep);
  btnZoomOut?.addEventListener("click", zoomOutStep);

  dialog.addEventListener("close", () => {
    img.onload = null;
    unlockPageForPhotoViewer();
    userZoom = 1;
    panPointerId = null;
  });

  let lastTap = 0;
  stage.addEventListener("click", (e) => {
    if (panDidMove) return;
    if (e.target !== stage && e.target !== pan && e.target !== img) return;
    const now = Date.now();
    if (now - lastTap < 320) {
      if (userZoom > 1.05) setZoomFit();
      else zoomInStep();
    }
    lastTap = now;
  });

  stage.addEventListener(
    "pointerdown",
    (e) => {
      if (!dialog.open) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!canPanImage()) return;
      e.preventDefault();
      panPointerId = e.pointerId;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOriginTx = tx;
      panOriginTy = ty;
      panDidMove = false;
      stage.setPointerCapture(e.pointerId);
    },
    { capture: true }
  );

  stage.addEventListener(
    "pointermove",
    (e) => {
      if (!dialog.open || panPointerId !== e.pointerId) return;
      if (!canPanImage()) return;
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      if (Math.abs(dx) + Math.abs(dy) > 4) panDidMove = true;
      tx = panOriginTx + dx;
      ty = panOriginTy + dy;
      applyViewerTransform();
      e.preventDefault();
    },
    { capture: true }
  );

  const endPanPointer = (e) => {
    if (panPointerId !== e.pointerId) return;
    panPointerId = null;
    try {
      stage.releasePointerCapture(e.pointerId);
    } catch {
    }
    window.setTimeout(() => {
      panDidMove = false;
    }, 0);
  };
  stage.addEventListener("pointerup", endPanPointer);
  stage.addEventListener("pointercancel", endPanPointer);

  stage.addEventListener(
    "touchstart",
    (e) => {
      if (!dialog.open) return;
      if (e.touches.length === 2) {
        pinchStartDist = touchDistance(e.touches);
        pinchStartZoom = userZoom;
        panPointerId = null;
      }
    },
    { passive: true }
  );

  stage.addEventListener(
    "touchmove",
    (e) => {
      if (!dialog.open) return;
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const dist = touchDistance(e.touches);
      if (pinchStartDist > 0) {
        const ratio = dist / pinchStartDist;
        userZoom = Math.min(MAX_USER_ZOOM, Math.max(1, pinchStartZoom * ratio));
        if (userZoom <= 1.01) userZoom = 1;
        applyViewerTransform();
        stage.classList.toggle("photo-viewer-stage--pan", canPanImage());
      }
    },
    { passive: false }
  );

  stage.addEventListener("touchend", () => {
    if (pinchStartDist > 0) pinchStartDist = 0;
  });

  const blockPageGesture = (e) => {
    if (!document.body.classList.contains("bus-app")) return;
    e.preventDefault();
  };

  ["gesturestart", "gesturechange", "gestureend"].forEach((type) => {
    document.addEventListener(type, blockPageGesture, { passive: false });
  });

  window.addEventListener("resize", () => {
    if (!dialog.open) return;
    setZoomFit();
  });
}

function newStopId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `stop-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getStopPhotos(stop) {
  return window.BusStopPhotos?.getStopPhotos(stop) || [];
}

function normalizeStopPhotos(stop) {
  if (window.BusStopPhotos?.normalizeStopPhotos) {
    return window.BusStopPhotos.normalizeStopPhotos(stop);
  }
  return stop;
}

function maxPhotosPerStop() {
  return window.BusStopPhotos?.MAX_PHOTOS_PER_STOP ?? 12;
}

function getActivePhoto(stop) {
  const photos = getStopPhotos(stop);
  if (!photos.length) return null;
  if (activePhotoId) {
    const hit = photos.find((p) => p.id === activePhotoId);
    if (hit) return hit;
  }
  return photos[photos.length - 1];
}

function getStopCoverThumb(stop) {
  const photos = getStopPhotos(stop);
  const p = photos[photos.length - 1] || photos[0];
  return p?.photoThumb || (typeof stop.photoThumb === "string" ? stop.photoThumb : "");
}

function photoFromDraft(draft, label) {
  return {
    id: newStopId(),
    photoThumb: draft.photoThumb,
    label: typeof label === "string" ? label.trim() : "",
    ocrText: "",
    sections: [],
    updatedAt: new Date().toISOString(),
  };
}

function displayPhotoLabel(photo, index) {
  if (window.BusStopPhotos?.displayPhotoLabel) {
    return window.BusStopPhotos.displayPhotoLabel(photo, index);
  }
  const t = typeof photo?.label === "string" ? photo.label.trim() : "";
  return t || `사진 ${index + 1}`;
}

/** @param {string} currentLabel */
function openPhotoLabelDialog(currentLabel) {
  const dialog = document.querySelector("#photo-label-dialog");
  const input = document.querySelector("#photo-label-input");
  const help = document.querySelector("#photo-label-dialog-help");
  if (!dialog || !input) return;
  if (help) {
    help.textContent =
      "버스 번호나 평일·주말처럼, 이 시간표 사진만 구분할 이름을 적어 주세요.";
  }
  input.value = currentLabel || "";
  dialog.showModal();
  syncBusFormModalScrollLock();
  input.focus();
}

/**
 * @param {"new-stop" | "stop-rename"} mode
 * @param {{ stopName?: string }} values
 */
function openNameDialog(mode, values) {
  const dialog = document.querySelector("#stop-name-dialog");
  const title = document.querySelector("#stop-name-title");
  const help = document.querySelector("#stop-name-dialog-help");
  const stopInput = document.querySelector("#stop-name-input");
  if (!dialog || !stopInput) return;

  const v = values || {};
  if (title) title.textContent = "정류장 이름";
  if (help) {
    help.textContent =
      mode === "new-stop"
        ? "먼저 정류장 이름을 적습니다. 그다음 사진 애칭(버스 번호 등)을 적습니다."
        : "공식 이름이 아니어도 됩니다. 기억하기 쉬운 이름을 적어 주세요.";
  }
  stopInput.setAttribute("required", "");
  stopInput.value = v.stopName || "";
  dialog.showModal();
  syncBusFormModalScrollLock();
  stopInput.focus();
}

function loadBusState() {
  try {
    const raw = localStorage.getItem(BUS_STORAGE_KEY);
    if (!raw) {
      migrateLegacyBusStorage();
      return;
    }
    const data = JSON.parse(raw);
    if (Array.isArray(data.stops)) {
      busStops = data.stops
        .filter((s) => {
          if (!s || typeof s.name !== "string") return false;
          return Boolean(getStopPhotos(s).length || typeof s.photoThumb === "string");
        })
        .map((s) => {
          const stop = {
            id: String(s.id || newStopId()),
            name: s.name,
            photoThumb: typeof s.photoThumb === "string" ? s.photoThumb : "",
            ocrText: typeof s.ocrText === "string" ? s.ocrText : "",
            sections: Array.isArray(s.sections) ? s.sections : [],
            photos: Array.isArray(s.photos) ? s.photos : [],
            updatedAt: s.updatedAt || new Date().toISOString(),
          };
          return normalizeStopPhotos(stop);
        });
    }
  } catch {
    busStops = [];
  }
}

function migrateLegacyBusStorage() {
  try {
    const raw = localStorage.getItem("bus-timetable-v1");
    if (!raw) return;
    const data = JSON.parse(raw);
    if (typeof data.photoThumb !== "string") return;
    busStops = [
      normalizeStopPhotos({
        id: newStopId(),
        name: "저장된 시간표",
        photos: [
          {
            id: newStopId(),
            photoThumb: data.photoThumb,
            ocrText: "",
            sections: [],
            updatedAt: new Date().toISOString(),
          },
        ],
        updatedAt: new Date().toISOString(),
      }),
    ];
    saveBusState();
    localStorage.removeItem("bus-timetable-v1");
  } catch {
  }
}

function saveBusState() {
  try {
    const stateUpdatedAt = new Date().toISOString();
    localStorage.setItem(
      BUS_STORAGE_KEY,
      JSON.stringify({ version: 3, stops: busStops, stateUpdatedAt })
    );
    if (!window.__busCloudSyncApplying) {
      window.dispatchEvent(new CustomEvent("bus-local-state-saved"));
    }
    return true;
  } catch (error) {
    console.error(error);
    setBusStatus(
      "저장 공간이 부족합니다. 정류장을 줄이거나 브라우저 데이터를 비운 뒤 다시 시도해 주세요."
    );
    return false;
  }
}

function syncBusMainVisibility() {
  const main = document.querySelector("#app");
  if (!main || !document.body.classList.contains("bus-app")) return;
  main.hidden = true;
}

function setBusStatus(message) {
  const text = message || "";
  const useModal = shouldBusStatusUseModal(text);
  if (useModal) {
    for (const id of ["photo-label-dialog", "stop-name-dialog"]) {
      const dlg = document.querySelector(`#${id}`);
      if (dlg?.open) dlg.close();
    }
    syncBusFormModalScrollLock();
  }
  const statusDialog = document.querySelector("#bus-status-dialog");

  document.querySelectorAll(".bus-status").forEach((el) => {
    el.textContent = useModal ? "" : text;
  });
  syncBusMainVisibility();

  if (!text) {
    if (statusDialog?.open) statusDialog.close();
    syncBusFormModalScrollLock();
    return;
  }

  if (useModal) {
    showBusStatusModal(text);
    return;
  }

  if (statusDialog?.open) statusDialog.close();
  syncBusFormModalScrollLock();
}


async function handleBusPhoto(input) {
  const file = input?.files?.[0];
  if (!file) return;
  photoPipelineBusy = true;

  setBusStatus("사진을 읽는 중입니다…");
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));

  try {
    const maxW = effectivePhotoMaxWidth();
    const thumb = await compressImageFile(file, maxW, (phase) => {
      if (phase === "enhance") {
        setBusStatus("밝기·선명도를 자동 보정하는 중입니다…");
      } else if (phase === "encode") {
        setBusStatus("보정한 사진을 저장하는 중입니다…");
      }
    });

    pendingStopDraft = { photoThumb: thumb };

    if (pendingStopAction === "add-photo" && replaceStopId) {
      const stop = busStops.find((s) => s.id === replaceStopId);
      if (!stop) return;
      if (getStopPhotos(stop).length >= maxPhotosPerStop()) {
        setBusStatus(`한 정류장에는 사진 ${maxPhotosPerStop()}장까지 넣을 수 있습니다.`);
        pendingStopDraft = null;
        pendingStopAction = null;
        replaceStopId = null;
        return;
      }
      pendingStopAction = "photo-label";
      openPhotoLabelDialog("");
      setBusStatus("이 사진 애칭(버스 번호 등)을 적어 주세요.");
      return;
    }

    if (
      (pendingStopAction === "replace-photo" || pendingStopAction === "replace") &&
      replaceStopId
    ) {
      const stop = busStops.find((s) => s.id === replaceStopId);
      if (!stop) return;
      const photos = getStopPhotos(stop);
      if (!Array.isArray(stop.photos) || !stop.photos.length) {
        stop.photos = [...photos];
      }
      const targetId = replacePhotoId || activePhotoId || photos[photos.length - 1]?.id;
      const old = photos.find((p) => p.id === targetId);
      const photo = photoFromDraft(pendingStopDraft, old?.label || "");
      if (old) photo.id = old.id;
      const idx = stop.photos.findIndex((p) => p.id === targetId);
      if (idx >= 0) stop.photos[idx] = photo;
      else stop.photos.push(photo);
      stop.updatedAt = new Date().toISOString();
      normalizeStopPhotos(stop);
      activeStopId = stop.id;
      activePhotoId = photo.id;
      saveBusState();
      renderStopDetail(stop.id);
      renderStopList();
      setBusStatus("사진을 바꿨습니다.");
      pendingStopDraft = null;
      pendingStopAction = null;
      replaceStopId = null;
      replacePhotoId = null;
      return;
    }

    pendingStopAction = pendingStopAction || "new";
    openNameDialog("new-stop", { stopName: "" });

    setBusStatus("보정을 마쳤습니다. 먼저 정류장 이름을 적어 주세요.");
  } catch (error) {
    console.error(error);
    const hint =
      error?.name === "QuotaExceededError"
        ? "저장 공간이 부족합니다. 다른 정류장 사진을 줄이거나 앱 데이터를 비운 뒤 다시 시도해 주세요."
        : "사진 처리에 실패했습니다. 다른 사진으로 다시 시도해 주세요.";
    setBusStatus(hint);
    pendingStopDraft = null;
    pendingStopAction = null;
    replaceStopId = null;
    replacePhotoId = null;
  } finally {
    if (input) input.value = "";
    photoPipelineBusy = false;
  }
}

function createStopFromDraft(draft, name, photoLabel) {
  const photo = photoFromDraft(draft, photoLabel);
  return normalizeStopPhotos({
    id: newStopId(),
    name,
    photos: [photo],
    updatedAt: new Date().toISOString(),
  });
}

function getActiveStop() {
  if (linkViewStop) return linkViewStop;
  return busStops.find((s) => s.id === activeStopId) || null;
}

function isBusLinkShareView() {
  if (linkViewStop) return true;
  const route =
    typeof window.busRoutes?.parse === "function" ? window.busRoutes.parse() : null;
  return route?.view === "link";
}

function syncDetailReadOnly(readOnly) {
  document.body.classList.toggle("bus-link-share-page", readOnly);
  const detail = document.querySelector("#view-detail");
  if (detail) detail.classList.toggle("detail-readonly", readOnly);
  const actions = document.querySelector("#detail-actions");
  if (actions) actions.hidden = readOnly;
  const grid = document.querySelector(".detail-actions-grid");
  if (grid) grid.hidden = readOnly;
  const shareBtn = document.querySelector("#btn-share-stop");
  if (shareBtn) shareBtn.hidden = readOnly;
  const backBtn = document.querySelector("#btn-back-list");
  if (backBtn) backBtn.hidden = readOnly;
}

function beginReplacePhoto(stop, photoId) {
  if (!stop || !photoId) return;
  pendingStopAction = "replace-photo";
  replaceStopId = stop.id;
  replacePhotoId = photoId;
  activePhotoId = photoId;
  const useCamera = window.confirm("확인 = 카메라로 찍기\n취소 = 앨범에서 고르기");
  const input = document.querySelector(useCamera ? "#file-camera" : "#file-album");
  if (input) input.value = "";
  input?.click();
}

function deletePhotoFromStop(stop, photoId) {
  if (!stop || !photoId) return;
  const photos = getStopPhotos(stop);
  const photo = photos.find((p) => p.id === photoId);
  if (!photo) return;

  if (photos.length <= 1) {
    if (!window.confirm(`"${stop.name}" 정류장의 마지막 사진입니다. 정류장 전체를 삭제할까요?`)) {
      return;
    }
    busStops = busStops.filter((s) => s.id !== stop.id);
    activeStopId = null;
    activePhotoId = null;
    saveBusState();
    showListView();
    renderStopList();
    setBusStatus("정류장을 삭제했습니다.");
    return;
  }

  const label = displayPhotoLabel(photo, photos.findIndex((p) => p.id === photo.id));
  if (!window.confirm(`"${label}" 사진만 삭제할까요?`)) return;
  stop.photos = photos.filter((p) => p.id !== photoId);
  stop.updatedAt = new Date().toISOString();
  normalizeStopPhotos(stop);
  activePhotoId = getStopPhotos(stop).at(-1)?.id || null;
  saveBusState();
  renderStopDetail(stop.id);
  renderStopList();
  setBusStatus("사진을 삭제했습니다.");
}

function photoHasCustomLabel(photo) {
  return Boolean(typeof photo?.label === "string" && photo.label.trim());
}

function collapseListPanelDetails() {
  document.querySelectorAll("#view-list details[open]").forEach((el) => {
    el.open = false;
  });
}

function commitBusRoute(route, { replace = false } = {}) {
  if (!busRouteSync || !window.busRoutes?.hash) return;
  const hash = window.busRoutes.hash(route);
  const url = `${location.pathname}${location.search}${hash}`;
  if (!replace && location.hash === hash) return;
  if (replace) {
    history.replaceState({ busRoute: route }, "", url);
  } else {
    history.pushState({ busRoute: route }, "", url);
  }
}

function bindBusHistory() {
  window.addEventListener("popstate", () => {
    busRouteSync = false;
    const route =
      typeof window.busRoutes?.parse === "function" ? window.busRoutes.parse() : { view: "list" };
    navigateBusRoute(route, { skipRoute: true });
    busRouteSync = true;
  });
}

function goBackOrList() {
  if (location.hash && location.hash !== "#/") {
    history.back();
    return;
  }
  activeStopId = null;
  activePhotoId = null;
  linkViewStop = null;
  showListView({ replaceRoute: true });
  setBusStatus("");
}

function navigateBusRoute(route, { skipRoute = false } = {}) {
  if (!route || route.view === "list") {
    activeStopId = null;
    activePhotoId = null;
    linkViewStop = null;
    showListView({ skipRoute, replaceRoute: true });
    return;
  }
  if (route.view === "link" && route.token) {
    openStopFromLinkToken(route.token, { skipRoute });
    return;
  }
  if (route.view === "stop" && route.id) {
    const stop = busStops.find((s) => s.id === route.id);
    if (stop) {
      activeStopId = stop.id;
      linkViewStop = null;
      renderStopDetail(stop.id, { skipRoute });
      return;
    }
    if (route.linkToken) {
      openStopFromLinkToken(route.linkToken, { skipRoute });
      return;
    }
    const name = route.params?.get("n") || "";
    setBusStatus(
      name
        ? `「${name}」은 예전 링크입니다. 보낸 분에게 「정류장 링크 공유」로 새 링크를 받아 주세요.`
        : "옛 링크입니다. 「정류장 링크 공유」로 만든 새 주소를 열어 주세요."
    );
    activeStopId = null;
    activePhotoId = null;
    showListView({ skipRoute, replaceRoute: true });
  }
}

function stopPayloadForLinkPublish(stop) {
  const photos = getStopPhotos(stop);
  return {
    id: stop.id,
    name: stop.name,
    updatedAt: stop.updatedAt,
    photos: photos.map((p) => ({
      id: p.id,
      photoThumb: p.photoThumb,
      label: p.label || "",
      ocrText: p.ocrText || "",
      sections: Array.isArray(p.sections) ? p.sections : [],
      updatedAt: p.updatedAt || stop.updatedAt,
    })),
  };
}

async function publishStopShareLink(stop) {
  try {
    const statusRes = await fetch("/api/sync-status", { cache: "no-store" });
    const status = await statusRes.json().catch(() => ({}));
    if (statusRes.ok && status.linkTableReady === false) {
      throw new Error(
        "공유 링크 저장소가 아직 없습니다. 운영자에게 Supabase SQL(bus-link-share) 실행을 요청해 주세요."
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("공유 링크 저장소")) throw err;
  }

  const res = await fetch("/api/link-publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stop: stopPayloadForLinkPublish(stop) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data.error === "server_not_configured"
        ? "서버 설정이 없어 링크를 만들 수 없습니다."
        : data.error === "insert_failed"
          ? "공유 링크 저장에 실패했습니다. Supabase에 bus_link_shares 테이블이 있는지 확인해 주세요."
          : "공유 링크를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";
    throw new Error(msg);
  }
  if (!data.token) throw new Error("no_token");
  return String(data.token);
}

async function openStopFromLinkToken(token, { skipRoute = false } = {}) {
  if (!token) {
    showListView({ replaceRoute: true });
    return;
  }
  setBusStatus("정류장 불러오는 중…");
  try {
    const res = await fetch(`/api/link-open?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.stop) {
      throw new Error(data.error || "fetch_failed");
    }
    normalizeStopPhotos(data.stop);
    linkViewStop = { ...data.stop, _linkView: true };
    activeStopId = null;
    activePhotoId = null;
    renderStopDetailForStop(linkViewStop, { skipRoute, linkToken: token });
    setBusStatus("");
  } catch (err) {
    linkViewStop = null;
    setBusStatus(
      err instanceof Error && err.message.includes("서버")
        ? err.message
        : "링크가 만료되었거나 찾을 수 없습니다."
    );
    showListView({ skipRoute, replaceRoute: true });
  }
}

async function shareActiveStopLink() {
  const stop = getActiveStop();
  if (!stop || !window.busRoutes?.buildLinkUrl) return;
  setBusStatus("공유 링크 만드는 중…");
  let token;
  try {
    token = await publishStopShareLink(stop);
  } catch (err) {
    setBusStatus(err instanceof Error ? err.message : "공유 링크를 만들지 못했습니다.");
    return;
  }
  const url = window.busRoutes.buildLinkUrl(token, getAppPublicShareUrl());
  const title = `내버스시간표 — ${stop.name}`;
  const text = `${stop.name} 버스 시간표`;
  setBusStatus("");
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      setBusStatus("링크를 공유했습니다.");
      return;
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setBusStatus("정류장 링크를 복사했습니다. 카톡 등에 붙여 넣으세요.");
  } catch {
    setBusStatus("링크 복사에 실패했습니다.");
  }
}

function showListView(opts = {}) {
  linkViewStop = null;
  syncDetailReadOnly(false);
  document.querySelector("#view-list")?.removeAttribute("hidden");
  document.querySelector("#view-detail")?.setAttribute("hidden", "");
  document.querySelector("#view-app-share")?.setAttribute("hidden", "");
  if (!opts.skipRoute) {
    commitBusRoute({ view: "list" }, { replace: Boolean(opts.replaceRoute) });
  }
}

function showDetailView() {
  collapseListPanelDetails();
  document.querySelector("#view-list")?.setAttribute("hidden", "");
  document.querySelector("#view-app-share")?.setAttribute("hidden", "");
  document.querySelector("#view-detail")?.removeAttribute("hidden");
}

function getAppPublicShareUrl() {
  const canonical = document.querySelector('link[rel="canonical"]')?.href?.trim();
  if (canonical) return canonical;
  const fromConfig = typeof pwaConfig?.publicUrl === "string" ? pwaConfig.publicUrl.trim() : "";
  if (fromConfig) {
    return fromConfig.endsWith("/") ? fromConfig : `${fromConfig}/`;
  }
  const u = new URL(location.href);
  u.search = "";
  u.hash = "";
  return u.href;
}

function qrCodeImageUrl(text, size = 512) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=14&data=${encodeURIComponent(text)}`;
}

function formatAppShareUrlDisplay(absoluteUrl) {
  try {
    const host = new URL(absoluteUrl).hostname;
    if (host) return host;
  } catch {
    /* ignore */
  }
  return absoluteUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function renderAppSharePage() {
  const url = getAppPublicShareUrl();
  const displayUrl = formatAppShareUrlDisplay(url);
  const urlEl = document.querySelector("#app-share-url");
  const qrImg = document.querySelector("#app-share-qr");
  if (urlEl) urlEl.textContent = displayUrl;
  if (qrImg) {
    qrImg.src = qrCodeImageUrl(url, 512);
    qrImg.alt = `버스첩 앱 주소 QR 코드 — ${displayUrl}`;
  }
}

function showAppShareView() {
  collapseListPanelDetails();
  document.querySelector("#view-list")?.setAttribute("hidden", "");
  document.querySelector("#view-detail")?.setAttribute("hidden", "");
  document.querySelector("#view-app-share")?.removeAttribute("hidden");
  renderAppSharePage();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindAppShareUi() {
  document.querySelector("#app-share-btn")?.addEventListener("click", () => {
    showAppShareView();
  });
  document.querySelector("#btn-back-from-app-share")?.addEventListener("click", () => {
    showListView();
    setBusStatus("");
  });
}

function isAppStandaloneInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true
  );
}

function updateInstallButtonVisibility() {
  if (!installBtn) return;
  installBtn.hidden = isAppStandaloneInstalled();
}

function updateHomeIntroChrome() {
  const lede = document.querySelector("#app-lede");
  const divider = document.querySelector("#app-home-divider");
  const hasStops = busStops.length > 0;
  if (lede) lede.hidden = hasStops;
  if (divider) divider.hidden = !hasStops;
}

function notifyBusStopsChanged() {
  try {
    window.dispatchEvent(
      new CustomEvent("bus-stops-changed", { detail: { count: busStops.length } })
    );
  } catch {
    /* ignore */
  }
}

function renderStopList() {
  const list = document.querySelector("#stop-list");
  const empty = document.querySelector("#stop-list-empty");
  if (!list || !empty) return;

  list.replaceChildren();
  if (!busStops.length) {
    empty.hidden = false;
    updateHomeIntroChrome();
    notifyBusStopsChanged();
    return;
  }
  empty.hidden = true;

  for (const stop of busStops) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "stop-card";
    btn.dataset.stopId = stop.id;

    const row = document.createElement("span");
    row.className = "stop-card-row";

    const name = document.createElement("span");
    name.className = "stop-card-name";
    name.textContent = stop.name;
    name.title = stop.name;

    const dateText = formatStopDate(stop.updatedAt);
    const date = document.createElement("time");
    date.className = "stop-card-date";
    date.dateTime = stop.updatedAt || "";
    date.textContent = dateText;

    row.append(name, date);
    btn.append(row);
    btn.addEventListener("click", () => {
      activeStopId = stop.id;
      activePhotoId = null;
      renderStopDetail(stop.id);
    });
    li.append(btn);
    list.append(li);
  }
  updateHomeIntroChrome();
  notifyBusStopsChanged();
}


function renderStopDetail(stopId, opts = {}) {
  const stop = busStops.find((s) => s.id === stopId);
  if (!stop) {
    showListView({ replaceRoute: true });
    return;
  }
  linkViewStop = null;
  renderStopDetailForStop(stop, { ...opts, stopId });
}

function renderStopDetailForStop(stop, opts = {}) {
  if (!stop) {
    showListView({ replaceRoute: true });
    return;
  }

  const photos = getStopPhotos(stop);
  if (!photos.length) {
    showListView({ replaceRoute: true });
    return;
  }

  const readOnly = Boolean(stop._linkView) || isBusLinkShareView();
  if (!readOnly) {
    activeStopId = stop.id;
  }

  if (!activePhotoId || !photos.some((p) => p.id === activePhotoId)) {
    activePhotoId = photos[photos.length - 1].id;
  }

  showDetailView();
  syncDetailReadOnly(readOnly);
  const title = document.querySelector("#detail-stop-name");
  const meta = document.querySelector("#detail-updated");
  const list = document.querySelector("#detail-photo-list");

  if (title) title.textContent = stop.name;
  if (meta) {
    if (readOnly) {
      meta.textContent = "";
      meta.hidden = true;
    } else {
      meta.hidden = false;
      const count = photos.length;
      meta.textContent = `사진 ${count}장 · 마지막 저장: ${formatStopDate(stop.updatedAt)}`;
    }
  }

  if (list) {
    list.replaceChildren();
    photos.forEach((p, index) => {
      const li = document.createElement("li");
      li.className = "detail-photo-card panel-lite";

      const hasLabel = photoHasCustomLabel(p);
      const labelTitle = document.createElement("p");
      labelTitle.className = "detail-photo-card-title";
      labelTitle.textContent = hasLabel
        ? displayPhotoLabel(p, index)
        : "버스 번호·애칭 적기";
      if (!hasLabel) labelTitle.classList.add("is-placeholder");

      const hit = document.createElement("button");
      hit.type = "button";
      hit.className = "detail-photo-hit";
      hit.setAttribute("aria-label", `${displayPhotoLabel(p, index)} 크게 보기`);
      const img = document.createElement("img");
      img.src = p.photoThumb;
      img.alt = `${stop.name} ${displayPhotoLabel(p, index)}`;
      img.loading = index < 2 ? "eager" : "lazy";
      img.width = 960;
      img.height = 720;
      hit.append(img);
      hit.addEventListener("click", () => {
        if (typeof window.busAppOpenPhotoViewer === "function") {
          window.busAppOpenPhotoViewer(p);
        }
      });

      if (readOnly) {
        if (hasLabel) {
          li.append(labelTitle, hit);
        } else {
          li.append(hit);
        }
        const hint = document.createElement("p");
        hint.className = "detail-photo-card-hint detail-photo-card-hint--share";
        hint.textContent = "사진을 누르면 크게 볼 수 있습니다";
        li.append(hint);
      } else if (!readOnly) {
        const actions = document.createElement("div");
        actions.className = "detail-photo-card-actions";

        const btnRenamePhoto = document.createElement("button");
        btnRenamePhoto.type = "button";
        btnRenamePhoto.className = "big-btn secondary detail-photo-card-action";
        btnRenamePhoto.textContent = "이 사진 이름 바꾸기";
        btnRenamePhoto.addEventListener("click", () => {
          pendingStopAction = "rename-photo-label";
          pendingPhotoLabelEditId = p.id;
          openPhotoLabelDialog(p.label || "");
        });

        const btnViewLarge = document.createElement("button");
        btnViewLarge.type = "button";
        btnViewLarge.className = "big-btn primary detail-photo-card-action";
        btnViewLarge.textContent = "이 사진 크게보기";
        btnViewLarge.addEventListener("click", () => {
          if (typeof window.busAppOpenPhotoViewer === "function") {
            window.busAppOpenPhotoViewer(p);
          }
        });

        const btnDeletePhoto = document.createElement("button");
        btnDeletePhoto.type = "button";
        btnDeletePhoto.className = "big-btn ghost danger-text detail-photo-card-action";
        btnDeletePhoto.textContent = "이 사진 삭제";
        btnDeletePhoto.addEventListener("click", () => deletePhotoFromStop(stop, p.id));

        const btnReplace = document.createElement("button");
        btnReplace.type = "button";
        btnReplace.className = "big-btn secondary detail-photo-card-action";
        btnReplace.textContent = "이 사진 다시 찍기";
        btnReplace.addEventListener("click", () => beginReplacePhoto(stop, p.id));

        actions.append(btnRenamePhoto, btnViewLarge, btnDeletePhoto, btnReplace);
        li.append(labelTitle, hit, actions);
      } else {
        li.append(labelTitle, hit);
      }
      list.append(li);
    });
  }

  setBusStatus("");
  if (!opts.skipRoute) {
    if (opts.linkToken) {
      commitBusRoute({ view: "link", token: opts.linkToken });
    } else {
      const q = new URLSearchParams();
      if (stop.name) q.set("n", stop.name);
      commitBusRoute({ view: "stop", id: stop.id, params: q });
    }
  }
}

function formatStopDate(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  } catch {
    return "";
  }
}


/**
 * 저장용 사진: 크기 맞춤 + 대비·선명 보정 (OCR 없음)
 * @param {File} file
 * @param {number} maxWidth
 */
function effectivePhotoMaxWidth() {
  const narrow =
    window.matchMedia("(max-width: 768px)").matches ||
    /iPhone|iPad|Android/i.test(navigator.userAgent);
  return narrow ? Math.min(PHOTO_MAX_WIDTH, 1280) : PHOTO_MAX_WIDTH;
}

/** @param {File} file */
async function loadImageSourceFromFile(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return { kind: "bitmap", source: await createImageBitmap(file) };
    } catch {
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image-load"));
      el.src = url;
    });
    return { kind: "image", source: img };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * @param {File} file
 * @param {number} maxWidth
 * @param {(phase: "enhance" | "encode") => void} [progress]
 */
async function compressImageFile(file, maxWidth, progress) {
  const loaded = await loadImageSourceFromFile(file);
  const srcW = loaded.source.width;
  const srcH = loaded.source.height;
  const scale = Math.min(1, maxWidth / srcW);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(loaded.source, 0, 0, w, h);
  if (loaded.kind === "bitmap" && loaded.source.close) loaded.source.close();
  progress?.("enhance");
  try {
    await autoOptimizePhotoOnCanvas(ctx, w, h);
  } catch (error) {
    console.warn("photo enhance skipped", error);
  }
  progress?.("encode");
  await yieldToUi();
  return canvas.toDataURL("image/jpeg", PHOTO_JPEG_QUALITY);
}

function yieldToUi() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

/** 밝기에 맞춰 대비·선명도 자동 조절 (사용자 설정 없음) */
/** @param {CanvasRenderingContext2D} ctx */
async function autoOptimizePhotoOnCanvas(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const px = imageData.data;
  let lumSum = 0;
  let samples = 0;
  for (let i = 0; i < px.length; i += 16) {
    lumSum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    samples += 1;
  }
  const meanLum = samples ? lumSum / samples : 128;
  let contrast = 1.16;
  let brightness = 8;
  let sharpen = 0.48;
  let gamma = 1;
  if (meanLum < 95) {
    contrast = 1.24;
    brightness = 18;
    sharpen = 0.44;
    gamma = 0.88;
  } else if (meanLum > 175) {
    contrast = 1.1;
    brightness = -4;
    sharpen = 0.38;
    gamma = 1.05;
  }

  const step = Math.max(65536, Math.floor(px.length / 8));
  for (let i = 0; i < px.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = px[i + c] / 255;
      if (gamma !== 1) v = Math.pow(v, gamma);
      v = (v * 255 - 128) * contrast + 128 + brightness;
      px[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    if (i > 0 && i % step === 0) await yieldToUi();
  }

  await sharpenRgbInPlaceAsync(px, width, height, sharpen);
  ctx.putImageData(imageData, 0, 0);
}

/**
 * @param {Uint8ClampedArray} pixels
 * @param {number} width
 * @param {number} height
 * @param {number} strength
 */
async function sharpenRgbInPlaceAsync(pixels, width, height, strength) {
  const src = new Uint8ClampedArray(pixels);
  const row = width * 4;
  const yStep = Math.max(8, Math.floor(height / 12));
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * row + x * 4;
      for (let c = 0; c < 3; c++) {
        const center = src[i + c];
        const neighbors =
          src[i + c - row] + src[i + c + row] + src[i + c - 4] + src[i + c + 4];
        const v = center + strength * (4 * center - neighbors);
        pixels[i + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      }
    }
    if (y > 1 && y % yStep === 0) await yieldToUi();
  }
}


async function loadConfig() {
  try {
    const response = await fetch("./pwa.config.json", { cache: "no-store" });
    if (response.ok) pwaConfig = await response.json();
  } catch {
    pwaConfig = null;
  }
}

function applyConfigToHero() {
  if (!pwaConfig) return;
  const title = document.querySelector("#app-title");
  const lede = document.querySelector("#app-lede");
  if (title && pwaConfig.name) title.textContent = pwaConfig.name;
  if (lede && pwaConfig.description && !document.body.classList.contains("bus-app")) {
    lede.textContent = pwaConfig.description;
  }
}

function cachePrefix() {
  return pwaConfig?.cachePrefix || "pwa-starter";
}

function renderNetwork() {
  if (!netState) return;
  const online = navigator.onLine;
  netState.textContent = online ? "온라인" : "오프라인";
  netState.dataset.state = online ? "online" : "offline";
}

function renderDisplayMode() {
  if (!displayState) return;
  const installed = window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
  displayState.textContent = installed ? "설치된 앱" : "브라우저 탭";
  displayState.dataset.state = installed ? "installed" : "browser";
}

function bindInstall() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (installBtn) {
      installBtn.disabled = false;
    }
    updateInstallButtonVisibility();
  });

  installBtn?.addEventListener("click", async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installBtn.disabled = true;
      return;
    }
    setBusStatus(
      "브라우저 메뉴(⋮)에서 '앱 설치' 또는 '홈 화면에 추가'를 눌러 주세요. iPhone은 공유(↑) 버튼을 이용하세요."
    );
  });

  window.addEventListener("appinstalled", () => {
    renderDisplayMode();
    updateInstallButtonVisibility();
  });
}

function bindServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    swState.textContent = "미지원";
    installHint.textContent = "이 브라우저는 서비스 워커를 지원하지 않습니다.";
    return;
  }

  if (location.protocol === "file:") {
    swState.textContent = "대기";
    swState.dataset.state = "waiting";
    installHint.textContent = "file:// 로 열면 서비스 워커가 등록되지 않습니다. serve.cmd 로 여세요.";
    return;
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadOnControllerChange) location.reload();
  });

  syncServiceWorker().catch((error) => {
    swState.textContent = "오류";
    swState.dataset.state = "waiting";
    installHint.textContent = `서비스 워커 등록 실패: ${error.message}`;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncServiceWorker().catch(() => {});
    }
  });

  versionPollId = window.setInterval(() => {
    if (document.visibilityState === "visible") {
      syncServiceWorker().catch(() => {});
    }
  }, 3000);

  updateBtn.addEventListener("click", () => {
    if (document.body.classList.contains("bus-app")) {
      applyAppUpdate();
      return;
    }
    if (!registration?.waiting) return;
    reloadOnControllerChange = true;
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  });

  refreshCacheBtn?.addEventListener("click", refreshCacheList);
}

function getControllerBuild() {
  const script = navigator.serviceWorker.controller?.scriptURL;
  if (!script) return 0;
  const build = new URL(script, location.href).searchParams.get("build");
  return build ? Number(build) : 0;
}

async function fetchVersionInfo() {
  const response = await fetch(`./version.json?check=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}

function isLocalDevHost() {
  const { hostname, protocol } = window.location;
  return protocol.startsWith("http")
    && (hostname === "localhost" || hostname === "127.0.0.1");
}

function cacheNameForBuild(build) {
  return build ? `${cachePrefix()}-${build}` : "";
}

function renderBuildStatus(serverBuild, controllerBuild, versionInfo) {
  const latestName =
    versionInfo?.cacheName || (serverBuild ? cacheNameForBuild(serverBuild) : "");
  const runningName = controllerBuild ? cacheNameForBuild(controllerBuild) : "";

  if (runningName && serverBuild && controllerBuild < serverBuild) {
    swVersion.textContent = `${runningName} → ${latestName}`;
    return;
  }

  swVersion.textContent = runningName || latestName || "서버 빌드 없음";
}

function setDevServerHint(versionInfo) {
  if (!isLocalDevHost()) {
    return;
  }

  if (!versionInfo) {
    installHint.textContent =
      "serve.cmd 로 서버를 켜 두세요. Live Server·파일 더블클릭으로는 빌드가 안 올라갑니다.";
    return;
  }

  if (installHint.textContent.includes("확인")) {
    installHint.textContent =
      "HTML·CSS·JS 저장 후 serve가 version.json을 올립니다(약 3초마다 확인).";
  }
}

async function syncServiceWorker() {
  const versionInfo = await fetchVersionInfo();
  const serverBuild = versionInfo?.build ?? 0;
  const controllerBuild = getControllerBuild();

  renderBuildStatus(serverBuild, controllerBuild, versionInfo);

  if (document.body.classList.contains("bus-app") && versionInfo) {
    const seen = readSeenAppVersion();
    if (seen && serverVersionIsNewer(versionInfo, seen)) {
      showAppUpdateBanner(versionInfo);
    }
  }
  setDevServerHint(versionInfo);

  if (!versionInfo) {
    swState.textContent = "서버 필요";
    swState.dataset.state = "waiting";
    updateBtn.hidden = true;
    return;
  }

  const swUrl = `./sw.js?build=${serverBuild}`;
  const shouldRegister =
    !registration || (serverBuild > controllerBuild && serverBuild > registeredTargetBuild);

  if (shouldRegister) {
    registration = await navigator.serviceWorker.register(swUrl, { scope: "./" });
    registeredTargetBuild = serverBuild;
    watchUpdates(registration);
  }

  await registration.update();
  await navigator.serviceWorker.ready;

  const waiting = registration.waiting && navigator.serviceWorker.controller;
  if (serverBuild > controllerBuild && waiting) {
    showUpdate(serverBuild);
  } else {
    updateBtn.hidden = true;
    updateBtn.disabled = false;
    if (serverBuild > controllerBuild) {
      swState.textContent = "캐시 설치 중";
      swState.dataset.state = "waiting";
    } else {
      swState.textContent = "실행 중";
      swState.dataset.state = "active";
    }
  }

  if (lastListedBuild !== serverBuild) {
    lastListedBuild = serverBuild;
    await refreshCacheList();
  }
}

function watchUpdates(reg) {
  if (watchedRegistrations.has(reg)) return;
  watchedRegistrations.add(reg);

  if (reg.waiting && navigator.serviceWorker.controller) {
    const build = new URL(reg.waiting.scriptURL, location.href).searchParams.get("build");
    showUpdate(build ? Number(build) : undefined);
  }

  reg.addEventListener("updatefound", () => {
    const worker = reg.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        syncServiceWorker().catch(() => {});
      }
    });
  });
}

function showUpdate(build) {
  if (document.body.classList.contains("bus-app")) {
    fetchVersionInfo().then((info) => {
      showAppUpdateBanner(info || (build != null ? { build } : null));
    });
    return;
  }
  updateBtn.hidden = false;
  updateBtn.disabled = false;
  swState.textContent = "업데이트 대기";
  swState.dataset.state = "waiting";
  const label = build ? `빌드 ${build}` : "새 버전";
  installHint.textContent =
    `${label} 캐시가 준비됐습니다. 업데이트 적용을 누르면 새 워커로 바뀝니다.`;
}

async function refreshCacheList() {
  if (!cacheList || !("caches" in window)) return;
  const names = await caches.keys();
  const items = [];
  for (const name of names) {
    const cache = await caches.open(name);
    const requests = await cache.keys();
    requests.forEach((request) => {
      items.push(`${name}  ·  ${new URL(request.url).pathname}`);
    });
  }
  cacheList.replaceChildren(
    ...items.map((label) => {
      const li = document.createElement("li");
      li.textContent = label;
      return li;
    })
  );
  if (!items.length) {
    const li = document.createElement("li");
    li.textContent = "캐시가 아직 없습니다.";
    cacheList.append(li);
  }
}

function normalizeBusStopsFromCloud(stops) {
  if (!Array.isArray(stops)) return [];
  return stops
    .filter((s) => {
      if (!s || typeof s.name !== "string") return false;
      return Boolean(getStopPhotos(s).length || typeof s.photoThumb === "string");
    })
    .map((s) =>
      normalizeStopPhotos({
        id: String(s.id || newStopId()),
        name: s.name,
        photoThumb: typeof s.photoThumb === "string" ? s.photoThumb : "",
        ocrText: typeof s.ocrText === "string" ? s.ocrText : "",
        sections: Array.isArray(s.sections) ? s.sections : [],
        photos: Array.isArray(s.photos) ? s.photos : [],
        updatedAt: s.updatedAt || new Date().toISOString(),
      })
    );
}

window.busAppGetLocalStopState = function busAppGetLocalStopState() {
  try {
    const raw = localStorage.getItem(BUS_STORAGE_KEY);
    if (!raw) return { version: 2, stops: [] };
    return JSON.parse(raw);
  } catch {
    return { version: 2, stops: [] };
  }
};

window.setBusStatus = setBusStatus;

window.busAppClearAllLocalData = function busAppClearAllLocalData() {
  busStops = [];
  activeStopId = null;
  activePhotoId = null;
  try {
    localStorage.removeItem(BUS_STORAGE_KEY);
    localStorage.removeItem("bus-timetable-v1");
  } catch {
    /* ignore */
  }
  showListView();
  renderStopList();
  updateHomeIntroChrome();
  notifyBusStopsChanged();
};

window.busAppApplyCloudStops = function busAppApplyCloudStops(stops, meta) {
  busStops = normalizeBusStopsFromCloud(stops);
  const stateUpdatedAt =
    typeof meta?.stateUpdatedAt === "string" && meta.stateUpdatedAt
      ? meta.stateUpdatedAt
      : new Date().toISOString();
  window.__busCloudSyncApplying = true;
  try {
    localStorage.setItem(
      BUS_STORAGE_KEY,
      JSON.stringify({ version: 3, stops: busStops, stateUpdatedAt })
    );
  } catch (error) {
    console.error(error);
    setBusStatus(
      "저장 공간이 부족합니다. 정류장을 줄이거나 브라우저 데이터를 비운 뒤 다시 시도해 주세요."
    );
    return false;
  } finally {
    window.__busCloudSyncApplying = false;
  }
  renderStopList();
  if (activeStopId) {
    const still = busStops.find((s) => s.id === activeStopId);
    if (still) renderStopDetail(activeStopId);
    else {
      activeStopId = null;
      showListView();
    }
  }
  return true;
};
