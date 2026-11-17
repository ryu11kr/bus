/** 클라우드에 정류장 목록·사진 동기화 (로그인 + enabled 일 때만) */

export const BUS_STORAGE_KEY = "bus-stops-v2";
export const BUS_PHOTOS_BUCKET = "bus-photos";
export const CLOUD_MAX_STOPS = 30;

let uploadTimer = null;
let syncInFlight = null;
/** @type {((text: string) => void) | null} */
let syncStatusCb = null;

export function setCloudSyncStatusCallback(fn) {
  syncStatusCb = fn;
}

function setSyncStatus(text) {
  syncStatusCb?.(text || "");
}

function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const bin = atob(match[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function photoStoragePath(userId, stopId) {
  return `${userId}/${stopId}.jpg`;
}

function isDataUrl(src) {
  return typeof src === "string" && src.startsWith("data:");
}

function isHttpUrl(src) {
  return typeof src === "string" && /^https?:\/\//i.test(src);
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} path
 */
async function downloadPhotoAsDataUrl(client, path) {
  const { data, error } = await client.storage.from(BUS_PHOTOS_BUCKET).download(path);
  if (error || !data) throw error || new Error("download failed");
  return blobToDataUrl(data);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} userId
 * @param {{ id: string, photoThumb: string }} stop
 */
async function uploadStopPhoto(client, userId, stop) {
  if (!isDataUrl(stop.photoThumb)) return photoStoragePath(userId, stop.id);
  const blob = dataUrlToBlob(stop.photoThumb);
  if (!blob) throw new Error("invalid photo");
  const path = photoStoragePath(userId, stop.id);
  const { error } = await client.storage.from(BUS_PHOTOS_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: blob.type || "image/jpeg",
  });
  if (error) throw error;
  return path;
}

/**
 * @typedef {{ id: string, name: string, photoThumb: string, ocrText: string, sections: unknown[], updatedAt: string, photoPath?: string }} LocalStop
 */

/**
 * @param {LocalStop[]} localStops
 * @param {Array<Record<string, unknown>>} remoteStops
 * @returns {LocalStop[]}
 */
export function mergeStopsByUpdatedAt(localStops, remoteStops) {
  const byId = new Map();
  for (const s of localStops || []) {
    if (s?.id) byId.set(String(s.id), s);
  }
  for (const raw of remoteStops || []) {
    if (!raw || typeof raw !== "object" || !raw.id) continue;
    const id = String(raw.id);
    const remote = {
      id,
      name: String(raw.name || ""),
      photoThumb: typeof raw.photoThumb === "string" ? raw.photoThumb : "",
      photoPath: typeof raw.photoPath === "string" ? raw.photoPath : "",
      ocrText: typeof raw.ocrText === "string" ? raw.ocrText : "",
      sections: Array.isArray(raw.sections) ? raw.sections : [],
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
    };
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, remote);
      continue;
    }
    const tLocal = new Date(existing.updatedAt || 0).getTime();
    const tRemote = new Date(remote.updatedAt || 0).getTime();
    byId.set(id, tRemote >= tLocal ? { ...remote, photoThumb: remote.photoThumb || existing.photoThumb } : existing);
  }
  return Array.from(byId.values()).filter((s) => s.name && (s.photoThumb || s.photoPath));
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {Array<Record<string, unknown>>} cloudStops
 */
async function hydrateRemoteStops(client, cloudStops) {
  /** @type {LocalStop[]} */
  const out = [];
  for (const raw of cloudStops || []) {
    if (!raw?.id) continue;
    let photoThumb = typeof raw.photoThumb === "string" ? raw.photoThumb : "";
    const photoPath = typeof raw.photoPath === "string" ? raw.photoPath : "";
    if (!photoThumb && photoPath) {
      try {
        photoThumb = await downloadPhotoAsDataUrl(client, photoPath);
      } catch (error) {
        console.error(error);
      }
    }
    if (!photoThumb) continue;
    out.push({
      id: String(raw.id),
      name: String(raw.name || ""),
      photoThumb,
      ocrText: typeof raw.ocrText === "string" ? raw.ocrText : "",
      sections: Array.isArray(raw.sections) ? raw.sections : [],
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    });
  }
  return out;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} userId
 */
