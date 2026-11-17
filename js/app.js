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

/** 등록 시 사진만 저장 + 기기에서 선명도 보정 */
const REGISTER_PHOTO_ONLY = true;
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
const AI_SETTINGS_KEY = "bus-ai-settings";
const TESSERACT_CDN =
  "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
const DEFAULT_AI_ENDPOINT = "/api/ocr-refine";

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
/** @type {{ photoThumb: string, ocrText: string, sections: { title: string | null, lines: string[] }[] } | null} */
let pendingStopDraft = null;
/** @type {"new" | "replace" | "rename" | "add-photo" | "replace-photo" | "photo-label" | "rename-photo-label" | null} */
let pendingStopAction = null;
/** @type {string | null} */
let pendingPhotoLabelEditId = null;
/** @type {string | null} */
let replaceStopId = null;
/** 사진 처리 중 — 자동 업데이트 새로고침 방지 */
let photoPipelineBusy = false;

/** 새 앱 로직은 이 함수에 넣으세요. */
function initApp() {
  if (!document.body.classList.contains("bus-app")) return;

  loadBusState();
  bindBusUi();
  bindPhotoViewer();
  bindSamsungPinchGuard();
  bindAppUpdateUi();
  showListView();
  renderStopList();
}

const APP_VERSION_SEEN_KEY = "bus-app-version-seen-build";
let appVersionPollId = null;

function bindAppUpdateUi() {
  document.querySelector("#app-update-apply")?.addEventListener("click", () => {
    applyAppUpdate();
  });
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

function getAiSettings() {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        auto: parsed.auto !== false,
        endpoint:
          typeof parsed.endpoint === "string" && parsed.endpoint.trim()
            ? parsed.endpoint.trim()
            : DEFAULT_AI_ENDPOINT,
      };
    }
  } catch {
  }
  return { auto: false, endpoint: DEFAULT_AI_ENDPOINT };
}

function saveAiSettings(settings) {
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
}

