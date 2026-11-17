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

function busPhotosApi() {
  return typeof window !== "undefined" ? window.BusStopPhotos : null;
}

function getStopPhotos(stop) {
  const api = busPhotosApi();
  if (api) return api.getStopPhotos(stop);
  if (!stop) return [];
  if (Array.isArray(stop.photos) && stop.photos.length) return stop.photos;
  if (typeof stop.photoThumb === "string" && stop.photoThumb) {
    return [{ id: `${stop.id}-legacy`, photoThumb: stop.photoThumb, updatedAt: stop.updatedAt }];
  }
  return [];
}

function mergeStopRecord(local, remote) {
  const api = busPhotosApi();
  if (api?.mergeStopRecord) return api.mergeStopRecord(local, remote);
  return new Date(String(remote.updatedAt)) >= new Date(String(local.updatedAt)) ? remote : local;
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

function photoStoragePath(userId, stopId, photoId) {
  return `${userId}/${stopId}/${photoId}.jpg`;
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

async function downloadPhotoAsDataUrl(client, path) {
  const { data, error } = await client.storage.from(BUS_PHOTOS_BUCKET).download(path);
  if (error || !data) throw error || new Error("download failed");
  return blobToDataUrl(data);
}

async function uploadOnePhoto(client, userId, stopId, photo) {
  if (!isDataUrl(photo.photoThumb)) {
    if (photo.photoPath) return photo.photoPath;
    return photoStoragePath(userId, stopId, photo.id);
  }
  const blob = dataUrlToBlob(photo.photoThumb);
  if (!blob) throw new Error("invalid photo");
  const path = photoStoragePath(userId, stopId, photo.id);
  const { error } = await client.storage.from(BUS_PHOTOS_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: blob.type || "image/jpeg",
  });
  if (error) throw error;
  return path;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {Array<Record<string, unknown>>} cloudStops
 */
async function hydrateRemoteStops(client, cloudStops) {
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const raw of cloudStops || []) {
    if (!raw?.id) continue;
    const stopId = String(raw.id);
    const name = String(raw.name || "");

    /** @type {Record<string, unknown>[]} */
    let photoEntries = [];
    if (Array.isArray(raw.photos) && raw.photos.length) {
      photoEntries = raw.photos;
    } else if (raw.photoPath || raw.photoThumb) {
      photoEntries = [
        {
          id: `${stopId}-legacy`,
          photoPath: raw.photoPath,
          photoThumb: raw.photoThumb,
          ocrText: raw.ocrText,
          sections: raw.sections,
          updatedAt: raw.updatedAt,
        },
      ];
    }

  const photos = [];
  for (const pr of photoEntries) {
    if (!pr || typeof pr !== "object") continue;
    const photoId = String(pr.id || `${stopId}-ph`);
    let photoThumb = typeof pr.photoThumb === "string" ? pr.photoThumb : "";
    if (!photoThumb && typeof pr.photoPath === "string" && pr.photoPath) {
      try {
        photoThumb = await downloadPhotoAsDataUrl(client, pr.photoPath);
      } catch (error) {
        console.error(error);
      }
    }
    if (!photoThumb) continue;
    photos.push({
      id: photoId,
      photoThumb,
      label: typeof pr.label === "string" ? pr.label.trim() : "",
      ocrText: typeof pr.ocrText === "string" ? pr.ocrText : "",
      sections: Array.isArray(pr.sections) ? pr.sections : [],
      updatedAt: typeof pr.updatedAt === "string" ? pr.updatedAt : new Date().toISOString(),
    });
  }

    if (!photos.length) continue;
    out.push({
      id: stopId,
      name,
      photos,
      photoThumb: photos[photos.length - 1].photoThumb,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : photos.at(-1).updatedAt,
    });
  }
  return out;
}

function filterValidStops(stops) {
  return (stops || []).filter((s) => s?.name && getStopPhotos(s).length);
}

/**
 * @param {Record<string, unknown>[]} localStops
 * @param {Record<string, unknown>[]} remoteStops
 */
export function mergeStopsByUpdatedAt(localStops, remoteStops) {
  const byId = new Map();
  for (const s of localStops || []) {
    if (s?.id) byId.set(String(s.id), s);
  }
  for (const remote of remoteStops || []) {
    if (!remote?.id) continue;
    const id = String(remote.id);
    const local = byId.get(id);
    if (!local) {
      byId.set(id, remote);
      continue;
    }
    byId.set(id, mergeStopRecord(local, remote));
  }
  return filterValidStops(Array.from(byId.values()));
}

/**
 * 목록 단위 시각(stateUpdatedAt)으로 어느 쪽 정류장 목록이 맞는지 정함 (삭제 동기화).
 * @param {Record<string, unknown>[]} localStops
 * @param {Record<string, unknown>[]} remoteStops
 * @param {{ localListAt: number, remoteListAt: number }} listTimes
 */
export function mergeStopsWithListRevision(localStops, remoteStops, listTimes) {
  const localListAt = listTimes.localListAt || 0;
  const remoteListAt = listTimes.remoteListAt || 0;
  const local = localStops || [];
  const remote = remoteStops || [];

  /** @type {Map<string, Record<string, unknown>>} */
  const byId = new Map();

  if (remoteListAt > localListAt) {
    for (const r of remote) {
      if (!r?.id) continue;
      const id = String(r.id);
      const loc = local.find((s) => String(s.id) === id);
      byId.set(id, loc ? mergeStopRecord(loc, r) : r);
    }
    return {
      stops: filterValidStops(Array.from(byId.values())),
      stateUpdatedAt: new Date(remoteListAt).toISOString(),
    };
  }

  if (localListAt > remoteListAt) {
    for (const s of local) {
      if (s?.id) byId.set(String(s.id), s);
    }
    for (const r of remote) {
      if (!r?.id) continue;
      const id = String(r.id);
      const prev = byId.get(id);
      if (!prev) {
        const rAt = new Date(String(r.updatedAt || 0)).getTime();
        if (rAt > localListAt) byId.set(id, r);
        continue;
      }
      byId.set(id, mergeStopRecord(prev, r));
    }
    return {
      stops: filterValidStops(Array.from(byId.values())),
      stateUpdatedAt: new Date(localListAt).toISOString(),
    };
  }

  return {
    stops: mergeStopsByUpdatedAt(local, remote),
    stateUpdatedAt: new Date(Math.max(localListAt, remoteListAt) || Date.now()).toISOString(),
  };
}

function localListRevisionMs(localState, localStops) {
  if (localState?.stateUpdatedAt) {
    return new Date(String(localState.stateUpdatedAt)).getTime();
  }
  return (localStops || []).reduce(
    (max, s) => Math.max(max, new Date(s?.updatedAt || 0).getTime()),
    0
  );
}

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
    if (localStops.length) scheduleCloudPush(client, userId, 400);
    return;
  }

  const hydrated = await hydrateRemoteStops(client, data.stops);
  const remoteListAt = new Date(data.updated_at || 0).getTime();
  const localListAt = localListRevisionMs(localState, localStops);
  let { stops: merged, stateUpdatedAt } = mergeStopsWithListRevision(localStops, hydrated, {
    localListAt,
    remoteListAt,
  });
  if (merged.length > CLOUD_MAX_STOPS) {
    merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    merged.length = CLOUD_MAX_STOPS;
  }

  window.__busCloudSyncApplying = true;
  try {
    applyLocal(merged, { stateUpdatedAt });
  } finally {
    window.__busCloudSyncApplying = false;
  }

  if (localListAt > remoteListAt) scheduleCloudPush(client, userId, 400);
}

