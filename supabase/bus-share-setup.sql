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

create or replace function public.bus_canonical_gmail(addr text)
returns text
language sql
immutable
as $$
  select case
    when addr is null or strpos(lower(trim(addr)), '@') < 1 then lower(trim(coalesce(addr, '')))
    when replace(split_part(lower(trim(addr)), '@', 2), 'googlemail.com', 'gmail.com') = 'gmail.com' then
      split_part(
        regexp_replace(split_part(lower(trim(addr)), '@', 1), '\.', '', 'g'),
        '+',
        1
      ) || '@gmail.com'
    else lower(trim(addr))
  end;
$$;

drop policy if exists "bus_share_select_involved" on public.bus_share_requests;
create policy "bus_share_select_involved"
  on public.bus_share_requests for select
  to authenticated
  using (
    from_user_id = auth.uid()
    or public.bus_canonical_gmail(to_email) = public.bus_canonical_gmail(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "bus_share_insert_sender" on public.bus_share_requests;
create policy "bus_share_insert_sender"
  on public.bus_share_requests for insert
  to authenticated
  with check (
    from_user_id = auth.uid()
    and public.bus_canonical_gmail(to_email) <> public.bus_canonical_gmail(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "bus_share_update_recipient_reject" on public.bus_share_requests;
create policy "bus_share_update_recipient_reject"
  on public.bus_share_requests for update
  to authenticated
  using (
    public.bus_canonical_gmail(to_email) = public.bus_canonical_gmail(coalesce(auth.jwt() ->> 'email', ''))
    and status = 'pending'
  )
  with check (status = 'rejected');

drop policy if exists "bus_share_update_sender_cancel" on public.bus_share_requests;
create policy "bus_share_update_sender_cancel"
  on public.bus_share_requests for update
  to authenticated
  using (from_user_id = auth.uid() and status = 'pending')
  with check (status = 'cancelled');
