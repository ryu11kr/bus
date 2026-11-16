# Gemini API 키 받기 → Vercel에 넣기 (내버스시간표)

로컬 `serve.cmd`에는 **AI가 없고**, **Vercel 배포 주소**에서만 정밀 읽기가 됩니다.  
키는 **Google**에서 받고, **Vercel**에만 적어 둡니다. (앱 코드·GitHub에 키 넣지 마세요.)

---

## 1부: Google에서 API 키 따기

1. 브라우저에서 구글 계정으로 로그인합니다.
2. 주소창에 들어갑니다:  
   **https://aistudio.google.com/apikey**
3. **「API 키 만들기」** 또는 **Create API key** 를 누릅니다.
4. 프로젝트를 고르라고 하면:
   - 처음이면 **새 프로젝트** 만들어도 됩니다 (이름 아무거나).
5. 만들어진 키가 **한 줄**로 보입니다. 보통 `AIza` 로 시작합니다.
6. **복사**해 메모장에 잠깐 붙여 두세요.  
   (다시 전체를 보여주지 않을 수 있으니, 복사를 놓치지 마세요.)

무료 티어로 쓰려면, AI Studio에서 결제(유료)를 켜지 않아도 되는 경우가 많습니다.  
Google 화면에 “무료” / Free tier 안내가 보이면 그대로 진행하면 됩니다.

---

## 2부: Vercel에 키 넣기

`bus` 앱이 이미 GitHub → Vercel에 연결돼 있다고 가정합니다.

1. **https://vercel.com** 에 로그인합니다. (GitHub로 로그인한 그 계정)
2. 대시보드에서 **`bus` 저장소에 연결된 프로젝트** 이름을 클릭합니다.  
   (이름이 `bus`가 아니어도 됩니다. `bus` 폴더를 배포한 프로젝트를 고르세요.)
3. 위쪽 메뉴 **Settings** (설정) 클릭.
4. 왼쪽 **Environment Variables** (환경 변수) 클릭.
5. 아래처럼 **한 줄** 추가합니다.

| 항목 | 넣을 값 |
|------|---------|
| **Name (키 이름)** | `GEMINI_API_KEY` |
| **Value (값)** | 아까 복사한 `AIza...` 전체 |
| **Environments** | **Production**, **Preview**, **Development** 모두 체크 |

6. **Save** 저장.

(선택) 더 바꾸고 싶을 때만:

| Name | Value (예시) |
|------|----------------|
| `GEMINI_MODEL` | `gemini-2.5-flash-lite` (기본과 같으면 생략 가능) |
| `APP_DAILY_AI_LIMIT` | `50` (하루 정밀 읽기 최대 횟수) |

---

## 3부: 다시 배포하기 (중요)

환경 변수는 **저장 후 새 배포**에만 적용됩니다.

1. 같은 Vercel 프로젝트에서 **Deployments** 탭.
2. 맨 위(가장 최근) 배포 오른쪽 **⋯** 메뉴 → **Redeploy** (다시 배포).
3. 끝날 때까지 기다립니다 (1~2분).

또는 `bus` 폴더에서 아무 파일이나 살짝 수정 후 `deploy-github.cmd` 로 푸시해도 새 배포가 됩니다.

---

## 4부: 잘 붙었는지 확인

1. Vercel 프로젝트 **Overview** 에 있는 주소를 복사합니다.  
   예: `https://bus-xxxx.vercel.app`
2. 브라우저 새 탭에 주소 뒤에 붙입니다:  
   `https://bus-xxxx.vercel.app/api/ocr-refine`  
   (GET 요청이라 페이지만 열면 됩니다.)
3. **JSON** 비슷한 글이 보이고, 에러가 `GEMINI_API_KEY가 없습니다` 가 **아니면** 성공입니다.
4. 폰/PC에서 **같은 Vercel 주소**로 앱을 열고, 시간표 사진을 다시 등록해 봅니다.

---

## 자주 하는 실수

- 키 이름을 `GEMINI_API_KEY` 가 아니라 다른 이름으로 넣음 → 반드시 **이름 그대로**.
- Vercel에만 넣고 **Redeploy 안 함** → 반드시 다시 배포.
- **127.0.0.1:5176** 로컬에서 AI 검수 → 로컬은 OCR만. 검수는 **Vercel URL**에서.
- API 키를 GitHub에 커밋함 → **절대 금지**. Vercel 환경 변수에만.

---

## 막힐 때

- Vercel에 `bus` 프로젝트가 없다 → GitHub에 `bus` 올린 뒤 Vercel에서 **Import** 로 저장소 연결.
- `/api/ocr-refine` 이 404 → Vercel이 `bus` 폴더 루트가 맞는지 확인 (저장소 루트에 `api/ocr-refine.js` 가 있어야 함).