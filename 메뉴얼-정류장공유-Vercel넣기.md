# 정류장 공유 — Supabase SQL · Vercel 환경 변수

공유는 **앱을 켜고 로그인**하면 팝업·목록에 요청이 뜹니다. (잠금 화면 푸시 없음)

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
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → **Project Settings** → **API** → **service_role** (수락·사진 복사에 필요) |

---

## 3부: 다시 배포

**Deployments** → 최근 배포 **⋯** → **Redeploy**

---

## 4부: 테스트 순서

1. 두 개 Google 계정
2. 보내는 사람: 정류장 등록 → 로그인 → **정류장 공유**에 받을 사람 Gmail → 보내기
3. 받는 사람: 앱 켜기 → 로그인 → **팝업** 또는 목록에서 **수락**

---

## 문제 해결

| 증상 | 확인 |
|------|------|
| 공유 보내기 실패 | `bus-share-setup.sql` 실행 · 정류장 등록 후 보내기 |
| 수락만 안 됨 | `SUPABASE_SERVICE_ROLE_KEY` |
| 요청이 안 뜸 | 받는 사람 **로그인 Gmail** = 보낼 때 입력한 주소 · Supabase에서 **`bus-share-gmail-rls-patch.sql` Run** (한 번) |

진단: `https://bus.uxpwa.com/api/sync-status` (또는 `/api/share-status`)  
→ `shareTableReady: false` 이면 SQL 미실행, `hasServiceRole: false` 이면 SERVICE_ROLE 필요.