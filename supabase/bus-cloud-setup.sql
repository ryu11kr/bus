-- 내버스시간표 스텝 4 — Supabase SQL Editor 에서 한 번 실행
-- (Storage bucket + 테이블 + 로그인한 본인만 접근)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bus-photos',
  'bus-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create table if not exists public.bus_user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stops jsonb not null default '[]'::jsonb,
  schema_version smallint not null default 2,
  updated_at timestamptz not null default now()
);

alter table public.bus_user_data enable row level security;

drop policy if exists "bus_user_data_select_own" on public.bus_user_data;
create policy "bus_user_data_select_own"
  on public.bus_user_data for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "bus_user_data_insert_own" on public.bus_user_data;
create policy "bus_user_data_insert_own"
  on public.bus_user_data for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "bus_user_data_update_own" on public.bus_user_data;
create policy "bus_user_data_update_own"
  on public.bus_user_data for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "bus_photos_select_own" on storage.objects;
create policy "bus_photos_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'bus-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "bus_photos_insert_own" on storage.objects;
create policy "bus_photos_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'bus-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "bus_photos_update_own" on storage.objects;
create policy "bus_photos_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'bus-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "bus_photos_delete_own" on storage.objects;
create policy "bus_photos_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'bus-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );