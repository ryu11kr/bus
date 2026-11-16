/**
 * Vercel Serverless — 버스 시간표 이미지 정밀 판독 (Google Gemini 무료 티어)
 *
 * 환경 변수 (Vercel → Settings → Environment Variables):
 *   GEMINI_API_KEY       — Google AI Studio API 키 (필수)
 *   GEMINI_MODEL         — 기본 gemini-3.5-flash-lite (신규 API 키용)
 *   APP_DAILY_AI_LIMIT   — 앱 일일 정밀 읽기 상한 (기본 0=앱 제한 없음, 양수면 그만큼)
 *   KV_REST_API_URL      — (선택) Vercel KV / Upstash — 일일 카운트 정확 추적
 *   KV_REST_API_TOKEN
 */

import { checkAndIncrementDailyQuota, getDailyQuotaStatus } from "./_daily-quota.js";

const PROMPT = `당신은 시골 버스 정류장 시간표 사진을 옮기는 도우미입니다.
이미지에 보이는 글자만 한국어로 옮기세요. 추측·설명·해설은 금지.

출력 형식(반드시 지키세요):
- 표 전체 제목이 있으면 첫 줄: # 제목 (# 뒤에 한 칸 띄우기)
- 구간·방향마다: ## 제목 (# 없이 보이는 머리글 그대로, 예: ## 봉화 방면)
- 한 줄에 시각 하나 + 종착지·행선이 있으면: HH:MM | 종착지 (24시간제, 종착지는 사진 그대로)
- 좌우 2열에 시각만 나란히 있는 표만: ## 왼쪽 제목 / ## 오른쪽 제목 아래에 각 열의 시각만 한 줄에 하나
- 전화번호, 연락처, 광고, 웹주소는 넣지 마세요`;

function resolveAppDailyLimit() {
  const raw = process.env.APP_DAILY_AI_LIMIT;
  if (raw === "0" || raw === "off" || raw === "none") return 0;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 0;
}

function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

async function callGeminiVision(apiKey, model, mimeType, base64Data) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: mimeType, data: base64Data } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg =
      payload?.error?.message ||
      (response.status === 429
        ? "Google 무료 한도에 걸렸습니다. 내일(미국 서부 자정) 이후 다시 시도하세요."
        : "Gemini 요청 실패");
    return { ok: false, status: response.status, error: msg };
  }

  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("").trim();
  if (!text) {
    return { ok: false, status: 502, error: "인공지능이 글자를 돌려주지 않았습니다." };
  }
  return { ok: true, text };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const appLimit = resolveAppDailyLimit();

  if (req.method === "GET") {
    const quota = await getDailyQuotaStatus(appLimit);
    return res.status(200).json({
      provider: "gemini",
      model,
      appDailyLimit: appLimit,
      quota,
      deploy: {
        commitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
        commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE || null,
        ref: process.env.VERCEL_GIT_COMMIT_REF || null,
        deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
      },
      googleFreeTierNote:
        "Google 무료 한도는 모델·프로젝트마다 다릅니다. Flash-Lite는 보통 하루 수밝 회급, 일반 Flash는 더 적습니다. AI Studio에서 본인 한도를 확인하세요.",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "GET(한도 조회) 또는 POST만 사용합니다." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "서버에 GEMINI_API_KEY가 없습니다. AI Studio에서 키를 발급해 Vercel에 등록하세요.",
    });
  }

  const quotaCheck = await checkAndIncrementDailyQuota(appLimit);
  if (!quotaCheck.allowed) {
    return res.status(429).json({
      error: `오늘 이 앱의 정밀 읽기 무료 횟수(${appLimit}회)를 모두 썼습니다. 내일 다시 시도하거나 기본 OCR·사진만 이용하세요.`,
      quota: quotaCheck,
    });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const image = body?.image;
  if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
    return res.status(400).json({ error: "image (data URL) 가 필요합니다." });
  }
  if (image.length > 6_500_000) {
    return res.status(413).json({ error: "이미지가 너무 큽니다." });
  }

  const parsed = parseDataUrl(image);
  if (!parsed) {
    return res.status(400).json({ error: "이미지 형식이 올바르지 않습니다." });
  }

  try {
    const result = await callGeminiVision(apiKey, model, parsed.mimeType, parsed.data);
    if (!result.ok) {
      return res.status(result.status || 502).json({
        error: result.error,
        quota: quotaCheck,
      });
    }

    const quotaAfter = await getDailyQuotaStatus(appLimit);
    return res.status(200).json({
      text: result.text,
      source: "gemini",
      quota: quotaAfter,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "서버 오류",
      quota: quotaCheck,
    });
  }
}