-- Migration: Harden system_presets (Stage 14, Slice 14.1)
-- 1. Write policies accept only the server-set app_metadata admin role (or service_role).
--    user_metadata is editable by the signed-in user, so it must never grant admin.
-- 2. Hide updated_by (owner email) from the public roles with column-level SELECT grants.
--    Chosen over a view: the table, its RLS read policy and the client URL stay the same.
-- Not applied automatically. Apply only with the owner's explicit approval.

drop policy if exists "Admin insert system presets" on public.system_presets;
drop policy if exists "Admin update system presets" on public.system_presets;
drop policy if exists "Admin delete system presets" on public.system_presets;

create policy "Admin insert system presets"
  on public.system_presets
  for insert
  to authenticated
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or
    auth.role() = 'service_role'
  );

create policy "Admin update system presets"
  on public.system_presets
  for update
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or
    auth.role() = 'service_role'
  )
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or
    auth.role() = 'service_role'
  );

create policy "Admin delete system presets"
  on public.system_presets
  for delete
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or
    auth.role() = 'service_role'
  );

-- A table-level SELECT grant overrides column grants, so revoke it first, then grant every column except updated_by.
revoke select on public.system_presets from anon, authenticated;
grant select (id, name, subfolder, preset_data, sort_order, tags, is_deleted, created_at, updated_at)
  on public.system_presets to anon, authenticated;
