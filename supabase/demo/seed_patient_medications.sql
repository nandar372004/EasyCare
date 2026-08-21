-- SYNTHETIC DEMONSTRATION DATA ONLY. Not medical advice or a prescription.
-- Replace the placeholder below with the demo patient's normalized login phone
-- (for example +959123456789), then run this file in Supabase SQL Editor.
do $$
declare
  demo_patient_phone text := '<REPLACE_WITH_NORMALIZED_PATIENT_PHONE>';
  demo_patient_id uuid;
  medication_id uuid;
begin
  if demo_patient_phone like '<REPLACE_%' then
    raise exception 'Replace demo_patient_phone before running this demo seed';
  end if;

  select id into demo_patient_id
  from public.patients
  where primary_phone = demo_patient_phone
    and status = 'active';

  if demo_patient_id is null then
    raise exception 'No active patient found for the supplied phone';
  end if;

  insert into public.patient_medications (
    patient_id, medication_name, dose, frequency, instructions,
    start_date, end_date, status, created_by_profile_id
  )
  select demo_patient_id, 'Demo Paracetamol', '500 mg', 'Twice daily',
    'Synthetic record: take after meals', current_date, null, 'active', null
  where not exists (
    select 1 from public.patient_medications
    where patient_id = demo_patient_id and medication_name = 'Demo Paracetamol'
  );

  insert into public.patient_medications (
    patient_id, medication_name, dose, frequency, instructions,
    start_date, end_date, status, created_by_profile_id
  )
  select demo_patient_id, 'Demo Cetirizine', '10 mg', 'Once daily',
    'Synthetic record: take in the evening', current_date, null, 'active', null
  where not exists (
    select 1 from public.patient_medications
    where patient_id = demo_patient_id and medication_name = 'Demo Cetirizine'
  );

  insert into public.patient_medications (
    patient_id, medication_name, dose, frequency, instructions,
    start_date, end_date, status, created_by_profile_id
  )
  select demo_patient_id, 'Demo Vitamin B Complex', '1 tablet', 'Once daily',
    'Synthetic record: take after breakfast', current_date - 30, current_date - 1, 'completed', null
  where not exists (
    select 1 from public.patient_medications
    where patient_id = demo_patient_id and medication_name = 'Demo Vitamin B Complex'
  );

  for medication_id in
    select id from public.patient_medications
    where patient_id = demo_patient_id
      and medication_name in ('Demo Paracetamol', 'Demo Cetirizine')
  loop
    insert into public.medication_schedules (
      patient_medication_id, time_of_day, days_of_week, timezone,
      reminder_enabled, valid_from, valid_until
    )
    select medication_id,
      case when exists (
        select 1 from public.patient_medications
        where id = medication_id and medication_name = 'Demo Cetirizine'
      ) then time '19:00' else time '08:00' end,
      array[0,1,2,3,4,5,6]::smallint[], 'Asia/Yangon', false, current_date, null
    where not exists (
      select 1 from public.medication_schedules
      where patient_medication_id = medication_id
    );
  end loop;
end
$$;
