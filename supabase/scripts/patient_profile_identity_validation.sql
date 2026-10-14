-- Read-only Phase 1 validation. Run as database owner before and after applying
-- 20260928090000_patient_profile_identity_repair.sql. No personal values output.
begin read only;

select
  count(*) as patient_count,
  count(*) filter (where p.profile_id is null) as missing_profile_links,
  count(*) filter (where profile.id is null) as missing_profiles,
  count(*) filter (where u.id is null) as missing_auth_users,
  count(*) filter (where p.profile_id is not null and p.profile_id <> p.auth_user_id) as conflicting_links
from public.patients p
left join public.profiles profile on profile.id = p.auth_user_id
left join auth.users u on u.id = p.auth_user_id;

-- Any rows here require review BEFORE migration. Never relink by contact data.
select p.id as patient_id, p.auth_user_id, p.profile_id,
  'identity_conflict' as issue
from public.patients p
left join auth.users u on u.id = p.auth_user_id
where u.id is null or (p.profile_id is not null and p.profile_id <> p.auth_user_id);

select p.id as patient_id, 'profile_contact_collision' as issue
from public.patients p
where not exists (select 1 from public.profiles own where own.id = p.auth_user_id)
  and exists (
    select 1 from public.profiles other
    where (p.primary_phone is not null and other.phone = p.primary_phone)
       or (p.email is not null and lower(other.email) = lower(p.email))
  );

select p.id as patient_id, 'duplicate_patient_email_for_backfill' as issue
from public.patients p
where p.email is not null
  and not exists (select 1 from public.profiles own where own.id = p.auth_user_id)
  and exists (
    select 1 from public.patients other
    where other.id <> p.id and lower(other.email) = lower(p.email)
      and not exists (select 1 from public.profiles own where own.id = other.auth_user_id)
  );

-- Existing roles are preserved, not automatically converted to patient.
select p.id as patient_id, profile.role as existing_role
from public.patients p join public.profiles profile on profile.id = p.auth_user_id
where profile.role <> 'patient';

select count(*) as provider_count,
  count(*) filter (where p.profile_id is null) as catalog_providers_without_identity,
  count(*) filter (where p.profile_id is not null and profile.id is null) as broken_provider_links
from public.providers p left join public.profiles profile on profile.id = p.profile_id;

select conname, convalidated
from pg_constraint
where conrelid = 'public.patients'::regclass
  and conname = 'patients_profile_auth_identity_check';

select policyname, cmd, qual, with_check
from pg_policies where schemaname = 'public'
  and tablename in ('patients', 'profiles') order by tablename, policyname;

select has_function_privilege('authenticated', 'public.create_patient_registration(jsonb)', 'EXECUTE') as browser_can_register_directly,
  has_function_privilege('anon', 'public.create_patient_registration(jsonb)', 'EXECUTE') as anonymous_can_register_directly,
  has_function_privilege('service_role', 'public.create_patient_registration(jsonb)', 'EXECUTE') as service_can_register;

commit;
