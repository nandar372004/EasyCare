-- Deletes only the fixed synthetic domain records created by supabase/seed.sql.
-- Managed auth.users identities are intentionally not deleted here.

begin;

do $$
declare
  environment_name text := current_setting('app.environment', true);
  reset_allowed text := current_setting('app.allow_synthetic_reset', true);
begin
  if environment_name is null or environment_name not in ('local', 'test', 'demo') then
    raise exception 'Synthetic reset refused: app.environment must be local, test, or demo';
  end if;

  if reset_allowed is distinct from 'on' then
    raise exception 'Synthetic reset refused: app.allow_synthetic_reset must be on';
  end if;
end
$$;

delete from public.appointments
where id = '40000000-0000-4000-8000-000000000001';

delete from public.availability_slots
where id in (
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002'
);

delete from public.patients
where id = '11000000-0000-4000-8000-000000000001';

delete from public.providers
where id = '21000000-0000-4000-8000-000000000001';

delete from public.profiles
where id in (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001'
);

commit;
