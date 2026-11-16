/** 앱 자체 일일 한도 (개발자 과금·남용 방지). Google 한도와 별개. */

function pacificDateKey(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now);
}

function quotaKey() {
  return `bus-ai-refine:${pacificDateKey()}`;
}

function memoryStore() {
  if (!globalThis.__busAiQuota) {
    globalThis.__busAiQuota = { key: "", count: 0 };
  }
  return globalThis.__busAiQuota;
}

async function kvCommand(command) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(command),
  });
  if (!response.ok) return null;
  return response.json();
}

async function readCount() {
  const key = quotaKey();
  const kvResult = await kvCommand(["GET", key]);
  if (kvResult && kvResult.result !== null && kvResult.result !== undefined) {
    return Number(kvResult.result) || 0;
  }

  const mem = memoryStore();
  if (mem.key !== key) {
    mem.key = key;
    mem.count = 0;
  }
  return mem.count;
}

async function writeCount(value) {
  const key = quotaKey();
  const kvOk = await kvCommand(["SET", key, String(value), "EX", 60 * 60 * 36]);
  if (kvOk) return;

  const mem = memoryStore();
  mem.key = key;
  mem.count = value;
}

/**
 * @param {number} limit
 */
export async function getDailyQuotaStatus(limit) {
  const used = await readCount();
  const remaining = Math.max(0, limit - used);
  return {
    limit,
    used,
    remaining,
    resetsTimezone: "America/Los_Angeles",
    resetsNote: "일일 카운트는 미국 서부(태평양) 자정에 바뀝니다 (Google 무료 한도와 같은 기준인 경우 많음).",
    tracking: process.env.KV_REST_API_URL ? "kv" : "memory",
  };
}

/**
 * @param {number} limit
 */
export async function checkAndIncrementDailyQuota(limit) {
  const used = await readCount();
  if (used >= limit) {
    return { allowed: false, ...(await getDailyQuotaStatus(limit)) };
  }
  const next = used + 1;
  await writeCount(next);
  return {
    allowed: true,
    limit,
    used: next,
    remaining: Math.max(0, limit - next),
    resetsTimezone: "America/Los_Angeles",
    tracking: process.env.KV_REST_API_URL ? "kv" : "memory",
  };
}