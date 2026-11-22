/** bus-photos 버킷 — 사용자 폴더 전체 삭제 */

const BUCKET = "bus-photos";
const BATCH = 100;

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {string} prefix
 * @returns {Promise<string[]>}
 */
async function listAllObjectPaths(admin, prefix) {
  const paths = [];
  const root = String(prefix || "").replace(/\/+$/, "");
  if (!root) return paths;
  const stack = [root];
  while (stack.length) {
    const folder = stack.pop();
    const { data, error } = await admin.storage.from(BUCKET).list(folder, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    for (const entry of data || []) {
      const full = `${folder}/${entry.name}`;
      if (entry.metadata) {
        paths.push(full);
      } else {
        stack.push(full);
      }
    }
  }
  return paths;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {string} userId
 */
export async function deleteUserBusPhotos(admin, userId) {
  const paths = await listAllObjectPaths(admin, userId);
  for (let i = 0; i < paths.length; i += BATCH) {
    const chunk = paths.slice(i, i + BATCH);
    if (!chunk.length) continue;
    const { error } = await admin.storage.from(BUCKET).remove(chunk);
    if (error) throw error;
  }
}