function bindBusUi() {
  const fileCamera = document.querySelector("#file-camera");
  const fileAlbum = document.querySelector("#file-album");
  const btnNewCamera = document.querySelector("#btn-new-camera");
  const btnNewAlbum = document.querySelector("#btn-new-album");
  const btnBack = document.querySelector("#btn-back-list");
  const btnRename = document.querySelector("#btn-rename-stop");
  const btnReplace = document.querySelector("#btn-replace-photo");
  const btnAddCamera = document.querySelector("#btn-add-photo-camera");
  const btnAddAlbum = document.querySelector("#btn-add-photo-album");
  const btnDeletePhoto = document.querySelector("#btn-delete-photo");
  const btnDelete = document.querySelector("#btn-delete-stop");
  const nameDialog = document.querySelector("#stop-name-dialog");
  const nameForm = document.querySelector("#stop-name-form");
  const nameCancel = document.querySelector("#stop-name-cancel");

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
  btnBack?.addEventListener("click", () => {
    activeStopId = null;
    activePhotoId = null;
    showListView();
    setBusStatus("");
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

  btnReplace?.addEventListener("click", () => {
    const stop = getActiveStop();
    if (!stop) return;
    pendingStopAction = "replace-photo";
    replaceStopId = stop.id;
    replacePhotoId = getActivePhoto(stop)?.id || null;
    const useCamera = window.confirm("확인 = 카메라로 찍기\n취소 = 앨범에서 고르기");
    const input = document.querySelector(useCamera ? "#file-camera" : "#file-album");
    if (input) input.value = "";
    input?.click();
  });

  btnDeletePhoto?.addEventListener("click", () => {
    const stop = getActiveStop();
    const photo = getActivePhoto(stop);
    if (!stop || !photo) return;
    const photos = getStopPhotos(stop);
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
    stop.photos = photos.filter((p) => p.id !== photo.id);
    stop.updatedAt = new Date().toISOString();
    normalizeStopPhotos(stop);
    activePhotoId = getStopPhotos(stop).at(-1)?.id || null;
    saveBusState();
    renderStopDetail(stop.id);
    renderStopList();
    setBusStatus("사진을 삭제했습니다.");
  });

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
    pendingPhotoLabelEditId = null;
    nameDialog?.close();
  });

  nameForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#stop-name-input");
    const photoLabelInput = document.querySelector("#photo-label-input");
    const name = input?.value?.trim();
    const photoLabel = photoLabelInput?.value?.trim() || "";

    if (pendingStopAction === "rename") {
      if (!name) return;
      const stop = getActiveStop();
      if (stop) {
        stop.name = name;
        stop.updatedAt = new Date().toISOString();
        saveBusState();
        renderStopDetail(stop.id);
        renderStopList();
        setBusStatus("이름을 바꿨습니다.");
      }
    } else if (pendingStopAction === "rename-photo-label" && pendingPhotoLabelEditId) {
      if (!photoLabel) return;
      const stop = getActiveStop();
      if (stop) {
        const photos = getStopPhotos(stop);
        const hit = photos.find((p) => p.id === pendingPhotoLabelEditId);
        if (hit) hit.label = photoLabel;
        stop.photos = photos;
        stop.updatedAt = new Date().toISOString();
        normalizeStopPhotos(stop);
        saveBusState();
        renderStopDetail(stop.id);
        renderStopList();
        setBusStatus("사진 이름을 바꿨습니다.");
      }
    } else if (pendingStopAction === "photo-label" && pendingStopDraft && replaceStopId) {
      if (!photoLabel) return;
      const stop = busStops.find((s) => s.id === replaceStopId);
      if (!stop) return;
      if (getStopPhotos(stop).length >= maxPhotosPerStop()) {
        setBusStatus(`한 정류장에는 사진 ${maxPhotosPerStop()}장까지 넣을 수 있습니다.`);
      } else {
        const photo = photoFromDraft(pendingStopDraft, photoLabel);
        if (!Array.isArray(stop.photos)) stop.photos = getStopPhotos(stop);
        stop.photos.push(photo);
        stop.updatedAt = new Date().toISOString();
        normalizeStopPhotos(stop);
        activeStopId = stop.id;
        activePhotoId = photo.id;
        saveBusState();
        renderStopDetail(stop.id);
        renderStopList();
        setBusStatus("시간표 사진을 추가했습니다.");
      }
    } else if (pendingStopAction === "new" && pendingStopDraft) {
      if (!name) return;
      const stop = createStopFromDraft(pendingStopDraft, name, photoLabel);
      busStops.unshift(stop);
      activeStopId = stop.id;
      activePhotoId = getStopPhotos(stop).at(-1)?.id || null;
      saveBusState();
      renderStopDetail(stop.id);
      renderStopList();
      setBusStatus("정류장을 저장했습니다.");
    }

    pendingStopDraft = null;
    pendingStopAction = null;
    replaceStopId = null;
    replacePhotoId = null;
    pendingPhotoLabelEditId = null;
    nameDialog?.close();
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
  const titleEl = document.querySelector("#photo-viewer-title");
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
    const label = displayPhotoLabel(photo, index);
    titleEl.textContent = photos.length > 1 ? `${stop.name} · ${label}` : stop.name;
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
    ocrText: draft.ocrText || "",
    sections: Array.isArray(draft.sections) ? draft.sections : [],
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

/**
 * @param {"stop-only" | "stop-and-photo" | "photo-only" | "stop-rename"} mode
 */
function openNameDialog(mode, values) {
  const dialog = document.querySelector("#stop-name-dialog");
  const title = document.querySelector("#stop-name-title");
  const help = document.querySelector("#stop-name-dialog-help");
  const stopWrap = document.querySelector("#stop-name-field-wrap");
  const stopInput = document.querySelector("#stop-name-input");
  const photoWrap = document.querySelector("#stop-photo-label-wrap");
  const photoInput = document.querySelector("#photo-label-input");
  const caption = document.querySelector("#stop-photo-label-caption");
  if (!dialog || !stopInput || !photoInput) return;

  const v = values || {};

  if (mode === "photo-only") {
    if (title) title.textContent = "사진 이름";
    if (help) {
      help.textContent = "버스 번호나 평일·주말처럼 기억하기 쉬운 이름을 적어 주세요.";
    }
    if (stopWrap) stopWrap.hidden = true;
    if (photoWrap) photoWrap.hidden = false;
    stopInput.removeAttribute("required");
    photoInput.setAttribute("required", "");
    if (caption) caption.textContent = "이 사진 이름 (버스 번호·애칭)";
    stopInput.value = "";
    photoInput.value = v.photoLabel || "";
    photoInput.focus();
  } else if (mode === "stop-rename") {
    if (title) title.textContent = "정류장 이름";
    if (help) {
      help.textContent = "공식 이름이 아니어도 됩니다. 기억하기 쉬운 이름을 적어 주세요.";
    }
    if (stopWrap) stopWrap.hidden = false;
    if (photoWrap) photoWrap.hidden = true;
    stopInput.setAttribute("required", "");
    photoInput.removeAttribute("required");
    stopInput.value = v.stopName || "";
    photoInput.value = "";
    stopInput.focus();
  } else if (mode === "stop-and-photo") {
    if (title) title.textContent = "정류장·사진 이름";
    if (help) {
      help.textContent =
        "정류장 이름과, 이 사진(버스 번호 등) 이름을 각각 적어 주세요.";
    }
    if (stopWrap) stopWrap.hidden = false;
    if (photoWrap) photoWrap.hidden = false;
    stopInput.setAttribute("required", "");
    photoInput.setAttribute("required", "");
    if (caption) caption.textContent = "첫 사진 이름 (버스 번호·애칭)";
    stopInput.value = v.stopName || "";
    photoInput.value = v.photoLabel || "";
    stopInput.focus();
  } else {
    if (title) title.textContent = "정류장 이름";
    if (help) {
      help.textContent = "공식 이름이 아니어도 됩니다. 기억하기 쉬운 이름을 적어 주세요.";
    }
    if (stopWrap) stopWrap.hidden = false;
    if (photoWrap) photoWrap.hidden = true;
    stopInput.setAttribute("required", "");
    photoInput.removeAttribute("required");
    stopInput.value = v.stopName || "";
    photoInput.value = "";
    stopInput.focus();
  }

  dialog.showModal();
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
          if (!stop.photos.length && stop.photoThumb) {
            stop.sections = stop.sections.length
              ? stop.sections
              : buildSectionsFromOcr(stop.ocrText || "");
          }
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
  document.querySelectorAll(".bus-status").forEach((el) => {
    el.textContent = text;
  });
  syncBusMainVisibility();
}

function setOcrProgress(show, value) {
  const bars = document.querySelectorAll(".ocr-progress");
  bars.forEach((bar) => {
    bar.hidden = !show;
    if (!show) bar.removeAttribute("value");
    else if (typeof value === "number") bar.value = Math.round(value * 100);
  });
  syncBusMainVisibility();
}

async function handleBusPhoto(input) {
  const file = input?.files?.[0];
  if (!file) return;
  photoPipelineBusy = true;

  if (!REGISTER_PHOTO_ONLY && !navigator.onLine) {
    setBusStatus("등록하려면 인터넷이 필요합니다. 와이파이·데이터를 켠 뒤 다시 시도해 주세요.");
    pendingStopAction = null;
    return;
  }

  setBusStatus(
    REGISTER_PHOTO_ONLY
      ? "사진을 읽는 중입니다…"
      : "사진을 저장합니다. 잠시만 기다려 주세요."
  );
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));

  try {
    const maxW = effectivePhotoMaxWidth();
    const thumb = await compressImageFile(file, maxW, (phase) => {
      if (!REGISTER_PHOTO_ONLY) return;
      if (phase === "enhance") {
        setBusStatus("밝기·선명도를 자동 보정하는 중입니다…");
      } else if (phase === "encode") {
        setBusStatus("보정한 사진을 저장하는 중입니다…");
      }
    });
    let text = "";
    let sections = [];
    let ocrSource = "photo";

    if (!REGISTER_PHOTO_ONLY) {
      setOcrProgress(true, 0);
      const blob = await fetch(thumb).then((r) => r.blob());
      const ocr = await recognizeTextFromImage(blob);
      text = ocr.text.trim();
      ocrSource = "tesseract";

      if (shouldUseAiRefineOnRegister()) {
        setBusStatus("사진을 저장하는 중입니다. 잠시만 기다려 주세요.");
        const ai = await refineTimetableWithAi(thumb);
        if (ai?.text) {
          text = ai.text.trim();
          ocrSource = "ai";
        }
      }

      sections = buildSectionsFromOcr(text);
      if (isOcrLowQuality(text)) {
        text = "";
        sections = [];
      }
      setOcrProgress(false);
    }

    pendingStopDraft = {
      photoThumb: thumb,
      ocrText: text,
      sections,
      ocrSource,
    };

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
      openNameDialog("photo-only", { photoLabel: "" });
      setBusStatus("이 사진 이름을 적어 주세요. (버스 번호·애칭)");
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
    openNameDialog("stop-and-photo", { stopName: "", photoLabel: "" });

    setBusStatus(
      REGISTER_PHOTO_ONLY
        ? "보정을 마쳤습니다. 정류장·사진 이름을 적어 주세요."
        : "정류장·사진 이름을 적어 주세요."
    );
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
    setOcrProgress(false);
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
  return busStops.find((s) => s.id === activeStopId) || null;
}

