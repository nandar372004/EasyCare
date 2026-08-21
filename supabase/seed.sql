-- Synthetic presentation seed only.
-- Refuses to run unless both session settings are explicitly supplied:
--   app.environment = local | test | demo
--   app.allow_synthetic_seed = on
--
-- This script does not create auth.users or store passwords. Create the two
-- synthetic identities through the local Supabase Auth Admin API first, using
-- the UUIDs below, then run this script as a database owner.

begin;

do $$
declare
  environment_name text := current_setting('app.environment', true);
  seed_allowed text := current_setting('app.allow_synthetic_seed', true);
begin
  if environment_name is null or environment_name not in ('local', 'test', 'demo') then
    raise exception 'Synthetic seed refused: app.environment must be local, test, or demo';
  end if;

  if seed_allowed is distinct from 'on' then
    raise exception 'Synthetic seed refused: app.allow_synthetic_seed must be on';
  end if;

  if not exists (
    select 1 from auth.users
    where id = '10000000-0000-4000-8000-000000000001'::uuid
  ) or not exists (
    select 1 from auth.users
    where id = '20000000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception 'Synthetic Auth identities are missing; create them through local Supabase Auth first';
  end if;
end
$$;

insert into public.profiles (
  id, role, display_name, phone, preferred_language, is_active
) values
  (
    '10000000-0000-4000-8000-000000000001',
    'patient',
    'Synthetic Patient',
    '09900000001',
    'en',
    true
  ),
  (
    '20000000-0000-4000-8000-000000000001',
    'provider',
    'Dr. Synthetic Provider',
    '09900000002',
    'en',
    true
  )
on conflict (id) do update set
  role = excluded.role,
  display_name = excluded.display_name,
  phone = excluded.phone,
  preferred_language = excluded.preferred_language,
  is_active = excluded.is_active;

insert into public.patients (
  id,
  profile_id,
  member_code,
  date_of_birth,
  gender,
  address_city,
  emergency_contact,
  medical_profile
) values (
  '11000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'MBP-SYNTH001',
  date '1995-04-12',
  'Prefer not to say',
  'Synthetic Yangon',
  '{"name":"Synthetic Emergency Contact","relationship":"Sibling","phone_number":"09900000003"}'::jsonb,
  '{"blood_type":"Unknown","allergies":"","no_known_allergies":true,"existing_medical_conditions":"","current_medications":""}'::jsonb
)
on conflict (id) do update set
  address_city = excluded.address_city,
  emergency_contact = excluded.emergency_contact,
  medical_profile = excluded.medical_profile;

insert into public.providers (
  id,
  profile_id,
  specialty,
  qualification,
  license_number,
  verification_status,
  consultation_fee_mmk,
  languages,
  timezone,
  default_slot_minutes,
  is_public
) values (
  '21000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'General Medicine',
  'Synthetic demonstration qualification',
  'SYNTHETIC-LICENSE-001',
  'verified',
  25000,
  array['my', 'en'],
  'Asia/Yangon',
  30,
  true
)
on conflict (id) do update set
  verification_status = excluded.verification_status,
  consultation_fee_mmk = excluded.consultation_fee_mmk,
  languages = excluded.languages,
  is_public = excluded.is_public;

insert into public.availability_slots (
  id,
  provider_id,
  slot_date,
  starts_at,
  ends_at,
  consultation_type,
  status
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    current_date + 7,
    ((current_date + 7)::timestamp + time '09:00') at time zone 'Asia/Yangon',
    ((current_date + 7)::timestamp + time '09:30') at time zone 'Asia/Yangon',
    'video',
    'available'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000001',
    current_date + 7,
    ((current_date + 7)::timestamp + time '10:00') at time zone 'Asia/Yangon',
    ((current_date + 7)::timestamp + time '10:30') at time zone 'Asia/Yangon',
    'video',
    'available'
  )
on conflict (id) do update set
  slot_date = excluded.slot_date,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  status = 'available';

insert into public.appointments (
  id,
  booking_code,
  idempotency_key,
  patient_id,
  provider_id,
  availability_slot_id,
  consultation_type,
  status,
  symptoms,
  simulated_payment_method,
  fee_mmk
) values (
  '40000000-0000-4000-8000-000000000001',
  'MBA-SYNTH001',
  '41000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'video',
  'confirmed',
  null,
  'presentation_card',
  25000
)
on conflict (id) do update set
  status = excluded.status,
  availability_slot_id = excluded.availability_slot_id,
  provider_id = excluded.provider_id,
  consultation_type = excluded.consultation_type,
  fee_mmk = excluded.fee_mmk;

commit;
