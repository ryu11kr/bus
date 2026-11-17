# Android 공유 푸시 (VAPID) — 키 만들기 → Vercel에 넣기

공유 **수락**은 VAPID 없이 됩니다.  
**잠금화면 알림**만 아래 설정이 필요합니다.

---

## 0. 지금 필요한지 확인

PC 크롬 주소창에 입력:

**https://bus.uxpwa.com/api/push-public-key**

| 보이는 글 | 의미 |
|-----------|------|
| `"configured":false` | 이 메뉴얼 그대로 진행 |
| `"configured":true` | Vercel 설정 끝 → 폰에서 「Android 공유 알림 켜기」만 |

---

## 1부: VAPID 키 만들기 (프로그램 설치 없이, 브라우저)

1. PC 크롬에서 새 탭
2. 주소창에 **`vapidkeys.com`** 입력 후 들어가기  
   (영문 사이트: **Generate VAPID Keys** / **Create** 비슷한 버튼)
3. **Generate** 또는 **Create Keys** 클릭
4. 화면에 **Public Key**, **Private Key** 두 줄이 나옵니다.  
   각각 오른쪽 **Copy** 로 복사해 **메모장**에 잠깐 붙여 두기:
   - Public Key: 보통 `B` 로 시작하는 긴 문자열
   - Private Key: 비슷하게 긴 문자열 (절대 GitHub·카톡에 올리지 마세요)
5. **Subject** 는 직접 적습니다:  
   `mailto:본인@gmail.com`  
   (본인 Gmail, 예: `mailto:imris@hanmail.net`)

> Node가 있으면 대신: `bus` 폴더에서 `npx web-push generate-vapid-keys` 해도 됩니다.

---

## 2부: Vercel에 변수 3개 넣기

1. **https://vercel.com** 로그인
2. **bus** 프로젝트 (bus.uxpwa.com 연결된 것) 클릭
3. 위 메뉴 **Settings**
4. 왼쪽 **Environment Variables**
5. 아래 **3번** 반복 (한 번에 한 줄씩):

| Key (이름 정확히) | Value (값) | Environment |
|-------------------|------------|-------------|
| `VAPID_PUBLIC_KEY` | 1부에서 복사한 **Public Key 전체** | Production, Preview, Development **전부 체크** |
| `VAPID_PRIVATE_KEY` | **Private Key 전체** | 위와 같이 전부 체크 |
| `VAPID_SUBJECT` | `mailto:본인이메일` (예: `mailto:abc@gmail.com`) | 위와 같이 전부 체크 |

6. 매번 **Save**

이미 있는 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` 는 **건드리지 않아도** 됩니다.

---

## 3부: 다시 배포 (필수)

환경 변수는 **저장만으로는 안 바뀝니다.**

1. Vercel 같은 프로젝트 → **Deployments**
2. 맨 위 배포 오른쪽 **⋯** (점 세 개)
3. **Redeploy** → 확인
4. 1~2분 기다리기

---

## 4부: 적용 확인

다시 브라우저에서:

**https://bus.uxpwa.com/api/push-public-key**

대략 이렇게 바뀌어야 합니다:

```json
{"configured":true,"publicKey":"B..."}
```

---

## 5부: 폰(Android)에서 켜기

1. **홈 화면에 추가**한 PWA로 열기 (권장)
2. 구글 **로그인**
3. **내 정류장 안전하게 보관** 펼치기
4. **Android 공유 알림 켜기** → **알림 허용** 뜨면 **허용**
5. 위쪽 상태에 **「Android 공유 알림을 켰습니다」** 나오면 OK
6. (확인) 로그인한 상태에서 **`https://bus.uxpwa.com/api/push-status`** 는 브라우저만으로는 안 되므로, 앱에서 알림 켠 뒤 **공유 보내기** 시 보낸 사람 메시지에 “상대가 알림을 아직…” 이 **없으면** 서버에 구독이 있는 것
7. 다른 계정에서 공유 보내면 잠금화면/상단 알림 테스트

---

## 자주 막히는 것

| 증상 | 해결 |
|------|------|
| 버튼 눌러도 조용함 | 4부 `configured` 가 아직 false → 3부 Redeploy 다시 |
| 알림 허용 안 뜸 | 삼성: 설정 → 앱 → 브라우저/내버스시간표 → 알림 |
| 푸시만 안 옴 | PWA 설치 · 받는 사람이 **Android 공유 알림 켜기** 했는지 |