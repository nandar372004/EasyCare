begin;

-- Phase 1 only. Never infer identity from phone/email or reassign an existing
-- relationship. A failed preflight rolls back the entire migration.
set local lock_timeout = '10s';
lock table public.profiles, public.patients in share row exclusive mode;

do $$
begin
  if exists (
    select 1 from public.patients p
    left join auth.users u on u.id = p.auth_user_id
    where u.id is null
      or (p.profile_id is not null and p.profile_id <> p.auth_user_id)
  ) then
    raise exception 'Identity repair stopped: missing Auth user or conflicting patient/profile identity. Run patient_profile_identity_validation.sql.';
  end if;

  -- Existing profiles are reused without changing their role or demographics.
  -- For missing profiles, reject contact collisions instead of discarding data.
  if exists (
    select 1 from public.patients p
    where not exists (select 1 from public.profiles own where own.id = p.auth_user_id)
      and exists (
        select 1 from public.profiles other
        where (p.primary_phone is not null and other.phone = p.primary_phone)
           or (p.email is not null and lower(other.email) = lower(p.email))
      )
  ) or exists (
    select lower(p.email) from public.patients p
    where p.email is not null
      and not exists (select 1 from public.profiles own where own.id = p.auth_user_id)
    group by lower(p.email) having count(*) > 1
  ) then
    raise exception 'Identity repair stopped: profile contact uniqueness conflict. Run patient_profile_identity_validation.sql.';
  end if;
end
$$;

insert into public.profiles (
  id, role, full_name, phone, email, date_of_birth, gender,
  preferred_language, status, created_at, updated_at
)
select p.auth_user_id, 'patient', p.full_name, p.primary_phone, p.email,
  p.date_of_birth, p.gender, p.preferred_language, p.status::public.profile_status,
  p.created_at, p.updated_at
from public.patients p
where not exists (select 1 from public.profiles existing where existing.id = p.auth_user_id);

update public.patients
set profile_id = auth_user_id
where profile_id is null;

-- Validate the backfill before tightening nullability. The original patient
-- UUIDs, both existing FKs, and unique indexes are retained.
do $$
begin
  if exists (
    select 1 from public.patients p
    left join public.profiles profile on profile.id = p.profile_id
    where profile.id is null or p.profile_id is distinct from p.auth_user_id
  ) then
    raise exception 'Identity repair validation failed; all changes will roll back';
  end if;
end
$$;

alter table public.patients
  add constraint patients_profile_auth_identity_check
  check (profile_id = auth_user_id) not valid;
alter table public.patients validate constraint patients_profile_auth_identity_check;
alter table public.patients alter column profile_id set not null;

create or replace function public.protect_patient_auth_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_main_admin() and (
    new.auth_user_id is distinct from old.auth_user_id
    or new.profile_id is distinct from old.profile_id
    or new.primary_phone is distinct from old.primary_phone
    or new.status is distinct from old.status
  ) then
    raise exception 'Patient authentication fields cannot be changed';
  end if;
  return new;
end
$$;

-- Keep the Edge Function's existing RPC signature and patient UUID result.
-- Profile, patient, and consent inserts are one transaction; a failed insert
-- does not leave a new profile behind. Do not overwrite a pre-existing profile.
create or replace function public.create_patient_registration(registration jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  patient_id uuid;
  user_id uuid := (registration->>'userId')::uuid;
  medical_profile jsonb := registration->'medicalProfile';
begin
  if user_id is null or not exists (select 1 from auth.users where id = user_id) then
    raise exception 'Invalid managed Auth user';
  end if;

  insert into public.profiles (
    id, role, full_name, phone, email, date_of_birth, gender, preferred_language, status
  ) values (
    user_id, 'patient', registration->>'fullName', registration->>'phone',
    nullif(registration->>'email', ''), (registration->>'dateOfBirth')::date,
    registration->>'gender',
    coalesce(nullif(registration->>'preferredLanguage', ''), 'en'), 'active'
  );

  insert into public.patients (
    profile_id, auth_user_id, full_name, primary_phone, email, date_of_birth, gender,
    preferred_language, status, city,
    emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
    blood_type, care_preferences
  ) values (
    user_id, user_id,
    registration->>'fullName',
    registration->>'phone',
    nullif(registration->>'email', ''),
    (registration->>'dateOfBirth')::date,
    registration->>'gender',
    coalesce(nullif(registration->>'preferredLanguage', ''), 'en'),
    'active',
    registration->>'addressCity',
    registration->'emergencyContact'->>'name',
    registration->'emergencyContact'->>'relationship',
    registration->'emergencyContact'->>'phone_number',
    medical_profile->>'blood_type',
    jsonb_build_object(
      'noKnownAllergies', coalesce((medical_profile->>'no_known_allergies')::boolean, false),
      'allergies', coalesce(medical_profile->>'allergies', ''),
      'existingMedicalConditions', coalesce(medical_profile->>'existing_medical_conditions', ''),
      'currentMedications', coalesce(medical_profile->>'current_medications', '')
    )
  ) returning id into patient_id;

  insert into public.consents (patient_id, granted_by_profile_id, consent_type, version, status)
  values
    (patient_id, user_id, 'care', 'registration-v2', 'granted'),
    (patient_id, user_id, 'data_processing', 'registration-v2', 'granted');

  return patient_id;
end;
$$;

revoke all on function public.create_patient_registration(jsonb) from public, anon, authenticated;
grant execute on function public.create_patient_registration(jsonb) to service_role;

-- Change only patient ownership policies. Existing appointment/medication
-- policies and login queries can keep using auth_user_id: the validated
-- equality constraint makes it the same identity as profile_id.
alter policy patients_read_own on public.patients
  using (profile_id = auth.uid());
alter policy patients_update_own on public.patients
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Needed by existing family/consent policies that inspect patient.profile_id.
-- No new identity UPDATE privilege is granted.
grant select (profile_id) on table public.patients to authenticated;
grant select (id, role, status) on table public.profiles to authenticated;

-- providers.profile_id already references profiles.id. Nullable catalog
-- providers have no Auth identity to backfill and remain unchanged.
commit;
