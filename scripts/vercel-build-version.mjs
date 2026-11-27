import { readFileSync, writeFileSync } from "node:fs";

const sha = process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now()}`;
/** 배포마다 항상 증가하는 빌드 번호(SHA 16진은 커밋마다 줄어들 수 있음). */
const build = Math.floor(Date.now() / 1000);

let cachePrefix = "bus-timetable";
try {
  const cfg = JSON.parse(readFileSync("pwa.config.json", "utf8"));
  if (cfg.cachePrefix) cachePrefix = cfg.cachePrefix;
} catch {
}

const payload = {
  build,
  cacheName: `${cachePrefix}-${build}`,
  label: `배포 ${sha.slice(0, 7)}`,
  updatedAt: new Date().toISOString(),
  commitSha: sha,
};

writeFileSync("version.json", `${JSON.stringify(payload, null, 2)}\n`);
console.log(`version.json → build ${build} (${sha.slice(0, 7)})`);

const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || "").trim();
const syncRuntime = {
  configured: Boolean(supabaseUrl && supabaseAnonKey),
  supabaseUrl: supabaseUrl || null,
  supabaseAnonKey: supabaseAnonKey || null,
  builtAt: new Date().toISOString(),
};
writeFileSync(
  "cloud-sync.runtime.json",
  `${JSON.stringify(syncRuntime, null, 2)}\n`
);
console.log(
  `cloud-sync.runtime.json → configured ${syncRuntime.configured ? "yes" : "no"}`
);