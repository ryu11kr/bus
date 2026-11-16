# 내버스시간표 (`bus`)

정류장마다 **내가 붙인 이름** + **시간표 사진**을 저장합니다.  
표 형식이 달라도 되고, 앱은 **사진에서 읽은 글자**를 줄 단위로 정리해 보여 줍니다.

## 로컬 실행

`serve.cmd` → `dev-ports.json` 의 포트(기본 5176).

## 글자 읽기 (2단계)

1. **1차 — Tesseract OCR** (무료, 기기에서 실행)
2. **2차 — Gemini 정밀 읽기** (무료 티어, 서버 경유) — **정거장 등록·사진 다시 찍기** 때 자동 (온라인). 표 구조는 **JSON** 으로 받고, 앱은 **표시만** 합니다 (표마다 JS 규칙 없음).

## Gemini 무료 — 하루 몇 번?

**두 겹**으로 나뉩니다.

### 1) Google이 정한 무료 한도 (API)

- **모델마다 다름.** 예: `gemini-3.5-flash-lite` 는 무료 티어에서 **하루 수백 회(RPD)** 급인 경우가 많고, 일반 **Flash(이미지 품질 높음)** 는 **하루 20~250회**처럼 훨씬 적을 수 있습니다.
- **프로젝트(API 키 발급한 Google Cloud 프로젝트) 기준**이며, 자정 **미국 서부(태평양)** 에 리셋되는 경우가 많습니다.
- Google이 수치를 자주 바꿉니다. **본인 한도는 [Google AI Studio](https://aistudio.google.com/) → Rate limits** 에서 확인하세요.

이 앱 기본 모델: **`gemini-3.5-flash-lite`**.  
Vercel 환경 변수 `GEMINI_MODEL` 로 변경 가능.

### 2) 이 앱이 정한 일일 한도 (개발자 보호)

- 환경 변수 **`APP_DAILY_AI_LIMIT`** (기본 **0** = 앱 제한 없음, 양수면 일일 상한)
- Google Gemini 무료 한도와는 별개입니다.
- 앱 목록 아래 **「읽기 설정」** 에 `오늘 N회 남음` 표시 (Vercel 배포 URL에서만).

KV(`KV_REST_API_URL` / `KV_REST_API_TOKEN`)를 Vercel에 연결하면 카운트가 서버 전체에서 정확합니다. 없으면 서버 메모리(배포마다 대략적).

## Vercel 설정

1. `bus` 저장소를 Vercel에 연결
2. Environment Variables:
   - **`GEMINI_API_KEY`** — [Google AI Studio](https://aistudio.google.com/apikey) 에서 발급 (무료 티어)
   - **`GEMINI_MODEL`** — 선택 (기본 `gemini-3.5-flash-lite`. 예전 `gemini-2.5-*` 는 신규 키에서 불가)
   - **`APP_DAILY_AI_LIMIT`** — 선택 (미설정·`0` = 앱 제한 없음)
   - **`KV_REST_API_URL` / `KV_REST_API_TOKEN`** — 선택 (일일 카운트 정확화)
3. 배포 후 앱이 `/api/ocr-refine` 호출

한도만 확인: 브라우저에서 `https://(배포주소)/api/ocr-refine` **GET**

## 이용자·개발자 비용

- **이용자**: 앱 사용 0원
- **개발자**: Gemini **무료 티어 한도 안**이면 0원. 한도 초과 시 Google이 429를 주거나 유료 전환 필요 — 그때는 정밀 읽기만 막히고 **OCR + 사진**은 계속 무료

## GitHub

`create-github-repo.cmd` → `deploy-github.cmd`