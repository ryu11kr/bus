/** GET — Supabase 환경 변수 연결 여부 (키 값은 응답하지 않음) */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
  const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || "").trim();
  const configured = Boolean(supabaseUrl && supabaseAnonKey);

  return res.status(200).json({
    configured,
    hasUrl: Boolean(supabaseUrl),
    hasAnonKey: Boolean(supabaseAnonKey),
  });
}