function collapseListPanelDetails() {
  document.querySelectorAll("#view-list details[open]").forEach((el) => {
    el.open = false;
  });
}

function showListView() {
  document.querySelector("#view-list")?.removeAttribute("hidden");
  document.querySelector("#view-detail")?.setAttribute("hidden", "");
}

function showDetailView() {
  collapseListPanelDetails();
  document.querySelector("#view-list")?.setAttribute("hidden", "");
  document.querySelector("#view-detail")?.removeAttribute("hidden");
}

function renderStopList() {
  const list = document.querySelector("#stop-list");
  const empty = document.querySelector("#stop-list-empty");
  if (!list || !empty) return;

  list.replaceChildren();
  if (!busStops.length) {
    empty.hidden = false;
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
}

function lineDisplayClass(line) {
  if (isLikelySectionTitle(line)) return "ocr-line--heading";
  if (/^\d{1,4}\s*번/.test(line) || /^노선\s*\d/.test(line)) return "ocr-line--route";
  if (/\d{1,2}\s*[:：.．]\s*\d{2}/.test(line) || /^\d{4}$/.test(line.replace(/\s/g, ""))) {
    return "ocr-line--time";
  }
  if (/(평일|주말|토요|일요|공휴|방향|행)/.test(line)) return "ocr-line--label";
  return "ocr-line--body";
}

function compactKoreanLine(text) {
  return text.replace(/\s+/g, "");
}

function isDirectionBlockTitle(title) {
  if (typeof title !== "string") return false;
  const c = compactKoreanLine(title.trim());
  if (c.length <= 28 && /.+방면$/.test(c) && !/\d{1,2}[:：]/.test(c)) return true;
  return c.length <= 28 && /[→➔]/.test(title) && !/\d{1,2}[:：]/.test(c);
}

function isDirectionHeadingLine(line) {
  const c = compactKoreanLine(String(line).trim());
  return c.length <= 24 && /.+방면$/.test(c) && !/\d{1,2}[:：]/.test(c);
}

function cleanMarkdownHeading(text) {
  return String(text).trim().replace(/#{1,6}\s*/g, "").trim();
}

function formatDirectionTitle(title) {
  const t = cleanMarkdownHeading(title);
  const c = compactKoreanLine(t);
  if (/[→➔]/.test(t) && !/.+방면$/.test(c)) return t;
  if (!/.+방면$/.test(c)) return t;
  return `${c.replace(/방면$/, "")} 방면`;
}

/** 방면 제목·줄을 기준으로 재산형 표를 블록 단위로 펼친다 */
function normalizeSectionsForDisplay(sections) {
  /** @type {{ title: string | null, lines: string[] }[]} */
  const out = [];

  for (const block of sections) {
    /** @type {{ kind: "title" | "line", text: string }[]} */
    const stream = [];
    if (block.title?.trim()) {
      stream.push({ kind: "title", text: block.title.trim() });
    }
    for (const line of block.lines || []) {
      if (line?.trim()) stream.push({ kind: "line", text: line.trim() });
    }

    let current = { title: null, lines: [] };

    const flush = () => {
      if (!current.title && !current.lines.length) return;
      out.push({
        title: current.title,
        lines: [...current.lines],
      });
      current = { title: null, lines: [] };
    };

    for (const item of stream) {
      const text = item.text;
      if (isDirectionHeadingLine(text)) {
        flush();
        current = { title: formatDirectionTitle(text), lines: [] };
        continue;
      }

      if (item.kind === "title") {
        flush();
        current = {
          title: isDirectionBlockTitle(text)
            ? formatDirectionTitle(text)
            : text,
          lines: [],
        };
        continue;
      }

      if (
        current.title &&
        compactKoreanLine(text) === compactKoreanLine(current.title) &&
        isDirectionBlockTitle(current.title)
      ) {
        continue;
      }

      current.lines.push(text);
    }
    flush();
  }

  return out.filter((b) => b.title || b.lines.some((l) => l.trim()));
}

function isTableColumnHeader(line) {
  const compact = line.replace(/\s+/g, "");
  return (
    /^출발시간.*종착지/.test(compact) ||
    /^출발.*종착/.test(compact) ||
    /^시간.*행선/.test(compact)
  );
}

/** 표 칸 라벨만 있는 줄 — 정류장 이름과 무관한 공통 필터 */
function isTableLabelNoiseLine(line) {
  const t = String(line).trim();
  const c = t.replace(/\s+/g, "");
  if (
    /^(출발)?시간$|^출발시간$|^목적지$|^종착지$|^경유지$|^행선지?$|^시각$|^출발$|^도착$/.test(
      c
    )
  ) {
    return true;
  }
  if (/^출발\s*시간$/i.test(t) && !/\d{1,2}\s*[:：]/.test(t)) return true;
  return isTableColumnHeader(line);
}

function polishTranscriptLines(rawLines) {
  const out = [];
  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i];
    if (isTableLabelNoiseLine(line)) continue;

    const next = rawLines[i + 1];
    const nextIsDest =
      next &&
      !isTableLabelNoiseLine(next) &&
      !isDirectionHeadingLine(next) &&
      !isLikelySectionTitle(next) &&
      countTimeTokens(next) === 0 &&
      /^[가-힣0-9·/\-]{1,24}$/.test(next.trim());

    if (
      countTimeTokens(line) === 1 &&
      !lineHasTimeAndDestination(line) &&
      nextIsDest
    ) {
      line = `${normalizeScheduleRow(line)} | ${next.trim()}`;
      i++;
    } else if (lineLooksLikeTimeValue(line)) {
      line = normalizeScheduleRow(line);
    }

    out.push(line);
  }
  return out;
}

