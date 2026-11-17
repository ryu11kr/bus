const CLOUD_MAX_STOPS = 30;

function newId() {
  return globalThis.crypto.randomUUID();
}

function photoPathFor(ownerId, stopId, photoId) {
  return `${ownerId}/${stopId}/${photoId}.jpg`;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {string} ownerId
 * @param {string} recipientId
 */
export async function importStopsFromOwnerToRecipient(admin, ownerId, recipientId) {
  const { data: ownerRow, error: ownerErr } = await admin
    .from("bus_user_data")
    .select("stops")
    .eq("user_id", ownerId)
    .maybeSingle();
  if (ownerErr) throw ownerErr;

  const ownerStops = Array.isArray(ownerRow?.stops) ? ownerRow.stops : [];
  if (!ownerStops.length) {
    throw new Error("보낸 사람의 클라우드에 정류장이 없습니다.");
  }

  const { data: recipRow } = await admin
    .from("bus_user_data")
    .select("stops")
    .eq("user_id", recipientId)
    .maybeSingle();

  const existing = Array.isArray(recipRow?.stops) ? [...recipRow.stops] : [];
  const now = new Date().toISOString();
  /** @type {Record<string, unknown>[]} */
  const imported = [];

  for (const stop of ownerStops) {
    if (!stop?.id || !stop?.name) continue;
    const newStopId = newId();
    /** @type {Record<string, unknown>[]} */
    const cloudPhotos = [];
    const photoList = Array.isArray(stop.photos) ? stop.photos : [];

    for (const photo of photoList) {
      if (!photo || typeof photo !== "object") continue;
      const oldPhotoId = String(photo.id || "ph");
      const newPhotoId = newId();
      const oldPath =
        typeof photo.photoPath === "string" && photo.photoPath
          ? photo.photoPath
          : photoPathFor(ownerId, String(stop.id), oldPhotoId);

      const { data: blob, error: dlErr } = await admin.storage.from("bus-photos").download(oldPath);
      if (dlErr || !blob) continue;

      const newPath = photoPathFor(recipientId, newStopId, newPhotoId);
      const { error: upErr } = await admin.storage.from("bus-photos").upload(newPath, blob, {
        upsert: true,
        contentType: blob.type || "image/jpeg",
      });
      if (upErr) continue;

      cloudPhotos.push({
        id: newPhotoId,
        label: typeof photo.label === "string" ? photo.label : "",
        ocrText: typeof photo.ocrText === "string" ? photo.ocrText : "",
        sections: Array.isArray(photo.sections) ? photo.sections : [],
        updatedAt: typeof photo.updatedAt === "string" ? photo.updatedAt : now,
        photoPath: newPath,
      });
    }

    if (!cloudPhotos.length) continue;
    imported.push({
      id: newStopId,
      name: String(stop.name),
      photos: cloudPhotos,
      updatedAt: now,
    });
  }

  if (!imported.length) {
    throw new Error("가져올 사진 있는 정류장이 없습니다.");
  }

  let merged = [...existing, ...imported];
  if (merged.length > CLOUD_MAX_STOPS) {
    merged.sort(
      (a, b) =>
        new Date(String(b.updatedAt || 0)).getTime() - new Date(String(a.updatedAt || 0)).getTime()
    );
    merged = merged.slice(0, CLOUD_MAX_STOPS);
  }

  const { error: upsertErr } = await admin.from("bus_user_data").upsert({
    user_id: recipientId,
    stops: merged,
    schema_version: 3,
    updated_at: now,
  });
  if (upsertErr) throw upsertErr;

  return { importedCount: imported.length, totalStops: merged.length };
}