export async function pushLocalStateToCloud(client, userId) {
  const getLocal = window.busAppGetLocalStopState;
  if (typeof getLocal !== "function") return;

  const localState = getLocal();
  let stops = Array.isArray(localState.stops) ? [...localState.stops] : [];
  const stateUpdatedAt =
    typeof localState.stateUpdatedAt === "string" && localState.stateUpdatedAt
      ? localState.stateUpdatedAt
      : new Date().toISOString();

  if (!stops.length) {
    await client.from("bus_user_data").upsert({
      user_id: userId,
      stops: [],
      schema_version: 3,
      updated_at: stateUpdatedAt,
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
    const photos = getStopPhotos(stop);
    if (!photos.length) continue;

    /** @type {Record<string, unknown>[]} */
    const cloudPhotos = [];
    for (const photo of photos) {
      let photoPath = "";
      if (isDataUrl(photo.photoThumb)) {
        photoPath = await uploadOnePhoto(client, userId, String(stop.id), photo);
      } else if (isHttpUrl(photo.photoThumb)) {
        photoPath = photoStoragePath(userId, String(stop.id), String(photo.id));
      } else {
        continue;
      }
      cloudPhotos.push({
        id: photo.id,
        label: typeof photo.label === "string" ? photo.label : "",
        ocrText: photo.ocrText || "",
        sections: photo.sections || [],
        updatedAt: photo.updatedAt || stop.updatedAt,
        photoPath,
      });
    }
    if (!cloudPhotos.length) continue;

    cloudStops.push({
      id: stop.id,
      name: stop.name,
      photos: cloudPhotos,
      updatedAt: stop.updatedAt || new Date().toISOString(),
    });
  }

  const { error } = await client.from("bus_user_data").upsert({
    user_id: userId,
    stops: cloudStops,
    schema_version: 3,
    updated_at: stateUpdatedAt,
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