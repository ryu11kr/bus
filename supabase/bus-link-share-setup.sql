-- 카톡 등 공개 링크 (#/l/토큰) — bus-share-setup 다음 SQL Editor에서 실행
-- 서비스 롤(Vercel)만 읽기·쓰기, anon 직접 접근 없음

create table if not exists public.bus_link_shares (
  token uuid primary key default gen_random_uuid(),
  stop_name text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists bus_link_shares_expires_idx
  on public.bus_link_shares (expires_at);

alter table public.bus_link_shares enable row level security;