function sectionsFromTranscriptLines(rawLines) {
  const lines = polishTranscriptLines(rawLines);
  if (!lines.length) return [];

  /** @type {{ title: string | null, lines: string[] }[]} */
  const sections = [];
  let current = { title: null, lines: [] };

  const flush = () => {
    if (!current.title && !current.lines.length) return;
    sections.push({ title: current.title, lines: [...current.lines] });
    current = { title: null, lines: [] };
  };

  for (const line of lines) {
    if (isDirectionHeadingLine(line)) {
      flush();
      current.title = formatDirectionTitle(line);
      continue;
    }
    if (isLikelySectionTitle(line) && !lineLooksLikeTimeValue(line)) {
      flush();
      current.title =
        isDirectionBlockTitle(line) ? formatDirectionTitle(line) : line;
      continue;
    }
    current.lines.push(line);
  }
  flush();

  if (!sections.length) return [{ title: null, lines }];
  return stripPrivacyFromSections(sections);
}

function isContactMetaLine(line) {
  const t = String(line).trim();
  if (!t) return false;
  if (/\(전화\)|전화\s*[:：]/.test(t)) return true;
  if (/010[\s\-·]?\d{4}/.test(t)) return true;
  if (/\d{2,4}\s*[-·．]\s*\d{3,4}/.test(t) && /정류|마트|슈퍼|문의|택시|운수/.test(t)) {
    return true;
  }
  if (/정류소|슈퍼\s*마트|봉화\s*슈퍼/.test(t) && /\d/.test(t)) return true;
  return false;
}

function stripPrivacyFromSections(sections) {
  return sections
    .map((block) => ({
      ...block,
      lines: (block.lines || []).filter((line) => !isContactMetaLine(line)),
    }))
    .filter((block) => block.title || block.lines.length);
}

function countTimeTokens(line) {
  return (line.match(/\d{1,2}\s*[:：.．]\s*\d{2}/g) || []).length;
}

