-- 정류장 공유 (bus-share) — SQL Editor에서 bus-cloud-setup.sql 다음에 실행

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

drop policy if exists "bus_share_update_sender_cancel" on public.bus_share_requests;
create policy "bus_share_update_sender_cancel"
  on public.bus_share_requests for update
  to authenticated
  using (from_user_id = auth.uid() and status = 'pending')
  with check (status = 'cancelled');

-- 실시간 공유 알림(선택): SQL Editor에서 한 번 더 Run
-- alter publication supabase_realtime add table public.bus_share_requests;
