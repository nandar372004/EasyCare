begin;

-- The patient portal reads only these fields while hydrating its session.
-- Row visibility remains constrained by the RLS policy below.
grant select (
  id,
  auth_user_id,
  full_name,
  primary_phone,
  preferred_language,
  status
) on table public.patients to authenticated;

drop policy if exists patients_read_authorized on public.patients;
drop policy if exists patients_read_own on public.patients;
create policy patients_read_own on public.patients
  for select to authenticated
  using (auth_user_id = auth.uid());

commit;