/** 출발 시각 + 종착지명 (2열 시각 표가 아님) */
function lineHasTimeAndDestination(line) {
  if (lineHasPairedBusTimes(line)) return false;
  if (countTimeTokens(line) !== 1) return false;
  const m = line.match(/(\d{1,2})\s*[:：.．]\s*(\d{2})/);
  if (!m) return false;
  const after = line.slice((m.index ?? 0) + m[0].length).replace(/^\s*[\|｜]\s*/, "").trim();
  return /[가-힣A-Za-z]{2,}/.test(after);
}

/** 한 줄에 시각 두 개 + `|` 또는 12시간 괄호 (2열 표) */
function lineHasPairedBusTimes(line) {
  if (countTimeTokens(line) < 2) return false;
  const times = [...line.matchAll(/\d{1,2}\s*[:：.．]\s*\d{2}/g)];
  const between = line.slice(
    times[0].index + times[0][0].length,
    times[1].index
  );
  if (/[\|｜]/.test(between)) return true;
  return /[\(\（]\s*\d{1,2}\s*[:：.．]/.test(between);
}

/** @param {string} line */
function parseTimetableRowParts(line) {
  if (lineHasPairedBusTimes(line)) return null;
  const timeMatch = line.match(/(\d{1,2}\s*[:：.．]\s*\d{2})/);
  if (!timeMatch) return null;
  const parsed = parseMinutesFromLine(line);
  if (parsed == null) return null;
  const h = Math.floor(parsed / 60);
  const m = parsed % 60;
  const timeDisplay = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  let rest = line.slice((timeMatch.index ?? 0) + timeMatch[0].length);
  rest = rest
    .replace(/^\s*[\|｜]\s*/, "")
    .replace(/[\(\（][^)\）]*$/, "")
    .replace(/^[\)\）\s]+/, "")
    .trim();
  return { timeDisplay, destination: rest || null };
}

/** 재산형(출발|종착 표)일 때만 2열 — `|` 또는 머리글이 있는 블록만 */
function blockUsesTableLayout(lines) {
  if (!lines?.length) return false;
  if (lines.some(isTableColumnHeader)) return true;
  const timeDestRows = lines.filter(lineHasTimeAndDestination);
  if (timeDestRows.length >= 2) return true;

  const piped = lines.filter((l) => /[\|｜]/.test(l));
  if (piped.length < 2) return false;
  const pairedRows = piped.filter(lineHasPairedBusTimes);
  if (pairedRows.length >= 2) return false;
  return true;
}

/**
 * @param {string} line
 * @param {number} blockIndex
 * @param {number} groupIndex
 * @param {boolean} useTableLayout
 */
function buildOcrLineElement(line, blockIndex, groupIndex, useTableLayout) {
  const li = document.createElement("li");
  li.dataset.blockIndex = String(blockIndex);
  li.dataset.groupIndex = String(groupIndex);

  if (isContactMetaLine(line)) {
    li.className = "ocr-line--meta";
    li.textContent = line;
    return li;
  }

  if (useTableLayout && isTableColumnHeader(line)) {
    li.className = "ocr-line--colhead";
    li.innerHTML =
      '<span class="ocr-col-time">출발</span><span class="ocr-col-dest">종착지</span>';
    return li;
  }

  const row = useTableLayout ? parseTimetableRowParts(line) : null;
  const busMins = parseMinutesFromLine(line);
  if (row) {
    li.className = "ocr-line--time-row";
    const timeSpan = document.createElement("span");
    timeSpan.className = "ocr-time";
    timeSpan.textContent = row.timeDisplay;
    li.append(timeSpan);
    const destSpan = document.createElement("span");
    destSpan.className = row.destination ? "ocr-dest" : "ocr-dest ocr-dest--empty";
    destSpan.textContent = row.destination || "—";
    li.append(destSpan);
  } else {
    li.className = lineDisplayClass(line);
    li.textContent = line;
  }

  if (busMins != null) li.dataset.busMinutes = String(busMins);
  return li;
}

function getStopSections(stop) {
  const photo = getActivePhoto(stop);
  const built = photo?.ocrText?.trim()
    ? buildSectionsFromOcr(photo.ocrText)
    : photo?.sections?.length
      ? photo.sections
      : stop.ocrText?.trim()
        ? buildSectionsFromOcr(stop.ocrText)
        : stop.sections?.length
          ? stop.sections
          : [];
  return stripPrivacyFromSections(normalizeSectionsForDisplay(built));
}

/** @param {string} line */
function parseMinutesFromLine(line) {
  const compact = line.replace(/\s/g, "");
  if (/^\d{4}$/.test(compact)) {
    const h = Number(compact.slice(0, 2));
    const m = Number(compact.slice(2, 4));
    if (h < 24 && m < 60) return h * 60 + m;
  }
  const match = line.match(/(\d{1,2})\s*[:：.．]\s*(\d{2})/);
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2]);
  if (h >= 24 || m >= 60) return null;
  h = infer24hFromParenContext(line, h);
  if (h >= 24 || m >= 60) return null;
  return h * 60 + m;
}

function isRouteHeaderLine(line) {
  return (
    /^\d{1,4}\s*번/.test(line) ||
    /^노선\s*\d/.test(line) ||
    lineDisplayClass(line) === "ocr-line--route"
  );
}

/**
 * 한 블록 안에서 「123번」 같은 줄이 있으면 노선별로 나눔.
 * @param {string[]} lines
 */
