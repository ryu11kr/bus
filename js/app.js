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
/** @type {{ photoThumb: string, ocrText: string, sections: { title: string | null, lines: string[] }[] } | null} */
let pendingStopDraft = null;
/** @type {"new" | "replace" | "rename" | null} */
let pendingStopAction = null;
/** @type {string | null} */
let replaceStopId = null;
let clockTimerId = null;

/** 새 앱 로직은 이 함수에 넣으세요. */
function initApp() {
  if (!document.body.classList.contains("bus-app")) return;

  loadBusState();
  bindBusUi();
  bindAppUpdateUi();
  startLiveClock();
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
  }, 45_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkAppVersionUpdate().catch(() => {});
    }
  });
}

async function fetchAppVersionMeta() {
  const tryUrls = ["/api/app-version", "./version.json"];
  for (const path of tryUrls) {
    try {
      const response = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) continue;
      const data = await response.json();
      if (data?.build != null) return data;
    } catch {
    }
  }
  return null;
}

async function bootstrapAppVersionCheck() {
  const meta = await fetchAppVersionMeta();
  if (!meta?.build) return;
  const seen = Number(localStorage.getItem(APP_VERSION_SEEN_KEY));
  if (!Number.isFinite(seen) || seen <= 0) {
    localStorage.setItem(APP_VERSION_SEEN_KEY, String(meta.build));
    return;
  }
  if (meta.build !== seen) {
    showAppUpdateBanner(meta);
  }
}

async function checkAppVersionUpdate() {
  const meta = await fetchAppVersionMeta();
  if (!meta?.build) return;
  const seen = Number(localStorage.getItem(APP_VERSION_SEEN_KEY));
  if (!Number.isFinite(seen) || seen <= 0) {
    localStorage.setItem(APP_VERSION_SEEN_KEY, String(meta.build));
    return;
  }
  if (meta.build !== seen) {
    showAppUpdateBanner(meta);
  }
}

function showAppUpdateBanner(meta) {
  const banner = document.querySelector("#app-update-banner");
  if (banner) {
    banner.hidden = false;
    if (meta?.build != null) banner.dataset.pendingBuild = String(meta.build);
  }
  if (updateBtn) {
    updateBtn.hidden = false;
    updateBtn.disabled = false;
    updateBtn.className = "big-btn primary";
  }
  const label = meta?.label || (meta?.build ? `빌드 ${meta.build}` : "새 버전");
  if (installHint) {
    installHint.textContent = `${label} 이 올라왔습니다. 위 「업데이트」를 눌러 주세요.`;
  }
  setBusStatus("");
}

function applyAppUpdate() {
  const pending = document.querySelector("#app-update-banner")?.dataset.pendingBuild;
  const finish = () => {
    if (pending) localStorage.setItem(APP_VERSION_SEEN_KEY, pending);
    else {
      fetchAppVersionMeta().then((m) => {
        if (m?.build) localStorage.setItem(APP_VERSION_SEEN_KEY, String(m.build));
      });
    }
    location.reload();
  };
  if (registration?.waiting) {
    reloadOnControllerChange = true;
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
    window.setTimeout(finish, 500);
    return;
  }
  finish();
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
  return { auto: true, endpoint: DEFAULT_AI_ENDPOINT };
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
  const btnDelete = document.querySelector("#btn-delete-stop");
  const nameDialog = document.querySelector("#stop-name-dialog");
  const nameForm = document.querySelector("#stop-name-form");
  const nameCancel = document.querySelector("#stop-name-cancel");

  fileCamera?.addEventListener("change", () => handleBusPhoto(fileCamera));
  fileAlbum?.addEventListener("change", () => handleBusPhoto(fileAlbum));

  btnNewCamera?.addEventListener("click", () => {
    pendingStopAction = "new";
    document.querySelector("#file-camera")?.click();
  });
  btnNewAlbum?.addEventListener("click", () => {
    pendingStopAction = "new";
    document.querySelector("#file-album")?.click();
  });
  btnBack?.addEventListener("click", () => {
    activeStopId = null;
    showListView();
    setBusStatus("");
  });

  btnRename?.addEventListener("click", () => {
    const stop = getActiveStop();
    if (!stop) return;
    pendingStopAction = "rename";
    openStopNameDialog(stop.name);
  });

  btnReplace?.addEventListener("click", () => {
    const stop = getActiveStop();
    if (!stop) return;
    pendingStopAction = "replace";
    replaceStopId = stop.id;
    const useCamera = window.confirm("확인 = 카메라로 찍기\n취소 = 앨범에서 고르기");
    document.querySelector(useCamera ? "#file-camera" : "#file-album")?.click();
  });

  document.querySelector("#btn-ai-reread")?.addEventListener("click", () => {
    const stop = getActiveStop();
    if (!stop) return;
    runAiRefineForStop(stop.id).catch(() => {});
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
    } else if (pendingStopAction === "replace" && replaceStopId && pendingStopDraft) {
      const stop = busStops.find((s) => s.id === replaceStopId);
      if (stop) {
        applyDraftToStop(stop, pendingStopDraft, name);
        saveBusState();
        activeStopId = stop.id;
        renderStopDetail(stop.id);
        renderStopList();
        setBusStatus("사진과 시간표를 갱신했습니다.");
      }
    } else if (pendingStopAction === "new" && pendingStopDraft) {
      const stop = createStopFromDraft(pendingStopDraft, name);
      busStops.unshift(stop);
      activeStopId = stop.id;
      saveBusState();
      renderStopDetail(stop.id);
      renderStopList();
      setBusStatus("정류장을 저장했습니다.");
    }

    pendingStopDraft = null;
    pendingStopAction = null;
    replaceStopId = null;
    nameDialog?.close();
  });
}

