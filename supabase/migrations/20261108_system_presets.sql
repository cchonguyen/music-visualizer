-- Migration: Create public.system_presets table and RLS policies
-- Context: Stage 11 Administrator System Preset Management (Sector 487)

create table if not exists public.system_presets (
  id text primary key,
  name text not null,
  subfolder text not null default 'classics', -- 'showcase' | 'flagship' | 'classics'
  preset_data jsonb not null,
  sort_order integer not null default 0,
  tags text[] not null default '{}',
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Index for fast ordered listing
create index if not exists idx_system_presets_order on public.system_presets(sort_order, updated_at desc);

-- Row Level Security (RLS)
alter table public.system_presets enable row level security;

-- 1. Anonymous and authenticated public read access (non-deleted presets only)
create policy "Public read system presets"
  on public.system_presets
  for select
  to anon, authenticated
  using (not is_deleted);

-- 2. Authenticated Admin insert
create policy "Admin insert system presets"
  on public.system_presets
  for insert
  to authenticated
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' or
    auth.role() = 'service_role'
  );

-- 3. Authenticated Admin update
create policy "Admin update system presets"
  on public.system_presets
  for update
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' or
    auth.role() = 'service_role'
  );

-- 4. Authenticated Admin delete
create policy "Admin delete system presets"
  on public.system_presets
  for delete
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' or
    auth.role() = 'service_role'
  );