function splitLinesIntoRouteGroups(lines) {
  /** @type {{ label: string | null, lines: string[] }[]} */
  const groups = [];
  let current = { label: null, lines: [] };

  const flush = () => {
    if (current.lines.length || current.label) groups.push({ ...current });
    current = { label: null, lines: [] };
  };

  for (const line of lines) {
    if (isRouteHeaderLine(line)) {
      if (current.label || current.lines.length) flush();
      current.label = line.trim();
      continue;
    }
    current.lines.push(line);
  }
  flush();

  const withTimes = groups.filter((g) =>
    g.lines.some((line) => parseMinutesFromLine(line) != null)
  );
  if (!withTimes.length) return [{ label: null, lines }];
  return withTimes;
}

/**
 * @param {{ minutes: number, line: string }[]} entries
 * @param {number} nowMins
 */
function pickNextBusEntry(entries, nowMins) {
  if (!entries.length) return null;
  const sorted = [...entries].sort((a, b) => a.minutes - b.minutes);
  let pick = sorted.find((e) => e.minutes >= nowMins);
  let isTomorrow = false;
  if (!pick) {
    pick = sorted[0];
    isTomorrow = true;
  }
  let diffMins = pick.minutes - nowMins;
  if (isTomorrow) diffMins = 24 * 60 - nowMins + pick.minutes;
  return { ...pick, isTomorrow, diffMins };
}

/** @param {string[]} lines @param {Date} [now] */
function findNextBusInLines(lines, now = new Date()) {
  const entries = [];
  for (const line of lines) {
    const minutes = parseMinutesFromLine(line);
    if (minutes != null) entries.push({ minutes, line: line.trim() });
  }
  if (!entries.length) return null;
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return pickNextBusEntry(entries, nowMins);
}

/**
 * 방면·노선 블록마다 가장 가까운 시각을 계산한다.
 * @param {{ title?: string | null, lines: string[] }[]} sections
 */
function computeNextBusByGroup(sections, now = new Date()) {
  /** @type {{ blockIndex: number, groupIndex: number, minutes: number, line: string, isTomorrow: boolean, diffMins: number, blockTitle: string | null, routeLabel: string | null }[]} */
  const picks = [];

  sections.forEach((block, blockIndex) => {
    if (!isDirectionBlockTitle(block.title)) return;
    const groups = splitLinesIntoRouteGroups(block.lines || []);
    groups.forEach((group, groupIndex) => {
      const next = findNextBusInLines(group.lines, now);
      if (!next) return;
      picks.push({
        blockIndex,
        groupIndex,
        blockTitle: block.title?.trim() || null,
        routeLabel: group.label,
        ...next,
      });
    });
  });

  return picks;
}

function formatNextBusBadge(pick) {
  const label = "지금 기준 다음 출발버스";
  if (pick.isTomorrow) return `${label} · 내일 첫 차`;
  if (pick.diffMins <= 0) return `${label} · 곧 출발`;
  if (pick.diffMins < 60) return `${label} · 약 ${pick.diffMins}분 후`;
  const h = Math.floor(pick.diffMins / 60);
  const m = pick.diffMins % 60;
  if (m === 0) return `${label} · 약 ${h}시간 후`;
  return `${label} · 약 ${h}시간 ${m}분 후`;
}

function clearNextBusHighlights() {
  document.querySelectorAll(".ocr-line--next").forEach((el) => {
    el.classList.remove("ocr-line--next");
    el.querySelector(".ocr-line-next-badge")?.remove();
  });
}

function applyNextBusHighlights(picks) {
  clearNextBusHighlights();
  if (!picks.length) return;

  for (const pick of picks) {
    const selector =
      `li[data-block-index="${pick.blockIndex}"]` +
      `[data-group-index="${pick.groupIndex}"]` +
      `[data-bus-minutes="${pick.minutes}"]`;
    document.querySelectorAll(selector).forEach((el) => {
      el.classList.add("ocr-line--next");
      if (el.querySelector(".ocr-line-next-badge")) return;
      const badge = document.createElement("span");
      badge.className = "ocr-line-next-badge";
      badge.textContent = formatNextBusBadge(pick);
      el.append(badge);
    });
  }
}

function refreshActiveStopNextBus() {
  const detail = document.querySelector("#view-detail");
  if (!activeStopId || !detail || detail.hidden) return;
  const stop = busStops.find((s) => s.id === activeStopId);
  if (!stop) return;

  const sections = getStopSections(stop);
  const picks = computeNextBusByGroup(sections, new Date());
  applyNextBusHighlights(picks);
}

