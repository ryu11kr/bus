-- 정류장 공유 + Android Web Push (bus-share) — SQL Editor에서 bus-cloud-setup.sql 다음에 실행

create table if not exists public.bus_share_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users (id) on delete cascade,
  from_email text not null,
  to_email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create index if not exists bus_share_requests_to_email_pending_idx
  on public.bus_share_requests (lower(to_email))
  where status = 'pending';

alter table public.bus_share_requests enable row level security;

drop policy if exists "bus_share_select_involved" on public.bus_share_requests;
create policy "bus_share_select_involved"
  on public.bus_share_requests for select
  to authenticated
  using (
    from_user_id = auth.uid()
    or lower(to_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "bus_share_insert_sender" on public.bus_share_requests;
create policy "bus_share_insert_sender"
  on public.bus_share_requests for insert
  to authenticated
  with check (
    from_user_id = auth.uid()
    and lower(to_email) <> lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "bus_share_update_recipient_reject" on public.bus_share_requests;
create policy "bus_share_update_recipient_reject"
  on public.bus_share_requests for update
  to authenticated
  using (
    lower(to_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and status = 'pending'
  )
  with check (status = 'rejected');

create table if not exists public.bus_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  user_email text not null,
  endpoint text not null,
  subscription jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists bus_push_subscriptions_email_idx
  on public.bus_push_subscriptions (lower(user_email));

alter table public.bus_push_subscriptions enable row level security;

drop policy if exists "bus_push_subscriptions_own" on public.bus_push_subscriptions;
create policy "bus_push_subscriptions_own"
  on public.bus_push_subscriptions for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());