begin;

-- Doctors are browsable provider records, not authenticated portal users.
alter table public.providers
  alter column profile_id drop not null,
  add column display_name text,
  add column qualification text,
  add column consultation_fee_mmk integer;

alter table public.providers
  add constraint providers_display_name_check
    check (display_name is null or length(btrim(display_name)) between 1 and 160),
  add constraint providers_consultation_fee_mmk_check
    check (consultation_fee_mmk is null or consultation_fee_mmk >= 0);

insert into public.specialties (name) values
  ('General Practitioner'),
  ('Internal Medicine'),
  ('Pediatrics'),
  ('Cardiology'),
  ('Dermatology'),
  ('Obstetrics & Gynecology')
on conflict (name) do nothing;

insert into public.providers (
  id, profile_id, provider_type, display_name, qualification, license_number,
  verification_status, years_experience, bio, languages, service_area,
  home_visit_enabled, teleconsult_enabled, consultation_fee_mmk,
  rating_average, verified_at
) values
  ('52000000-0000-4000-8000-000000000001', null, 'doctor', 'Dr. Thiri Aung', 'Synthetic MBBS, demonstration family medicine training', 'SYN-ECP-GP-001', 'verified', 9, 'Synthetic demonstration doctor focused on accessible primary care.', array['my','en'], '{"hospital":"EasyCare Demonstration Clinic","city":"Yangon"}', true, true, 25000, 4.80, statement_timestamp()),
  ('52000000-0000-4000-8000-000000000002', null, 'doctor', 'Dr. Min Khant Zaw', 'Synthetic MBBS, demonstration internal medicine training', 'SYN-ECP-IM-002', 'verified', 12, 'Synthetic demonstration doctor for adult medical consultations.', array['my','en'], '{"hospital":"Shwe Pyi Demonstration Hospital","city":"Yangon"}', false, true, 32000, 4.70, statement_timestamp()),
  ('52000000-0000-4000-8000-000000000003', null, 'doctor', 'Dr. Su Myat Noe', 'Synthetic MBBS, demonstration pediatric training', 'SYN-ECP-PD-003', 'verified', 10, 'Synthetic demonstration doctor for child and adolescent care.', array['my','en'], '{"hospital":"Mingalar Demonstration Children Clinic","city":"Mandalay"}', true, true, 30000, 4.90, statement_timestamp()),
  ('52000000-0000-4000-8000-000000000004', null, 'doctor', 'Dr. Htet Naing Lin', 'Synthetic MBBS, demonstration cardiology training', 'SYN-ECP-CD-004', 'verified', 15, 'Synthetic demonstration doctor for heart-health consultations.', array['my','en'], '{"hospital":"Ayeyar Demonstration Medical Centre","city":"Yangon"}', false, true, 45000, 4.80, statement_timestamp()),
  ('52000000-0000-4000-8000-000000000005', null, 'doctor', 'Dr. Ei Mon Hlaing', 'Synthetic MBBS, demonstration dermatology training', 'SYN-ECP-DM-005', 'verified', 8, 'Synthetic demonstration doctor for common skin-care concerns.', array['my','en'], '{"hospital":"Inya Demonstration Specialist Clinic","city":"Yangon"}', false, true, 35000, 4.70, statement_timestamp()),
  ('52000000-0000-4000-8000-000000000006', null, 'doctor', 'Dr. May Thu Khin', 'Synthetic MBBS, demonstration obstetrics and gynecology training', 'SYN-ECP-OG-006', 'verified', 13, 'Synthetic demonstration doctor for women’s health consultations.', array['my','en'], '{"hospital":"Thazin Demonstration Women’s Clinic","city":"Nay Pyi Taw"}', true, true, 40000, 4.90, statement_timestamp())
on conflict (id) do update set
  provider_type = excluded.provider_type,
  display_name = excluded.display_name,
  qualification = excluded.qualification,
  verification_status = excluded.verification_status,
  years_experience = excluded.years_experience,
  bio = excluded.bio,
  languages = excluded.languages,
  service_area = excluded.service_area,
  home_visit_enabled = excluded.home_visit_enabled,
  teleconsult_enabled = excluded.teleconsult_enabled,
  consultation_fee_mmk = excluded.consultation_fee_mmk,
  rating_average = excluded.rating_average;

