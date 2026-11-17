-- Gmail 점(.)·+별칭 때문에 공유 요청이 안 보일 때 — SQL Editor에서 Run (한 번)

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

drop policy if exists "bus_share_update_recipient_reject" on public.bus_share_requests;
create policy "bus_share_update_recipient_reject"
  on public.bus_share_requests for update
  to authenticated
  using (
    public.bus_canonical_gmail(to_email) = public.bus_canonical_gmail(coalesce(auth.jwt() ->> 'email', ''))
    and status = 'pending'
  )
  with check (status = 'rejected');

drop policy if exists "bus_share_insert_sender" on public.bus_share_requests;
create policy "bus_share_insert_sender"
  on public.bus_share_requests for insert
  to authenticated
  with check (
    from_user_id = auth.uid()
    and public.bus_canonical_gmail(to_email) <> public.bus_canonical_gmail(coalesce(auth.jwt() ->> 'email', ''))
  );