# Supabase 연결 (스텝 2) → Vercel에 넣기

**지금 단계:** Supabase 준비만 합니다. **동기화·로그인은 아직 안 됩니다** (`cloud-sync.config.json` 의 `enabled` 가 `false`).

키는 **Supabase**에서 받고, **Vercel 환경 변수**에만 넣습니다. (GitHub에 넣지 마세요.)

---

## 1부: Supabase 프로젝트 만들기

1. **https://supabase.com** 가입·로그인
2. **New project** (새 프로젝트)
   - **Name:** 아무 이름 (예: `bus-timetable`)
   - **Database password:** 복잡한 비번 적어 두기 (지금 단계에서는 DB 직접 안 써도 됨)
   - **Region:** **Northeast Asia (Seoul)** 또는 가까운 지역
3. 프로젝트가 **초록불(Active)** 될 때까지 1~2분 대기

---

## 2부: URL·키 복사

1. Supabase 왼쪽 **Project Settings** (톱니바퀴)
2. **API** 메뉴
3. 아래 두 가지를 복사해 메모장에 잠깐 둡니다.

| Supabase 화면 이름 | Vercel에 넣을 이름 | 비고 |
|-------------------|-------------------|------|
| **Project URL** | `SUPABASE_URL` | `https://xxxx.supabase.co` |
| **anon public** 키 | `SUPABASE_ANON_KEY` | `eyJ...` 로 시작하는 긴 문자열 |

`service_role` 키는 **Vercel에 넣지 마세요.** (서버 전용·위험)

---

## 3부: Vercel에 넣기

1. **https://vercel.com** → **bus** 프로젝트 (bus.uxpwa.com 연결된 것)
2. **Settings** → **Environment Variables**
3. **두 줄** 추가:

| Name | Value |
|------|--------|
| `SUPABASE_URL` | Project URL 전체 |
| `SUPABASE_ANON_KEY` | anon public 키 전체 |

**Environments:** Production, Preview, Development **모두 체크** → **Save**

---

## 4부: 다시 배포

1. **Deployments** → 최근 배포 **⋯** → **Redeploy**  
   또는 GitHub에 푸시 (자동 배포)

환경 변수는 **새 배포**에만 반영됩니다.

---

## 5부: 잘 붙었는지 확인

1. 브라우저에서 열기:  
   **https://bus.uxpwa.com/api/sync-status**
2. JSON이 이렇게 보이면 성공입니다.

```json
{ "configured": true, "hasUrl": true, "hasAnonKey": true }
```

`configured: false` 이면 변수 이름 오타·Redeploy 안 함·값이 비어 있음 등을 확인하세요.

3. (선택) **https://bus.uxpwa.com/cloud-sync.runtime.json**  
   - `configured: true` 이고 `supabaseUrl` 이 보이면 빌드 주입 OK  
   - `supabaseAnonKey` 는 앱에서 쓰는 **공개(anon) 키**라 브라우저에 있어도 됩니다. GitHub에는 올라가지 않습니다.

---

## 자주 하는 실수

- 이름을 `SUPABASE_URL` / `SUPABASE_ANON_KEY` 가 **아닌 다른 이름**으로 넣음
- **service_role** 키를 넣음
- 저장 후 **Redeploy 안 함**
- 스텝 2만으로는 **앱에 로그인 버튼이 안 나오는 것이 정상**

---

## 다음 (스텝 3)

Google 로그인 + Supabase Auth 연동 (그때까지 사용자는 지금과 같이 **기기 안만 저장**).