insert into public.provider_specialties (provider_id, specialty_id, is_primary)
select mapping.provider_id::uuid, specialty.id, true
from (values
  ('52000000-0000-4000-8000-000000000001', 'General Practitioner'),
  ('52000000-0000-4000-8000-000000000002', 'Internal Medicine'),
  ('52000000-0000-4000-8000-000000000003', 'Pediatrics'),
  ('52000000-0000-4000-8000-000000000004', 'Cardiology'),
  ('52000000-0000-4000-8000-000000000005', 'Dermatology'),
  ('52000000-0000-4000-8000-000000000006', 'Obstetrics & Gynecology')
) as mapping(provider_id, specialty_name)
join public.specialties specialty on specialty.name = mapping.specialty_name
on conflict (provider_id, specialty_id) do update set is_primary = excluded.is_primary;

insert into public.provider_availability (
  id, provider_id, clinic_id, service_type, start_at, end_at, status
) values
  ('53000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', null, 'teleconsultation', (current_date + 2 + time '09:00') at time zone 'Asia/Yangon', (current_date + 2 + time '09:30') at time zone 'Asia/Yangon', 'available'),
  ('53000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000001', null, 'home_visit', (current_date + 3 + time '13:00') at time zone 'Asia/Yangon', (current_date + 3 + time '14:00') at time zone 'Asia/Yangon', 'available'),
  ('53000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000002', null, 'teleconsultation', (current_date + 2 + time '10:00') at time zone 'Asia/Yangon', (current_date + 2 + time '10:30') at time zone 'Asia/Yangon', 'available'),
  ('53000000-0000-4000-8000-000000000004', '52000000-0000-4000-8000-000000000003', null, 'teleconsultation', (current_date + 3 + time '11:00') at time zone 'Asia/Yangon', (current_date + 3 + time '11:30') at time zone 'Asia/Yangon', 'available'),
  ('53000000-0000-4000-8000-000000000005', '52000000-0000-4000-8000-000000000003', null, 'home_visit', (current_date + 4 + time '14:00') at time zone 'Asia/Yangon', (current_date + 4 + time '15:00') at time zone 'Asia/Yangon', 'available'),
  ('53000000-0000-4000-8000-000000000006', '52000000-0000-4000-8000-000000000004', null, 'teleconsultation', (current_date + 4 + time '09:30') at time zone 'Asia/Yangon', (current_date + 4 + time '10:00') at time zone 'Asia/Yangon', 'available'),
  ('53000000-0000-4000-8000-000000000007', '52000000-0000-4000-8000-000000000005', null, 'teleconsultation', (current_date + 5 + time '15:00') at time zone 'Asia/Yangon', (current_date + 5 + time '15:30') at time zone 'Asia/Yangon', 'available'),
  ('53000000-0000-4000-8000-000000000008', '52000000-0000-4000-8000-000000000006', null, 'teleconsultation', (current_date + 6 + time '10:30') at time zone 'Asia/Yangon', (current_date + 6 + time '11:00') at time zone 'Asia/Yangon', 'available'),
  ('53000000-0000-4000-8000-000000000009', '52000000-0000-4000-8000-000000000006', null, 'home_visit', (current_date + 7 + time '13:30') at time zone 'Asia/Yangon', (current_date + 7 + time '14:30') at time zone 'Asia/Yangon', 'available')
on conflict (id) do update set
  provider_id = excluded.provider_id,
  service_type = excluded.service_type,
  start_at = excluded.start_at,
  end_at = excluded.end_at,
  status = 'available';

-- Replace the broad provider policy with a patient-facing verified-doctor directory.
drop policy if exists providers_directory_read on public.providers;
create policy providers_directory_read on public.providers
  for select to authenticated
  using (provider_type = 'doctor' and verification_status = 'verified');

drop policy if exists availability_read on public.provider_availability;
create policy availability_read on public.provider_availability
  for select to authenticated
  using (status = 'available');

grant select (
  id, provider_type, display_name, qualification, verification_status,
  years_experience, bio, languages, service_area, home_visit_enabled,
  teleconsult_enabled, consultation_fee_mmk, rating_average
) on table public.providers to authenticated;
grant select (provider_id, specialty_id, is_primary) on table public.provider_specialties to authenticated;
grant select (id, name) on table public.specialties to authenticated;
grant select (id, provider_id, service_type, start_at, end_at, status)
  on table public.provider_availability to authenticated;

commit;
