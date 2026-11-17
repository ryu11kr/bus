# 구글 로그인 (스텝 3) — Google Cloud + Supabase

앱 동기화(`enabled`)는 **아직 꺼짐**입니다. 이 단계는 **로그인만** 됩니다.

Supabase **Project URL** 은 이미 있다고 가정합니다.  
예: `https://syyroablftwwphgxdkhj.supabase.co` → 아래에서 **`syyroablftwwphgxdkhj`** 부분이 **프로젝트 ID** 입니다.

---

## 1부: Google Cloud — OAuth 클라이언트

1. **https://console.cloud.google.com** (구글 계정 로그인)
2. 상단에서 **프로젝트** 선택 또는 **새 프로젝트** 만들기 (이름: `bus-timetable` 등)
3. 왼쪽 **☰** → **APIs & Services** → **OAuth consent screen**
   - User Type: **External** (외부)
   - 앱 이름: `내버스시간표` 등
   - 사용자 지원 이메일: 본인 Gmail
   - 나머지 필수 항목만 채우고 저장
   - **테스트 사용자**에 테스트할 Gmail 추가 (앱이 Testing 이면 필수)
4. **APIs & Services** → **Credentials** → **+ Create Credentials** → **OAuth client ID**
   - Application type: **Web application**
   - Name: `bus-uxpwa`
   - **Authorized JavaScript origins** (한 줄씩 추가):
     - `https://bus.uxpwa.com`
     - 로컬 테스트 시: `http://127.0.0.1:5176` (본인 포트에 맞게)
   - **Authorized redirect URIs** (한 줄 추가):
     - `https://[프로젝트ID].supabase.co/auth/v1/callback`  
       예: `https://syyroablftwwphgxdkhj.supabase.co/auth/v1/callback`
5. **Create** 후 **Client ID** 와 **Client secret** 을 메모장에 복사

---

## 2부: Supabase — Google 제공자 켜기

1. Supabase 대시보드 → 본인 프로젝트
2. 왼쪽 **Authentication** → **Providers** (또는 Sign In / Providers)
3. **Google** 찾아서 **Enable**
4. **Client ID** / **Client Secret** (Google에서 받은 것) 붙여넣기
5. **Save**

(Callback URL은 Supabase 화면에 나오는 주소와 Google redirect URI 가 **같아야** 합니다.)

---

## 3부: Supabase — 사이트 URL (중요)

1. **Authentication** → **URL configuration** (또는 Settings)
2. **Site URL:** `https://bus.uxpwa.com`
3. **Redirect URLs** 에 추가:
   - `https://bus.uxpwa.com/**`
   - `https://bus.uxpwa.com`
   - 로컬: `http://127.0.0.1:5176/**`
4. **Save**

---

## 4부: GitHub 푸시·Vercel 배포

코드는 이미 올라갑니다. 배포 후 테스트하세요.

---

## 5부: 앱에서 확인

1. **https://bus.uxpwa.com** (또는 Vercel 미리보기)
2. 첫 화면 맨 아래 **다른 폰에서도 보기** 펼치기
3. **구글로 로그인** → 구글 계정 선택 → 앱으로 돌아옴
4. 로그인된 **이메일** 표시되면 성공  
5. **정류장 데이터는 아직 이 기기만** (스텝 4에서 클라우드 저장)

---

## 구글 화면에 `supabase.co(으)로 이동` 이 보일 때

앱 코드로는 바뀌지 않습니다. **Google Cloud 브랜딩**(앱 이름 `내버스시간표`) 또는 Supabase 커스텀 도메인(유료)으로 고칩니다.  
자세한 단계: **`메뉴얼-구글로그인-화면이름.md`** · 개인정보 URL: `https://bus.uxpwa.com/privacy.html`

---

## 자주 하는 실수

| 증상 | 확인 |
|------|------|
| 로그인 화면에 supabase 주소만 보임 | `메뉴얼-구글로그인-화면이름.md` 브랜딩 
| redirect_uri_mismatch | Google redirect URI = `https://[ID].supabase.co/auth/v1/callback` |
| 앱으로 안 돌아옴 | Supabase Redirect URLs에 `https://bus.uxpwa.com/**` |
| 액세스 차단 (테스트) | OAuth consent screen **테스트 사용자**에 Gmail 추가 |
| 로그인 버튼 없음 | `sync-status` 가 true 인지, 배포 후 `cloud-sync.runtime.json` |

---

## 다음 (스텝 4)

로그인한 계정으로 정류장·사진을 Supabase에 저장·불러오기 (`enabled` 는 그때 켜기).