export async function pullAndMergeCloudState(client, userId) {
  const { data, error } = await client
    .from("bus_user_data")
    .select("stops, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;

  const getLocal = window.busAppGetLocalStopState;
  const applyLocal = window.busAppApplyCloudStops;
  if (typeof getLocal !== "function" || typeof applyLocal !== "function") return;

  const localState = getLocal();
  const localStops = Array.isArray(localState.stops) ? localState.stops : [];

  if (!data?.stops || !Array.isArray(data.stops) || !data.stops.length) {
    if (localStops.length) {
      scheduleCloudPush(client, userId, 400);
    }
    return;
  }

  const hydrated = await hydrateRemoteStops(client, data.stops);
  const merged = mergeStopsByUpdatedAt(localStops, hydrated);
  if (merged.length > CLOUD_MAX_STOPS) {
    merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    merged.length = CLOUD_MAX_STOPS;
  }

  window.__busCloudSyncApplying = true;
  try {
    applyLocal(merged);
  } finally {
    window.__busCloudSyncApplying = false;
  }

  const remoteUpdated = new Date(data.updated_at || 0).getTime();
  const localMax = localStops.reduce(
    (max, s) => Math.max(max, new Date(s.updatedAt || 0).getTime()),
    0
  );
  if (localMax > remoteUpdated) {
    scheduleCloudPush(client, userId, 400);
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} userId
 */
export async function pushLocalStateToCloud(client, userId) {
  const getLocal = window.busAppGetLocalStopState;
  if (typeof getLocal !== "function") return;

  const localState = getLocal();
  let stops = Array.isArray(localState.stops) ? [...localState.stops] : [];
  if (!stops.length) {
    await client.from("bus_user_data").upsert({
      user_id: userId,
      stops: [],
      schema_version: 2,
      updated_at: new Date().toISOString(),
    });
    setSyncStatus("클라우드와 맞춤 (저장된 정류장 없음)");
    return;
  }

  if (stops.length > CLOUD_MAX_STOPS) {
    stops.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    stops = stops.slice(0, CLOUD_MAX_STOPS);
    setSyncStatus(`정류장은 클라우드에 최대 ${CLOUD_MAX_STOPS}개까지 저장됩니다.`);
  }

  if (!navigator.onLine) {
    setSyncStatus("오프라인입니다. 연결되면 클라우드에 저장합니다.");
    return;
  }

  /** @type {Record<string, unknown>[]} */
  const cloudStops = [];
  for (const stop of stops) {
    if (!stop?.id || !stop.name) continue;
    let photoPath = "";
    if (isDataUrl(stop.photoThumb)) {
      photoPath = await uploadStopPhoto(client, userId, stop);
    } else if (isHttpUrl(stop.photoThumb)) {
      photoPath = photoStoragePath(userId, stop.id);
    } else {
      continue;
    }
    cloudStops.push({
      id: stop.id,
      name: stop.name,
      ocrText: stop.ocrText || "",
      sections: stop.sections || [],
      updatedAt: stop.updatedAt || new Date().toISOString(),
      photoPath,
    });
  }

  const updatedAt = cloudStops.reduce(
    (max, s) => Math.max(max, new Date(String(s.updatedAt)).getTime()),
    0
  );

  const { error } = await client.from("bus_user_data").upsert({
    user_id: userId,
    stops: cloudStops,
    schema_version: 2,
    updated_at: new Date(updatedAt || Date.now()).toISOString(),
  });
  if (error) throw error;
  setSyncStatus("클라우드에 저장했습니다.");
}

export function scheduleCloudPush(client, userId, delayMs = 1500) {
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = window.setTimeout(() => {
    uploadTimer = null;
    if (window.__busCloudSyncApplying) return;
    pushLocalStateToCloud(client, userId).catch((error) => {
      console.error(error);
      setSyncStatus("클라우드 저장에 실패했습니다. 이 기기에는 저장돼 있습니다.");
    });
  }, delayMs);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} userId
 */
export async function runFullCloudSync(client, userId) {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    if (!navigator.onLine) {
      setSyncStatus("오프라인입니다. 이 기기 데이터만 보여 줍니다.");
      return;
    }
    setSyncStatus("클라우드에서 불러오는 중…");
    try {
      await pullAndMergeCloudState(client, userId);
      setSyncStatus("클라우드와 맞췄습니다.");
    } catch (error) {
      console.error(error);
      setSyncStatus(
        "클라우드를 불러오지 못했습니다. SQL 설정을 확인하거나 잠시 후 다시 시도해 주세요."
      );
    }
  })().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

export function bindCloudSaveListener(client, userId, enabled) {
  window.addEventListener("bus-local-state-saved", () => {
    if (!enabled || !userId) return;
    scheduleCloudPush(client, userId);
  });
}