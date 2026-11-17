/** Bearer JWT → Supabase 사용자 */

export async function getAuthUser(req) {
  const url = (process.env.SUPABASE_URL || "").trim();
  const anon = (process.env.SUPABASE_ANON_KEY || "").trim();
  const token = String(req.headers.authorization || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!url || !anon || !token) return null;

  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error,
  } = await client.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

export function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

/** Gmail 점(.)·+별칭·googlemail 통일 — 공유·푸시 조회용 */
export function canonicalShareEmail(email) {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") {
    local = local.replace(/\./g, "");
    const plus = local.indexOf("+");
    if (plus >= 0) local = local.slice(0, plus);
  }
  return `${local}@${domain}`;
}

export function shareEmailLookupKeys(email) {
  const plain = normalizeEmail(email);
  const canon = canonicalShareEmail(email);
  return plain === canon ? [plain] : [canon, plain];
}