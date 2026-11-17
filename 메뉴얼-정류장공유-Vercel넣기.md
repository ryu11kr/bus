# 정류장 공유 + Android 푸시 — Supabase SQL · Vercel 환경 변수

코드는 배포됐어도 **SQL 한 번** + **Vercel 변수** 없으면 공유·푸시가 동작하지 않습니다.

---

## 1부: Supabase SQL

1. **https://supabase.com** → bus 프로젝트
2. 왼쪽 **SQL Editor** → New query
3. 저장소 파일 **`supabase/bus-share-setup.sql`** 전체 복사 → 붙여넣기 → **Run**
4. 이미 `bus-cloud-setup.sql` 실행했다면 그 다음에 하면 됩니다.

---

## 2부: Vercel 환경 변수

**https://vercel.com** → bus 프로젝트 → **Settings** → **Environment Variables**

| Name | 넣을 값 |
|------|---------|
| `SUPABASE_URL` | (기존과 같음) |
| `SUPABASE_ANON_KEY` | (기존과 같음) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → **Project Settings** → **API** → **service_role** (비밀, GitHub에 넣지 마세요) |

### Android 푸시용 (VAPID)

터미널에서 한 번만 (로컬):

```bash
cd bus
npx web-push generate-vapid-keys
```

나온 **Public Key** / **Private Key**를 Vercel에 추가:

| Name | 값 |
|------|-----|
| `VAPID_PUBLIC_KEY` | Public Key 전체 |
| `VAPID_PRIVATE_KEY` | Private Key 전체 |
| `VAPID_SUBJECT` | `mailto:본인이메일@example.com` (본인 Gmail 등) |

푸시 없이 **공유만** 테스트하려면 VAPID는 나중에 넣어도 됩니다.

---

## 3부: 다시 배포

**Deployments** → 최근 배포 **⋯** → **Redeploy**

---

## 4부: 테스트 순서 (Android)

1. **PWA 설치** (홈 화면 추가)
2. 두 개 Google 계정 — 남편·아내
3. 남편: 정류장 등록 → 구글 로그인 → **내 정류장 안전하게 보관** 펼침 → **정류장 공유**에 아내 Gmail → 보내기
4. 아내: 로그인 → 같은 패널에 **`남편@gmail.com 님이…`** 카드 → **수락**
5. 아내: **Android 공유 알림 켜기** → 다음부터는 앱 꺼져 있어도 알림 (VAPID 설정 시)

---

## 문제 해결

| 증상 | 확인 |
|------|------|
| 공유 보내기 실패 (빨간/일반 메시지) | **1순위:** `bus-share-setup.sql` SQL 실행했는지 · 정류장 **사진 등록 후** 보내기 |
| 수락만 안 됨 | `SUPABASE_SERVICE_ROLE_KEY` (수락·사진 복사에 필요, **보내기는 로그인만으로 가능**) |
| 공유 카드 안 뜸 | 아내 **로그인 Gmail** = 보낼 때 입력한 주소와 동일(소문자) |
| 푸시 안 옴 | VAPID 3개 · PWA 설치 · 알림 허용 · **공유 알림 켜기** 버튼 |

진단 URL (브라우저): `https://bus.uxpwa.com/api/share-status`  
→ `shareTableReady: false` 이면 SQL 미실행, `hasServiceRole: false` 이면 수락 전에 SERVICE_ROLE 필요.