function renderStopDetail(stopId) {
  const stop = busStops.find((s) => s.id === stopId);
  if (!stop) {
    showListView();
    return;
  }

  const photos = getStopPhotos(stop);
  if (!photos.length) {
    showListView();
    return;
  }

  if (!activePhotoId || !photos.some((p) => p.id === activePhotoId)) {
    activePhotoId = photos[photos.length - 1].id;
  }

  showDetailView();
  const title = document.querySelector("#detail-stop-name");
  const meta = document.querySelector("#detail-updated");
  const list = document.querySelector("#detail-photo-list");

  if (title) title.textContent = stop.name;
  if (meta) {
    const count = photos.length;
    meta.textContent = `사진 ${count}장 · 마지막 저장: ${formatStopDate(stop.updatedAt)}`;
  }

  if (list) {
    list.replaceChildren();
    photos.forEach((p, index) => {
      const li = document.createElement("li");
      li.className = "detail-photo-card panel-lite";
      if (p.id === activePhotoId) li.classList.add("is-selected");

      const nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "detail-photo-card-label";
      nameBtn.textContent = displayPhotoLabel(p, index);
      nameBtn.addEventListener("click", () => {
        pendingStopAction = "rename-photo-label";
        pendingPhotoLabelEditId = p.id;
        openNameDialog("photo-only", { photoLabel: p.label || "" });
      });

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

      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "detail-photo-card-select";
      const selected = p.id === activePhotoId;
      selectBtn.textContent = selected ? "선택됨 (다시 찍기·삭제)" : "이 사진 선택";
      selectBtn.setAttribute("aria-pressed", selected ? "true" : "false");
      selectBtn.addEventListener("click", () => {
        activePhotoId = p.id;
        renderStopDetail(stopId);
      });

      const hint = document.createElement("p");
      hint.className = "detail-photo-card-hint";
      hint.textContent = "사진 누르면 크게 · 이름 누르면 바꾸기";

      li.append(nameBtn, hit, selectBtn, hint);
      list.append(li);
    });
  }

  setBusStatus(
    photos.length > 1
      ? "다시 찍기·삭제할 사진은 「이 사진 선택」으로 고른 뒤 아래 버튼을 누르세요."
      : ""
  );
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

function lineLooksLikeTimeValue(line) {
  return countTimeTokens(line) >= 1;
}

/** AI JSON (등록 시) — 구조 해석은 모델이, 앱은 렌더만 */
function parseAiTimetableJson(text) {
  let raw = text.trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenced) raw = fenced[1].trim();
  if (!raw.startsWith("{")) return null;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!data || !Array.isArray(data.sections) || !data.sections.length) {
    return null;
  }

  /** @type {{ title: string | null, lines: string[] }[]} */
  const sections = [];
  if (data.placard && String(data.placard).trim()) {
    sections.push({
      title: cleanMarkdownHeading(String(data.placard)),
      lines: [],
    });
  }

  for (const sec of data.sections) {
    const title =
      sec.title != null && String(sec.title).trim()
        ? cleanMarkdownHeading(String(sec.title))
        : null;
    const lines = (sec.lines || [])
      .map((l) => String(l).replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((l) => !isContactMetaLine(l))
      .map((l) =>
        lineLooksLikeTimeValue(l) ? normalizeScheduleRow(l) : l
      );
    if (title || lines.length) sections.push({ title, lines });
  }

  const hasTimes = sections.some((s) =>
    (s.lines || []).some((l) => countTimeTokens(l) >= 1)
  );
  if (!hasTimes) return null;
  return stripPrivacyFromSections(sections);
}

function infer24hFromParenContext(line, hour) {
  const paren = line.match(/[\(\（]\s*(\d{1,2})\s*[:：.．]\s*(\d{2})\s*[\)\）]/);
  if (!paren || hour >= 13) return hour;
  const ampH = Number(paren[1]);
  const times = [...line.matchAll(/(\d{1,2})\s*[:：.．]\s*(\d{2})/g)];
  if (times.length < 2) return hour;
  const peerH = Number(times[1][1]);
  if (peerH >= 13 && hour <= 11 && ampH >= 1 && ampH <= 12) {
    return ampH === 12 ? 12 : ampH + 12;
  }
  return hour;
}

/** 출발|종착 행 — 종착지 유지 */
function normalizeScheduleRow(line) {
  const m = line.match(/(\d{1,2})\s*[:：.．]\s*(\d{2})/);
  if (!m) return line.trim();
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (h >= 24 || min >= 60) return line.trim();
  h = infer24hFromParenContext(line, h);
  const time = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  let rest = line.slice((m.index ?? 0) + m[0].length);
  rest = rest.replace(/^\s*[\|｜]\s*/, "").trim();
  if (lineHasPairedBusTimes(line)) {
    rest = rest
      .replace(/[\(\（][^)\）]*[\)\）]?/, "")
      .replace(/^[\)\）\s]+/, "")
      .trim();
  }
  return rest ? `${time} ${rest}` : time;
}

/** 표 재구성 없음 — 읽은 줄 순서 그대로 한 덩어리 (구형 JSON만 예외) */
function buildSectionsFromOcr(text) {
  const trimmed = text?.trim();
  if (!trimmed) return [];

  const fromJson = parseAiTimetableJson(trimmed);
  if (fromJson?.length) return fromJson;

  const rawLines = trimmed
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((l) => !isContactMetaLine(l));

  return sectionsFromTranscriptLines(rawLines);
}

function isLikelySectionTitle(line) {
  if (line.length > 28) return false;
  if (isDirectionHeadingLine(line)) return true;
  const keywords =
    /(평일|주말|토요|일요|공휴|비번|노선|방향|출발|도착|행|회차|첫차|막차|심야|시내|읍내|마을|시간표|배차|운행|요일|격일|순환)/;
  if (keywords.test(line)) return true;
  if (/^\d{1,4}\s*번$/.test(line)) return true;
  if (/^노선\s*\d+/.test(line)) return true;
  if (/^[▶►\-–=]/.test(line) && line.length <= 20) return true;
  return false;
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
  if (REGISTER_PHOTO_ONLY) {
    progress?.("enhance");
    try {
      await autoOptimizePhotoOnCanvas(ctx, w, h);
    } catch (error) {
      console.warn("photo enhance skipped", error);
    }
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

async function loadTesseract() {
  if (window.Tesseract) return window.Tesseract;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TESSERACT_CDN;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("tesseract load"));
    document.head.appendChild(script);
  });
  return window.Tesseract;
}