function newStopId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `stop-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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
        .filter((s) => s && typeof s.name === "string" && typeof s.photoThumb === "string")
        .map((s) => ({
          id: String(s.id || newStopId()),
          name: s.name,
          photoThumb: s.photoThumb,
          ocrText: typeof s.ocrText === "string" ? s.ocrText : "",
          sections: Array.isArray(s.sections) ? s.sections : organizeOcrText(s.ocrText || ""),
          updatedAt: s.updatedAt || new Date().toISOString(),
        }));
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
    busStops = [{
      id: newStopId(),
      name: "저장된 시간표",
      photoThumb: data.photoThumb,
      ocrText: "",
      sections: [],
      updatedAt: new Date().toISOString(),
    }];
    saveBusState();
    localStorage.removeItem("bus-timetable-v1");
  } catch {
  }
}

function saveBusState() {
  localStorage.setItem(BUS_STORAGE_KEY, JSON.stringify({ version: 2, stops: busStops }));
}

function setBusStatus(message) {
  const el = document.querySelector("#bus-status");
  if (el) el.textContent = message;
}

function setOcrProgress(show, value) {
  const bar = document.querySelector("#ocr-progress");
  if (!bar) return;
  bar.hidden = !show;
  if (!show) {
    bar.removeAttribute("value");
    return;
  }
  if (typeof value === "number") {
    bar.value = Math.round(value * 100);
  }
}

async function handleBusPhoto(input) {
  const file = input?.files?.[0];
  input.value = "";
  if (!file) return;

  if (!navigator.onLine) {
    setBusStatus("사진 읽기는 인터넷이 필요합니다. 와이파이·데이터를 켠 뒤 다시 시도해 주세요.");
    pendingStopAction = null;
    return;
  }

  setBusStatus("사진을 읽고 있습니다. 잠시만 기다려 주세요.");
  setOcrProgress(true, 0);

  try {
    const thumb = await compressImageFile(file, 1080);
    const blob = await fetch(thumb).then((r) => r.blob());
    const ocr = await recognizeTextFromImage(blob);
    let text = ocr.text.trim();
    let sections = buildSectionsFromOcr(text);
    let ocrSource = "tesseract";

    if (shouldTryAiRefine(text)) {
      setBusStatus(
        "기본 OCR 결과가 믿기 어렵습니다. 인공지능 정밀 읽기를 시도합니다…"
      );
      const ai = await refineTimetableWithAi(thumb);
      if (ai?.text) {
        text = ai.text.trim();
        sections = buildSectionsFromOcr(text);
        ocrSource = "ai";
      }
    }

    if (isOcrLowQuality(text)) {
      text = "";
      sections = [];
    }

    pendingStopDraft = {
      photoThumb: thumb,
      ocrText: text,
      sections,
      ocrSource,
    };

    if (pendingStopAction === "replace" && replaceStopId) {
      const stop = busStops.find((s) => s.id === replaceStopId);
      openStopNameDialog(stop?.name || "");
    } else {
      pendingStopAction = pendingStopAction || "new";
      openStopNameDialog("");
    }

    setBusStatus(
      text
        ? ocrSource.includes("ai")
          ? "인공지능으로 글자를 읽었습니다. 정류장 이름을 적어 주세요."
          : "사진에서 글자를 읽었습니다. 정류장 이름을 적어 주세요."
        : "글자가 잘 안 보입니다. 이름을 적고 저장하면 사진은 그대로 둡니다. 상세 화면에서 ‘인공지능으로 다시 읽기’를 눌러 보세요."
    );
  } catch (error) {
    console.error(error);
    setBusStatus("사진 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    pendingStopDraft = null;
    pendingStopAction = null;
    replaceStopId = null;
  } finally {
    setOcrProgress(false);
  }
}

function openStopNameDialog(currentName) {
  const dialog = document.querySelector("#stop-name-dialog");
  const input = document.querySelector("#stop-name-input");
  if (input) input.value = currentName;
  dialog?.showModal();
  input?.focus();
}

function createStopFromDraft(draft, name) {
  return {
    id: newStopId(),
    name,
    photoThumb: draft.photoThumb,
    ocrText: draft.ocrText,
    sections: draft.sections,
    updatedAt: new Date().toISOString(),
  };
}

function applyDraftToStop(stop, draft, name) {
  stop.name = name;
  stop.photoThumb = draft.photoThumb;
  stop.ocrText = draft.ocrText;
  stop.sections = draft.sections;
  stop.updatedAt = new Date().toISOString();
}

function getActiveStop() {
  return busStops.find((s) => s.id === activeStopId) || null;
}

function showListView() {
  document.querySelector("#view-list")?.removeAttribute("hidden");
  document.querySelector("#view-detail")?.setAttribute("hidden", "");
}

function showDetailView() {
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

    const name = document.createElement("span");
    name.className = "stop-card-name";
    name.textContent = stop.name;

    const preview = document.createElement("span");
    preview.className = "stop-card-preview";
    preview.textContent = getStopPreviewLine(stop);

    const meta = document.createElement("span");
    meta.className = "stop-card-meta";
    meta.textContent = formatStopDate(stop.updatedAt);

    btn.append(name, preview, meta);
    btn.addEventListener("click", () => {
      activeStopId = stop.id;
      renderStopDetail(stop.id);
    });
    li.append(btn);
    list.append(li);
  }
}

function getStopPreviewLine(stop) {
  if (stop.sections?.length) {
    const block = stop.sections[0];
    if (block.title) return block.title;
    if (block.lines?.[0]) return block.lines[0];
  }
  const line = stop.ocrText
    ?.split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  return line || "글자를 읽는 중…";
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

function isDirectionBlockTitle(title) {
  return typeof title === "string" && /방면\s*$/.test(title.trim());
}

function isDirectionHeadingLine(line) {
  const t = line.trim();
  return t.length <= 20 && /.+방면\s*$/.test(t) && !/\d{1,2}\s*[:：]/.test(t);
}

/** 한 블록 안에 「봉화방면」 등이 줄로 붙어 있으면 방면별 블록으로 쪼갬 */
function splitSectionsByDirectionHeadings(sections) {
  /** @type {{ title: string | null, lines: string[] }[]} */
  const out = [];

  for (const block of sections) {
    const lines = block.lines || [];
    const inlineHeadings = lines.filter(isDirectionHeadingLine).length;
    if (inlineHeadings < 1) {
      out.push(block);
      continue;
    }

    let current = {
      title: block.title,
      lines: [],
    };

    const flush = () => {
      if (current.title || current.lines.length) {
        out.push({
          title: current.title,
          lines: [...current.lines],
        });
      }
    };

    for (const line of lines) {
      if (isDirectionHeadingLine(line)) {
        flush();
        current = { title: line.trim(), lines: [] };
      } else {
        current.lines.push(line);
      }
    }
    flush();
  }

  return out.length ? out : sections;
}

function isTableColumnHeader(line) {
  const compact = line.replace(/\s+/g, "");
  return (
    /^출발시간.*종착지/.test(compact) ||
    /^출발.*종착/.test(compact) ||
    /^시간.*행선/.test(compact)
  );
}

function isContactMetaLine(line) {
  return (
    /\(전화\)/.test(line) ||
    /정류소/.test(line) ||
    /010[\s\-·]?\d{4}/.test(line) ||
    /슈퍼|마트/.test(line)
  );
}

/** @param {string} line */
function parseTimetableRowParts(line) {
  const timeMatch = line.match(/(\d{1,2}\s*[:：.．]\s*\d{2})/);
  if (!timeMatch) return null;
  const parsed = parseMinutesFromLine(line);
  if (parsed == null) return null;
  const h = Math.floor(parsed / 60);
  const m = parsed % 60;
  const timeDisplay = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  let rest = line.slice((timeMatch.index ?? 0) + timeMatch[0].length);
  rest = rest.replace(/^\s*[\|｜]\s*/, "").trim();
  return { timeDisplay, destination: rest || null };
}

/** 재산형(출발|종착 표)일 때만 2열 — `|` 또는 머리글이 있는 블록만 */
function blockUsesTableLayout(lines) {
  if (!lines?.length) return false;
  if (lines.some(isTableColumnHeader)) return true;
  return lines.filter((l) => /[\|｜]/.test(l)).length >= 2;
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
  const built = stop.ocrText?.trim()
    ? buildSectionsFromOcr(stop.ocrText)
    : stop.sections?.length
      ? stop.sections
      : [];
  return splitSectionsByDirectionHeadings(built);
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
  const h = Number(match[1]);
  const m = Number(match[2]);
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
  if (pick.isTomorrow) return "가장 가까운 차 · 내일 첫 차";
  if (pick.diffMins <= 0) return "가장 가까운 차 · 곧 출발";
  if (pick.diffMins < 60) return `가장 가까운 차 · 약 ${pick.diffMins}분 후`;
  const h = Math.floor(pick.diffMins / 60);
  const m = pick.diffMins % 60;
  if (m === 0) return `가장 가까운 차 · 약 ${h}시간 후`;
  return `가장 가까운 차 · 약 ${h}시간 ${m}분 후`;
}

function clearNextBusHighlights() {
  document.querySelectorAll(".ocr-line--next").forEach((el) => {
    el.classList.remove("ocr-line--next");
    el.querySelector(".ocr-line-next-badge")?.remove();
  });
  document.querySelectorAll(".ocr-block-next-chip").forEach((el) => el.remove());
}

function applyNextBusHighlights(picks) {
  clearNextBusHighlights();
  if (!picks.length) return;

  /** @type {Map<number, HTMLElement>} */
  const chipByBlock = new Map();

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

    const section = document.querySelector(
      `.ocr-block[data-block-index="${pick.blockIndex}"]`
    );
    if (!section) continue;

    let chip = chipByBlock.get(pick.blockIndex);
    if (!chip) {
      chip = document.createElement("p");
      chip.className = "ocr-block-next-chip";
      chip.dataset.blockIndex = String(pick.blockIndex);
      const titleEl = section.querySelector(".ocr-block-title");
      if (titleEl) titleEl.after(chip);
      else section.prepend(chip);
      chipByBlock.set(pick.blockIndex, chip);
    }
    chip.textContent = formatNextBusBadge(pick);
    chip.classList.toggle("is-tomorrow", Boolean(pick.isTomorrow));
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

  showDetailView();
  const title = document.querySelector("#detail-stop-name");
  const meta = document.querySelector("#detail-updated");
  const img = document.querySelector("#detail-photo");
  const sectionsRoot = document.querySelector("#detail-sections");
  const fallback = document.querySelector("#detail-ocr-fallback");
  const emptyHint = document.querySelector("#detail-empty-hint");
  const photoDetails = document.querySelector(".original-photo");

  if (title) title.textContent = stop.name;
  if (meta) meta.textContent = `마지막 저장: ${formatStopDate(stop.updatedAt)}`;
  if (img) {
    img.src = stop.photoThumb;
    img.alt = `${stop.name} 버스 시간표 원본 사진`;
  }
  if (photoDetails) photoDetails.removeAttribute("open");

  sectionsRoot?.replaceChildren();
  clearNextBusHighlights();
  const sections = getStopSections(stop);
  const hasStructured = sections.some(
    (block) => block.title || block.lines.some((l) => l.trim())
  );

  if (sectionsRoot && hasStructured) {
    sections.forEach((block, blockIndex) => {
      if (!block.title && !block.lines.length) return;
      const section = document.createElement("section");
      const isDirection = isDirectionBlockTitle(block.title);
      const isPlacard =
        Boolean(block.title) &&
        isDirectionBlockTitle(block.title) === false &&
        !block.lines.some((l) => parseMinutesFromLine(l) != null);
      section.className = "ocr-block";
      if (isDirection) section.classList.add("ocr-block-direction");
      if (isPlacard && !isDirection) section.classList.add("ocr-block-placard");
      section.dataset.blockIndex = String(blockIndex);
      if (block.title) {
        const heading = document.createElement("h3");
        heading.className = "ocr-block-title";
        heading.textContent = block.title;
        section.append(heading);
      }

      let groupIndex = 0;
      let timesInGroup = false;
      let colheadDone = false;
      const useTableLayout = blockUsesTableLayout(block.lines);
      const ul = document.createElement("ul");
      ul.className = useTableLayout
        ? "ocr-block-lines ocr-block-lines--table"
        : "ocr-block-lines";

      for (const line of block.lines) {
        if (useTableLayout && isTableColumnHeader(line)) {
          if (colheadDone) continue;
          colheadDone = true;
        }
        if (isRouteHeaderLine(line)) {
          if (timesInGroup) {
            groupIndex += 1;
            timesInGroup = false;
          }
          const li = document.createElement("li");
          li.className = lineDisplayClass(line);
          li.textContent = line;
          li.dataset.blockIndex = String(blockIndex);
          li.dataset.groupIndex = String(groupIndex);
          ul.append(li);
          continue;
        }

        const li = buildOcrLineElement(line, blockIndex, groupIndex, useTableLayout);
        if (parseMinutesFromLine(line) != null) timesInGroup = true;
        ul.append(li);
      }

      if (ul.childElementCount) section.append(ul);
      sectionsRoot.append(section);
    });
    if (fallback) fallback.hidden = true;
    if (emptyHint) emptyHint.hidden = true;
  } else if (stop.ocrText?.trim() && fallback) {
    fallback.hidden = false;
    fallback.textContent = stop.ocrText.trim();
    if (emptyHint) emptyHint.hidden = true;
  } else {
    if (fallback) {
      fallback.hidden = true;
      fallback.textContent = "";
    }
    if (emptyHint) emptyHint.hidden = false;
  }

  refreshActiveStopNextBus();
  setBusStatus("");
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
 * 이중 방면(장수/산서) 시간표처럼 한 줄에 시각이 두 번 나오면 좌·우로 나눔.
 * @param {string} text
 * @returns {{ title: string | null, lines: string[] }[]}
 */
function buildSectionsFromOcr(text) {
  const dual = tryReorganizeDualDirectionBoard(text);
  if (dual) return dual;
  const interleaved = tryReorganizeInterleavedBoard(text);
  if (interleaved) return interleaved;
  return organizeOcrText(text);
}

/** AI/OCR이 한 줄에 시각 하나씩 번갈아 나열할 때(필덕입구 표) 장수·산서로 나눔. */
function tryReorganizeInterleavedBoard(text) {
  if (!/장수\s*방면|산서\s*방면|방면/.test(text)) return null;

  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  let placard = null;
  const timeLines = [];

  for (const line of rawLines) {
    if (isJunkTimetableHeaderLine(line)) continue;
    if (/^[가-힣]{2,10}입구$/.test(line) && !/\d{1,2}:\d{2}/.test(line)) {
      placard = line;
      continue;
    }
    if (/\d{1,2}:\d{2}/.test(line)) {
      const parts = splitLineIntoDirectionTimes(line);
      if (parts) {
        if (parts[0]) timeLines.push({ side: "left", text: parts[0] });
        if (parts[1]) timeLines.push({ side: "right", text: parts[1] });
      } else {
        timeLines.push({ side: "auto", text: line });
      }
    }
  }

  if (timeLines.length < 4) return null;

  const left = [];
  const right = [];
  for (const entry of timeLines) {
    if (entry.side === "left") left.push(entry.text);
    else if (entry.side === "right") right.push(entry.text);
    else if (entry.side === "auto") {
      if (left.length <= right.length) left.push(entry.text);
      else right.push(entry.text);
    }
  }

  if (left.length < 2 || right.length < 2) return null;

  const sections = [];
  if (placard) sections.push({ title: placard, lines: [] });
  sections.push({ title: "장수 방면", lines: left });
  sections.push({ title: "산서 방면", lines: right });
  return sections;
}

function isJunkTimetableHeaderLine(line) {
  if (/^장수군$|^장수말|장수버스|식천\s*www/i.test(line)) return true;
  if (/^장수\s*방면$|^산서\s*방면$/.test(line)) return true;
  if (/^장수\s*방면\s*산서\s*방면/.test(line)) return true;
  if (/^=\s*가$|^[=\-|]{1,3}$/.test(line)) return true;
  return false;
}

function splitLineIntoDirectionTimes(line) {
  const times = [...line.matchAll(/\d{1,2}:\d{2}/g)];
  if (times.length < 2) return null;
  const splitAt = times[1].index ?? line.length;
  return [line.slice(0, splitAt).trim(), line.slice(splitAt).trim()];
}

function tryReorganizeDualDirectionBoard(text) {
  const hasDirection = /장수\s*방면|산서\s*방면|방면/.test(text);
  const hasPairedTimes = /\d{1,2}:\d{2}.+\d{1,2}:\d{2}/.test(text);
  if (!hasDirection && !hasPairedTimes) return null;

  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const towardJangsu = [];
  const towardSanseo = [];
  let placard = null;
  let pairedRows = 0;

  for (const line of rawLines) {
    if (/^필덕입구$/.test(line) || /^[가-힣]{2,8}입구$/.test(line)) {
      placard = line;
      continue;
    }
    if (/장수군|장수버스|www\.|http|\.kr$/i.test(line)) continue;
    if (/^장수\s*방면\s*산서\s*방면/.test(line)) continue;
    if (/^장수\s*방면$|^산서\s*방면$/.test(line)) continue;
    if (line.length < 2) continue;

    const times = [...line.matchAll(/\d{1,2}:\d{2}/g)];
    if (times.length >= 2) {
      pairedRows++;
      const splitAt = times[1].index ?? line.length;
      const left = line.slice(0, splitAt).trim();
      const right = line.slice(splitAt).trim();
      if (left) towardJangsu.push(left);
      if (right) towardSanseo.push(right);
    } else if (times.length === 1) {
      const only = line.trim();
      if ((times[0].index ?? 99) <= 3) towardJangsu.push(only);
      else towardSanseo.push(only);
    }
  }

  if (pairedRows < 2 && (towardJangsu.length < 2 || towardSanseo.length < 2)) {
    return null;
  }

  const sections = [];
  if (placard) sections.push({ title: placard, lines: [] });
  if (towardJangsu.length) sections.push({ title: "장수 방면", lines: towardJangsu });
  if (towardSanseo.length) sections.push({ title: "산서 방면", lines: towardSanseo });
  return sections.length ? sections : null;
}

/**
 * 사진에서 읽은 글자를 원본 순서대로 묶어서 보여 준다. 고정 표가 아님.
 * @param {string} text
 * @returns {{ title: string | null, lines: string[] }[]}
 */
function organizeOcrText(text) {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (!rawLines.length) return [];

  const sections = [];
  let current = { title: null, lines: [] };

  const flush = () => {
    if (current.title || current.lines.length) {
      sections.push({
        title: current.title,
        lines: [...current.lines],
      });
    }
    current = { title: null, lines: [] };
  };

  for (const line of rawLines) {
    if (isLikelySectionTitle(line)) {
      flush();
      current.title = line;
    } else {
      current.lines.push(line);
    }
  }
  flush();

  if (sections.length === 1 && !sections[0].title && sections[0].lines.length > 6) {
    return splitLooseBlocks(sections[0].lines);
  }

  return sections;
}

function isLikelySectionTitle(line) {
  if (line.length > 28) return false;
  if (/.+\s*방면\s*$/.test(line) && line.length <= 18) return true;
  const keywords =
    /(평일|주말|토요|일요|공휴|비번|노선|방향|출발|도착|행|회차|첫차|막차|심야|시내|읍내|마을|시간표|배차|운행|요일|격일|순환)/;
  if (keywords.test(line)) return true;
  if (/^\d{1,4}\s*번$/.test(line)) return true;
  if (/^노선\s*\d+/.test(line)) return true;
  if (/^[▶►\-–=]/.test(line) && line.length <= 20) return true;
  return false;
}

function splitLooseBlocks(lines) {
  const blocks = [];
  let chunk = [];
  for (const line of lines) {
    if (isLikelySectionTitle(line) && chunk.length) {
      blocks.push({ title: null, lines: chunk });
      chunk = [line];
    } else if (isLikelySectionTitle(line) && !chunk.length) {
      blocks.push({ title: line, lines: [] });
    } else {
      chunk.push(line);
    }
  }
  if (chunk.length) blocks.push({ title: null, lines: chunk });
  return blocks.length ? blocks : [{ title: null, lines }];
}

async function compressImageFile(file, maxWidth) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.82);
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

/**
 * 1차 OCR이 비었거나, 스크린샷처럼 깨진 글자만 나올 때 정밀 읽기 시도.
 */
function shouldTryAiRefine(text) {
  if (!getAiSettings().auto) return false;
  if (!navigator.onLine) return false;
  return isOcrLowQuality(text);
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
      let msg = payload?.error || `정밀 읽기 실패 (${response.status})`;
      if (/no longer available|models\/gemini/i.test(msg)) {
        msg =
          "인공지능 모델이 갱신되었습니다. 앱을 새로고침하고 다시 시도해 주세요. 계속되면 잠시 뒤 다시 배포된 버전으로 시도하세요.";
      }
      setBusStatus(msg);
      return null;
    }
    if (typeof payload.text === "string" && payload.text.trim()) {
      return { text: payload.text };
    }
    setBusStatus("인공지능이 글자를 찾지 못했습니다.");
    return null;
  } catch (error) {
    console.error(error);
    setBusStatus(
      "정밀 읽기 서버에 연결하지 못했습니다. Vercel 배포와 GEMINI_API_KEY 설정을 확인하세요."
    );
    return null;
  } finally {
    setOcrProgress(false);
  }
}

async function runAiRefineForStop(stopId) {
  const stop = busStops.find((s) => s.id === stopId);
  if (!stop) return;

  if (!navigator.onLine) {
    setBusStatus("정밀 읽기는 인터넷이 필요합니다.");
    return;
  }

  setBusStatus("인공지능이 시간표를 읽고 있습니다…");
  setOcrProgress(true, 0.2);
  try {
    const ai = await refineTimetableWithAi(stop.photoThumb);
    if (!ai?.text) return;

    stop.ocrText = ai.text.trim();
    stop.sections = buildSectionsFromOcr(stop.ocrText);
    stop.updatedAt = new Date().toISOString();
    saveBusState();
    renderStopDetail(stop.id);
    renderStopList();
    setBusStatus("인공지능으로 다시 읽었습니다.");
  } finally {
    setOcrProgress(false);
  }
}

function startLiveClock() {
  const tick = () => {
    const now = new Date();
    const clock = document.querySelector("#now-clock");
    const clockKo = document.querySelector("#now-clock-ko");
    if (clock) {
      clock.textContent = formatClockDigital(now);
    }
    if (clockKo) {
      clockKo.textContent = formatTimeKorean(now.getHours(), now.getMinutes())
        + ` ${now.getSeconds().toString().padStart(2, "0")}초`;
    }
    if (now.getSeconds() === 0) {
      refreshActiveStopNextBus();
    }
  };
  tick();
  if (clockTimerId) window.clearInterval(clockTimerId);
  clockTimerId = window.setInterval(tick, 1000);
}

function formatClockDigital(date) {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  const s = date.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatTimeKorean(hour, minute) {
  const ampm = hour < 12 ? "오전" : "오후";
  const h12 = hour % 12 || 12;
  return `${ampm} ${h12}시 ${minute.toString().padStart(2, "0")}분`;
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
    installHint.textContent = "설치하면 홈 화면 아이콘으로 단독 창에서 열립니다.";
  });

  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    installHint.textContent = choice.outcome === "accepted"
      ? "설치가 시작되었습니다."
      : "설치를 나중에 할 수 있습니다.";
    deferredPrompt = null;
    installBtn.disabled = true;
  });

  window.addEventListener("appinstalled", () => {
    installHint.textContent = "설치가 완료되었습니다. 홈 화면에서 열어 보세요.";
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
    showAppUpdateBanner({ build, label: build ? `빌드 ${build}` : "새 버전" });
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