begin;

alter table public.patients
  add column auth_user_id uuid references auth.users(id) on delete restrict,
  add column full_name text,
  add column email text,
  add column date_of_birth date,
  add column gender text,
  add column preferred_language text not null default 'en',
  add column status text not null default 'active';

update public.patients patient
set
  auth_user_id = profile.id,
  full_name = profile.full_name,
  email = profile.email,
  date_of_birth = profile.date_of_birth,
  gender = profile.gender,
  preferred_language = profile.preferred_language,
  status = profile.status::text
from public.profiles profile
where profile.id = patient.profile_id;

do $$
begin
  if exists (select 1 from public.patients where auth_user_id is null) then
    raise exception 'Cannot simplify patient authentication: a patient has no Auth-backed profile';
  end if;
end
$$;

alter table public.patients
  alter column auth_user_id set not null,
  alter column full_name set not null,
  add constraint patients_full_name_check check (length(btrim(full_name)) between 1 and 160),
  add constraint patients_date_of_birth_check check (date_of_birth is null or date_of_birth < current_date),
  add constraint patients_preferred_language_check check (preferred_language in ('en', 'my')),
  add constraint patients_status_check check (status in ('active', 'suspended', 'inactive'));

create unique index patients_auth_user_uidx on public.patients(auth_user_id);
create unique index patients_primary_phone_uidx on public.patients(primary_phone) where primary_phone is not null;

create function public.protect_patient_auth_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_main_admin() and (
    new.auth_user_id is distinct from old.auth_user_id
    or new.primary_phone is distinct from old.primary_phone
    or new.status is distinct from old.status
  ) then
    raise exception 'Patient authentication fields cannot be changed';
  end if;
  return new;
end
$$;

create trigger patients_protect_auth_fields
before update on public.patients
for each row execute function public.protect_patient_auth_fields();

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

  insert into public.patients (
    auth_user_id, full_name, primary_phone, email, date_of_birth, gender,
    preferred_language, status, city,
    emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
    blood_type, care_preferences
  ) values (
    user_id,
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
    (patient_id, null, 'care', 'registration-v2', 'granted'),
    (patient_id, null, 'data_processing', 'registration-v2', 'granted');

  return patient_id;
end;
$$;

revoke all on function public.create_patient_registration(jsonb) from public;
grant execute on function public.create_patient_registration(jsonb) to service_role;

create or replace function public.can_access_patient(target_patient_id uuid, permission_name text default 'view')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.patients patient
      where patient.id = target_patient_id and patient.auth_user_id = auth.uid()
    )
    or public.is_main_admin()
    or exists (
      select 1 from public.family_authorizations fa
      where fa.patient_id = target_patient_id
        and fa.family_profile_id = auth.uid()
        and fa.status = 'active'
        and case permission_name
          when 'appointments' then fa.can_manage_appointments
          when 'medications' then fa.can_manage_medications
          when 'payments' then fa.can_make_payments
          when 'alerts' then fa.can_receive_alerts
          else fa.can_view_records
        end
    )
    or exists (
      select 1 from public.providers provider
      where provider.profile_id = auth.uid() and provider.verification_status = 'verified'
        and (
          exists (select 1 from public.appointments appointment where appointment.patient_id = target_patient_id and appointment.provider_id = provider.id)
          or exists (
            select 1 from public.care_assignments assignment
            join public.care_requests request on request.id = assignment.care_request_id
            where request.patient_id = target_patient_id
              and assignment.provider_id = provider.id
              and assignment.status in ('assigned', 'accepted')
          )
        )
    )
    or (permission_name in ('view', 'appointments', 'alerts') and exists (
      select 1 from public.care_coordinators coordinator
      where coordinator.profile_id = auth.uid()
        and (
          exists (select 1 from public.patients patient where patient.id = target_patient_id and patient.primary_coordinator_id = coordinator.id)
          or exists (select 1 from public.care_requests request where request.patient_id = target_patient_id and request.coordinator_id = coordinator.id)
        )
    ))
    or (permission_name in ('appointments', 'alerts') and exists (
      select 1
      from public.clinic_staff admin_staff
      join public.clinic_staff provider_staff
        on provider_staff.clinic_id = admin_staff.clinic_id and provider_staff.status = 'active'
      join public.appointments appointment on appointment.provider_id = provider_staff.provider_id
      where admin_staff.profile_id = auth.uid()
        and admin_staff.clinic_role = 'sub_admin'
        and admin_staff.status = 'active'
        and appointment.patient_id = target_patient_id
    ))
$$;

drop policy if exists patients_read_authorized on public.patients;
drop policy if exists patients_update_owner on public.patients;
create policy patients_read_own on public.patients
  for select to authenticated
  using (auth_user_id = auth.uid() or public.is_main_admin());
create policy patients_update_own on public.patients
  for update to authenticated
  using (auth_user_id = auth.uid() or public.is_main_admin())
  with check (auth_user_id = auth.uid() or public.is_main_admin());

alter table public.appointments alter column booked_by_profile_id drop not null;
drop policy if exists appointments_create on public.appointments;
create policy appointments_create_patient on public.appointments
  for insert to authenticated
  with check (
    status = 'pending'
    and cancelled_at is null
    and exists (
      select 1 from public.patients patient
      where patient.id = appointments.patient_id and patient.auth_user_id = auth.uid()
    )
  );

commit;