/**
 * @returns {Promise<{ text: string, confidence: number }>}
 */
async function recognizeTextFromImage(blob) {
  const Tesseract = await loadTesseract();
  const result = await Tesseract.recognize(blob, "kor+eng", {
    logger: (message) => {
      if (message.status === "recognizing text" && typeof message.progress === "number") {
        setOcrProgress(true, message.progress);
      }
    },
  });
  const text = result.data.text || "";
  const confidence =
    typeof result.data.confidence === "number" ? result.data.confidence : estimateOcrConfidence(text);
  return { text, confidence };
}

function estimateOcrConfidence(text) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const hangul = (trimmed.match(/[가-힣]/g) || []).length;
  const digits = (trimmed.match(/\d/g) || []).length;
  const score = Math.min(100, hangul * 2 + digits + trimmed.length * 0.2);
  return score;
}

/** 등록 시 표 구조를 맞추려면 이미지 기반 정밀 읽기를 우선한다. */
function shouldUseAiRefineOnRegister() {
  if (!getAiSettings().auto) return false;
  return navigator.onLine;
}

function isOcrLowQuality(text) {
  const trimmed = text.trim();
  if (isOcrUnreadable(trimmed)) return true;
  return scoreOcrQuality(trimmed).low;
}

function scoreOcrQuality(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return { low: true, goodLines: 0, ratio: 0 };

  let goodLines = 0;
  let noisyLines = 0;
  for (const line of lines) {
    if (isCredibleTimetableLine(line)) goodLines++;
    if (isNoisyOcrLine(line)) noisyLines++;
  }
  const ratio = goodLines / lines.length;
  const low =
    ratio < 0.35 || (noisyLines >= Math.ceil(lines.length * 0.45) && goodLines < 2);
  return { low, goodLines, ratio, noisyLines, lineCount: lines.length };
}

function isCredibleTimetableLine(line) {
  if (/[가-힣]{2,}/.test(line) &&
    /(평일|주말|토|일|공휴|버스|노선|방향|행|출발|도착|정류|마을|읍|면|리|시간)/.test(line)) {
    return true;
  }
  if (/^\d{1,4}\s*번/.test(line) || /^노선\s*\d/.test(line)) return true;

  const times = [...line.matchAll(/(\d{1,2})\s*[:：.．]\s*(\d{2})/g)];
  const validTimes = times.filter((m) => {
    const h = Number(m[1]);
    const min = Number(m[2]);
    return h >= 0 && h <= 23 && min >= 0 && min <= 59;
  });
  if (validTimes.length >= 1 && validTimes.length === times.length) {
    const hangul = (line.match(/[가-힣]/g) || []).length;
    const noise = (line.match(/[|=\[\]{}\\/`"']/g) || []).length;
    if (noise <= 4 || hangul >= 1 || validTimes.length >= 2) return true;
  }
  return false;
}

function isNoisyOcrLine(line) {
  if (line.length <= 1) return true;
  const noise = (line.match(/[|=\[\]{}\\/`"'<>]/g) || []).length;
  const latin = (line.match(/[a-zA-Z]/g) || []).length;
  const hangul = (line.match(/[가-힣]/g) || []).length;
  if (isCredibleTimetableLine(line)) return false;
  if (noise >= 3) return true;
  if (latin >= 3 && hangul === 0) return true;
  if (/=/.test(line) && hangul <= 1) return true;
  return false;
}

function isOcrUnreadable(text) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (!/[가-힣a-zA-Z0-9]/.test(trimmed)) return true;
  if (trimmed.length < 4) return true;

  const hasHangul = /[가-힣]/.test(trimmed);
  const hasDigit = /\d/.test(trimmed);
  const hasTimeLike = /\d{1,2}\s*[:：.．\s]\s*\d{2}|\d{4}/.test(trimmed);
  return !hasHangul && !hasDigit && !hasTimeLike;
}

/**
 * @param {string} dataUrl
 * @returns {Promise<{ text: string } | null>}
 */
async function refineTimetableWithAi(dataUrl) {
  const { endpoint } = getAiSettings();
  const url = endpoint.startsWith("http")
    ? endpoint
    : new URL(endpoint, window.location.origin).href;

  setOcrProgress(true, 0.35);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setBusStatus("처리하지 못했습니다. 사진만 이용해 주세요.");
      return null;
    }
    if (typeof payload.text === "string" && payload.text.trim()) {
      return { text: payload.text };
    }
    setBusStatus("처리하지 못했습니다. 사진만 다시 등록해 주세요.");
    return null;
  } catch (error) {
    console.error(error);
    setBusStatus(
      "서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."
    );
    return null;
  } finally {
    setOcrProgress(false);
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
    installBtn.hidden = false;
    installBtn.disabled = false;
  });

  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.disabled = true;
  });

  window.addEventListener("appinstalled", () => {
    renderDisplayMode();
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