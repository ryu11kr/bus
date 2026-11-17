/** 정류장당 여러 시간표 사진 — 공통 (app + cloud-sync) */
(function () {
  const MAX = 12;

  /**
   * @param {Record<string, unknown> | null | undefined} stop
   */
  function getStopPhotos(stop) {
    if (!stop) return [];
    if (Array.isArray(stop.photos) && stop.photos.length) {
      return stop.photos
        .filter((p) => p && typeof p.photoThumb === "string" && p.photoThumb)
        .map((p) => ({
          id: String(p.id || `ph-${Date.now()}`),
          photoThumb: String(p.photoThumb),
          label: typeof p.label === "string" ? p.label.trim() : "",
          ocrText: typeof p.ocrText === "string" ? p.ocrText : "",
          sections: Array.isArray(p.sections) ? p.sections : [],
          updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : new Date().toISOString(),
        }));
    }
    if (typeof stop.photoThumb === "string" && stop.photoThumb) {
      return [
        {
          id: `${stop.id}-legacy`,
          photoThumb: stop.photoThumb,
          label: typeof stop.label === "string" ? stop.label.trim() : "",
          ocrText: typeof stop.ocrText === "string" ? stop.ocrText : "",
          sections: Array.isArray(stop.sections) ? stop.sections : [],
          updatedAt: typeof stop.updatedAt === "string" ? stop.updatedAt : new Date().toISOString(),
        },
      ];
    }
    return [];
  }

  /**
   * @param {Record<string, unknown>} stop
   */
  function normalizeStopPhotos(stop) {
    const photos = getStopPhotos(stop);
    stop.photos = photos;
    const cover = photos[photos.length - 1] || photos[0];
    if (cover) {
      stop.photoThumb = cover.photoThumb;
      stop.ocrText = cover.ocrText;
      stop.sections = cover.sections;
    }
    return stop;
  }

  /**
   * @param {unknown[]} a
   * @param {unknown[]} b
   */
  function mergePhotoArrays(a, b) {
    const map = new Map();
    for (const raw of [...(a || []), ...(b || [])]) {
      if (!raw || typeof raw !== "object") continue;
      const id = String(raw.id || "");
      if (!id) continue;
      const entry = {
        id,
        photoThumb: typeof raw.photoThumb === "string" ? raw.photoThumb : "",
        label: typeof raw.label === "string" ? raw.label.trim() : "",
        ocrText: typeof raw.ocrText === "string" ? raw.ocrText : "",
        sections: Array.isArray(raw.sections) ? raw.sections : [],
        updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
        photoPath: typeof raw.photoPath === "string" ? raw.photoPath : "",
      };
      const prev = map.get(id);
      if (!prev || new Date(entry.updatedAt) >= new Date(prev.updatedAt)) {
        map.set(id, {
          ...prev,
          ...entry,
          photoThumb: entry.photoThumb || prev?.photoThumb,
          label: entry.label || prev?.label || "",
        });
      }
    }
    return Array.from(map.values()).sort(
      (x, y) => new Date(x.updatedAt).getTime() - new Date(y.updatedAt).getTime()
    );
  }

  /** @param {Record<string, unknown>} local @param {Record<string, unknown>} remote */
  function mergeStopRecord(local, remote) {
    const name =
      new Date(String(remote.updatedAt || 0)) >= new Date(String(local.updatedAt || 0))
        ? String(remote.name || local.name)
        : String(local.name || remote.name);
    const photos = mergePhotoArrays(getStopPhotos(local), getStopPhotos(remote));
    const updatedAt =
      photos.reduce(
        (max, p) => Math.max(max, new Date(p.updatedAt).getTime()),
        Math.max(
          new Date(local.updatedAt || 0).getTime(),
          new Date(remote.updatedAt || 0).getTime()
        )
      ) || Date.now();
    const stop = {
      id: String(local.id || remote.id),
      name,
      photos,
      updatedAt: new Date(updatedAt).toISOString(),
    };
    return normalizeStopPhotos(stop);
  }

  /**
   * @param {{ label?: string } | null | undefined} photo
   * @param {number} index
   */
  function displayPhotoLabel(photo, index) {
    const t = typeof photo?.label === "string" ? photo.label.trim() : "";
    if (t) return t;
    return `사진 ${index + 1}`;
  }

  window.BusStopPhotos = {
    MAX_PHOTOS_PER_STOP: MAX,
    getStopPhotos,
    normalizeStopPhotos,
    mergePhotoArrays,
    mergeStopRecord,
    displayPhotoLabel,
  };
})();