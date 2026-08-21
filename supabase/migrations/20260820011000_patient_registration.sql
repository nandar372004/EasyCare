begin;

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
    user_id,
    'patient',
    registration->>'fullName',
    registration->>'phone',
    nullif(registration->>'email', ''),
    (registration->>'dateOfBirth')::date,
    registration->>'gender',
    coalesce(nullif(registration->>'preferredLanguage', ''), 'en'),
    'active'
  );

  insert into public.patients (
    profile_id, primary_phone, city,
    emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
    blood_type, care_preferences
  ) values (
    user_id,
    registration->>'phone',
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
    (patient_id, user_id, 'care', 'registration-v1', 'granted'),
    (patient_id, user_id, 'data_processing', 'registration-v1', 'granted');

  return patient_id;
end;
$$;

revoke all on function public.create_patient_registration(jsonb) from public;
grant execute on function public.create_patient_registration(jsonb) to service_role;

commit;
