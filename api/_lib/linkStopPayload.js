/** 링크 공유용 정류장 JSON (서버·클라이언트 공통 규칙) */

const MAX_NAME = 40;
const MAX_LABEL = 30;
const MAX_PHOTO_DATA_URL = 900_000;

/**
 * @param {unknown} raw
 */
export function sanitizeStopForLink(raw) {
  if (!raw || typeof raw !== "object") return null;
  const stop = /** @type {Record<string, unknown>} */ (raw);
  const id = String(stop.id || "").trim();
  const name = String(stop.name || "").trim().slice(0, MAX_NAME);
  if (!id || !name) return null;

  /** @type {Record<string, unknown>[]} */
  const srcPhotos = Array.isArray(stop.photos) ? stop.photos : [];
  /** @type {Record<string, unknown>[]} */
  const photos = [];

  for (const pr of srcPhotos) {
    if (!pr || typeof pr !== "object") continue;
    const thumb = typeof pr.photoThumb === "string" ? pr.photoThumb : "";
    if (!thumb.startsWith("data:image/") || thumb.length > MAX_PHOTO_DATA_URL) continue;
    photos.push({
      id: String(pr.id || `ph-${photos.length}`),
      photoThumb: thumb,
      label: typeof pr.label === "string" ? pr.label.trim().slice(0, MAX_LABEL) : "",
      ocrText: typeof pr.ocrText === "string" ? pr.ocrText.slice(0, 2000) : "",
      sections: Array.isArray(pr.sections) ? pr.sections.slice(0, 20) : [],
      updatedAt: typeof pr.updatedAt === "string" ? pr.updatedAt : new Date().toISOString(),
    });
  }

  if (!photos.length && typeof stop.photoThumb === "string" && stop.photoThumb.startsWith("data:image/")) {
    const thumb = stop.photoThumb;
    if (thumb.length <= MAX_PHOTO_DATA_URL) {
      photos.push({
        id: `${id}-legacy`,
        photoThumb: thumb,
        label: "",
        ocrText: typeof stop.ocrText === "string" ? stop.ocrText.slice(0, 2000) : "",
        sections: Array.isArray(stop.sections) ? stop.sections.slice(0, 20) : [],
        updatedAt: typeof stop.updatedAt === "string" ? stop.updatedAt : new Date().toISOString(),
      });
    }
  }

  if (!photos.length) return null;

  return {
    id,
    name,
    updatedAt: typeof stop.updatedAt === "string" ? stop.updatedAt : new Date().toISOString(),
    photos,
  };
}