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
 * @param {number} limit 0 = 앱 쪽 일일 제한 없음 (Google 한도만 적용)
 */
export async function getDailyQuotaStatus(limit) {
  const used = await readCount();
  if (limit === 0) {
    return {
      limit: 0,
      used,
      remaining: null,
      unlimited: true,
      resetsTimezone: "America/Los_Angeles",
      resetsNote: "앱 일일 제한 없음. Google Gemini 무료 한도는 AI Studio에서 확인하세요.",
      tracking: process.env.KV_REST_API_URL ? "kv" : "memory",
    };
  }
  const remaining = Math.max(0, limit - used);
  return {
    limit,
    used,
    remaining,
    unlimited: false,
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
  if (limit === 0) {
    const next = used + 1;
    await writeCount(next);
    return {
      allowed: true,
      ...(await getDailyQuotaStatus(0)),
      used: next,
    };
  }
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
    unlimited: false,
    resetsTimezone: "America/Los_Angeles",
    tracking: process.env.KV_REST_API_URL ? "kv" : "memory",
  };
}