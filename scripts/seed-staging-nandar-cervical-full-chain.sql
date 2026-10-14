-- Fail-closed, rerunnable Staging seed for Nandar Kyaw's cervical care chain.
-- Does not touch the known allergy appointment/encounter/prescription or the
-- older completed Paracetamol course. No schedules/events or schema/RLS/grant
-- changes. The 2026-10-08 date aligns with the existing Staging sample seed.

begin;
set local lock_timeout = '10s';

lock table public.patients, public.profiles, public.providers in share mode;
lock table public.appointments, public.care_encounters, public.prescriptions,
  public.prescription_items, public.patient_medications in share row exclusive mode;

do $seed$
declare
  target_patient constant uuid := '2d329d5b-9093-45ca-a980-97466d2a71eb';
  target_provider constant uuid := '52000000-0000-4000-8000-000000000003';
  excluded_allergy_encounter constant uuid := '1e86e70f-d79b-6d62-4fe0-b327a9f4331e';
  excluded_allergy_appointment uuid;
  seed_start constant timestamptz := timestamp '2026-10-08 10:00:00' at time zone 'Asia/Yangon';
  seed_end constant timestamptz := timestamp '2026-10-08 10:30:00' at time zone 'Asia/Yangon';
  target_booked_by uuid;
  target_appointment uuid;
  target_encounter uuid;
  v_encounter_type public.encounter_type;
  target_prescription uuid;
  target_item_id uuid;
  target_medication_id uuid;
  v_appointment_type public.service_mode;
  v_consultation_channel text;
  candidate_count integer;
  desired record;
  existing record;
  rx_instructions constant text :=
    'Take medicines as directed. Follow posture, warm compress, and follow-up advice.';
  encounter_complaint constant text := 'Neck pain and stiffness';
  encounter_assessment constant text := 'Cervical spondylosis / mechanical neck pain';
  encounter_plan constant text :=
    'Medication, posture care, warm compress, gentle neck exercises, and follow-up as advised.';
begin
  -- Confirm the supplied identities and current provider capabilities before
  -- creating any rows. Do not derive or substitute another patient/provider.
  select profile_id into target_booked_by from public.patients
  where id = target_patient and lower(btrim(full_name)) = 'nandar kyaw';
  if not found then
    raise exception 'Confirmed Nandar Kyaw patient ID/name mismatch; refusing seed.';
  end if;
  if target_booked_by is not null and not exists (
    select 1 from public.profiles where id = target_booked_by
  ) then
    raise exception 'Patient profile reference is invalid; refusing seed.';
  end if;
  if not exists (select 1 from public.providers p
      where p.id = target_provider and p.provider_type = 'doctor'
        and p.verification_status = 'verified') then
    raise exception 'Confirmed provider is absent, not a verified doctor; refusing seed.';
  end if;
  select appointment_id into excluded_allergy_appointment
  from public.care_encounters
  where id = excluded_allergy_encounter and patient_id = target_patient;
  if not found or excluded_allergy_appointment is null then
    raise exception 'Known allergy encounter/appointment could not be resolved; refusing seed.';
  end if;

  select case when p.teleconsult_enabled then 'teleconsultation'::public.service_mode
              when p.home_visit_enabled then 'home_visit'::public.service_mode
              else null end
    into v_appointment_type
  from public.providers p where p.id = target_provider;
  if v_appointment_type is null then
    raise exception 'Verified doctor has no enabled appointment mode; refusing seed.';
  end if;
  v_consultation_channel := case v_appointment_type
    when 'teleconsultation' then 'video'
    when 'home_visit' then 'home_visit'
  end;
  v_encounter_type := case v_appointment_type
    when 'teleconsultation' then 'teleconsultation'::public.encounter_type
    when 'home_visit' then 'home_visit'::public.encounter_type
  end;

  -- The deterministic identity chain prevents duplicates on rerun.
  target_appointment := md5('easycare:nandar-cervical-appointment:v1:' || target_patient::text)::uuid;
  target_encounter := md5('easycare:nandar-cervical-encounter:v1:' || target_patient::text)::uuid;
  target_prescription := md5('easycare:nandar-cervical-prescription:v1:' || target_patient::text)::uuid;
  if target_encounter = excluded_allergy_encounter then
    raise exception 'Stable seed identity collides with the excluded allergy records.';
  end if;

  -- If any deterministic ID already exists, validate its entire parent chain
  -- and contents. Conflicts abort the transaction rather than overwriting.
  if exists (select 1 from public.appointments a where a.id = target_appointment
      and (a.patient_id <> target_patient or a.provider_id <> target_provider
        or a.appointment_type <> v_appointment_type or a.consultation_channel <> v_consultation_channel
        or a.scheduled_start <> seed_start or a.scheduled_end <> seed_end
        or a.status <> 'completed' or a.reason_symptoms <> encounter_complaint
        or a.booking_code <> 'ECS-' || upper(substr(md5('easycare:nandar-cervical-appointment:v1:' || target_patient::text),1,12)))) then
    raise exception 'Stable appointment ID contains conflicting data; refusing changes.';
  end if;
  if exists (select 1 from public.appointments a
      where a.patient_id = target_patient and a.provider_id = target_provider
        and a.scheduled_start = seed_start and a.scheduled_end = seed_end
        and a.status = 'completed' and a.reason_symptoms = encounter_complaint
        and a.id <> target_appointment) then
    raise exception 'An identical completed cervical appointment already exists under another ID; inspect before applying.';
  end if;
  if exists (select 1 from public.care_encounters e
      where e.patient_id = target_patient and e.provider_id = target_provider
        and e.started_at = seed_start and e.ended_at = seed_end
        and e.chief_complaint = encounter_complaint
        and e.assessment_summary = encounter_assessment and e.care_plan = encounter_plan
        and e.status = 'completed' and e.id <> target_encounter) then
    raise exception 'An identical cervical encounter already exists under another ID; inspect before applying.';
  end if;
  if exists (select 1 from public.care_encounters e where e.id = target_encounter
      and (e.appointment_id <> target_appointment or e.patient_id <> target_patient
        or e.provider_id <> target_provider or e.encounter_type <> v_encounter_type
        or e.started_at <> seed_start or e.ended_at <> seed_end
        or e.chief_complaint <> encounter_complaint
        or e.assessment_summary <> encounter_assessment or e.care_plan <> encounter_plan
        or e.status <> 'completed')) then
    raise exception 'Stable encounter ID contains conflicting data; refusing changes.';
  end if;
  if exists (select 1 from public.prescriptions p where p.id = target_prescription
      and (p.encounter_id <> target_encounter or p.patient_id <> target_patient
        or p.doctor_provider_id <> target_provider or p.status <> 'active'
        or p.instructions <> rx_instructions or p.issued_at <> seed_start)) then
    raise exception 'Stable prescription ID contains conflicting data; refusing changes.';
  end if;

  -- Do not repurpose an existing allergy appointment or any existing record.
  if excluded_allergy_appointment is not null
     and target_appointment = excluded_allergy_appointment then
    raise exception 'Refusing to reuse the known allergy appointment.';
  end if;
  if target_encounter = excluded_allergy_encounter then
    raise exception 'Refusing to reuse the known allergy encounter.';
  end if;
  if exists (select 1 from public.care_encounters e
      where e.appointment_id = target_appointment and e.id <> target_encounter) then
    raise exception 'Stable appointment is already linked to a different encounter.';
  end if;

  -- A separately-created matching three-item active bundle is ambiguous. Stop
  -- rather than making a second prescription or repointing existing records.
  if exists (select 1 from public.prescriptions p
      where p.patient_id = target_patient and p.status = 'active'
        and p.id <> target_prescription
        and (select count(distinct i.medication_name) from public.prescription_items i
             where i.prescription_id = p.id and i.medication_name in
               ('Paracetamol','Diclofenac Gel','Vitamin B Complex')) = 3) then
    raise exception 'A matching active three-item prescription already exists under another ID; inspect before applying.';
  end if;

  -- Appointment schema checked from migrations: care_request_id and
  -- provider_availability_id are nullable; booked_by_profile_id is nullable;
  -- consultation_channel and booking_code are required by later constraints.
  insert into public.appointments
    (id, care_request_id, patient_id, provider_id, booked_by_profile_id,
     appointment_type, scheduled_start, scheduled_end, reason_symptoms, status,
     fee_amount, currency, provider_availability_id, consultation_channel, booking_code)
  values (target_appointment, null, target_patient, target_provider, target_booked_by,
    v_appointment_type, seed_start, seed_end, encounter_complaint, 'completed',
    0, 'MMK', null, v_consultation_channel,
    'ECS-' || upper(substr(md5('easycare:nandar-cervical-appointment:v1:' || target_patient::text),1,12)))
  on conflict (id) do nothing;
  if not exists (select 1 from public.appointments a
      where a.id = target_appointment and a.patient_id = target_patient
        and a.provider_id = target_provider and a.appointment_type = v_appointment_type
        and a.consultation_channel = v_consultation_channel and a.scheduled_start = seed_start
        and a.scheduled_end = seed_end and a.status = 'completed'
        and a.reason_symptoms = encounter_complaint) then
    raise exception 'Appointment post-insert validation failed; rolling back.';
  end if;

  insert into public.care_encounters
    (id, appointment_id, patient_id, provider_id, encounter_type, started_at, ended_at,
     chief_complaint, assessment_summary, care_plan, status)
  values (target_encounter, target_appointment, target_patient, target_provider,
    v_encounter_type, seed_start, seed_end, encounter_complaint,
    encounter_assessment, encounter_plan, 'completed')
  on conflict (id) do nothing;
  if not exists (select 1 from public.care_encounters e
      where e.id = target_encounter and e.appointment_id = target_appointment
        and e.patient_id = target_patient and e.provider_id = target_provider
        and e.status = 'completed' and e.chief_complaint = encounter_complaint
        and e.assessment_summary = encounter_assessment and e.care_plan = encounter_plan) then
    raise exception 'Encounter post-insert validation failed; rolling back.';
  end if;

  insert into public.prescriptions
    (id, encounter_id, patient_id, doctor_provider_id, status, instructions, issued_at)
  values (target_prescription, target_encounter, target_patient, target_provider,
    'active', rx_instructions, seed_start)
  on conflict (id) do nothing;

  create temporary table seed_cervical_items (
    item_key text primary key,
    medication_name text not null,
    strength text,
    dose text not null,
    route text not null,
    frequency text not null,
    duration_days integer not null,
    instructions text not null
  ) on commit drop;
  insert into seed_cervical_items values
    ('paracetamol','Paracetamol','500 mg','1 tablet','oral','Every 8 hours as needed for pain',5,'Take as needed for pain.'),
    ('diclofenac-gel','Diclofenac Gel',null,'Thin layer','topical','3 times daily',7,'Apply a thin layer to the neck area.'),
    ('vitamin-b-complex','Vitamin B Complex',null,'1 tablet','oral','Once daily',14,'Take after food.');

  for desired in select * from seed_cervical_items order by item_key loop
    target_item_id := md5('easycare:nandar-cervical-item:v1:' || target_patient::text || ':' || desired.item_key)::uuid;
    if exists (select 1 from public.prescription_items i where i.id = target_item_id
        and (i.prescription_id <> target_prescription or i.medication_name <> desired.medication_name
          or i.strength is distinct from desired.strength or i.dose <> desired.dose
          or i.route <> desired.route or i.frequency <> desired.frequency
          or i.duration_days <> desired.duration_days or i.instructions <> desired.instructions)) then
      raise exception 'Stable prescription item ID conflicts for %; refusing changes.', desired.medication_name;
    end if;
    insert into public.prescription_items
      (id,prescription_id,medication_name,strength,dose,route,frequency,duration_days,instructions)
    values (target_item_id,target_prescription,desired.medication_name,desired.strength,
      desired.dose,desired.route,desired.frequency,desired.duration_days,desired.instructions)
    on conflict (id) do nothing;

    target_medication_id := md5('easycare:nandar-cervical-medication:v1:' || target_patient::text || ':' || desired.item_key)::uuid;
    if exists (select 1 from public.patient_medications m where m.id = target_medication_id
        and (m.patient_id <> target_patient or m.prescription_item_id <> target_item_id
          or m.medication_name <> desired.medication_name or m.dose <> desired.dose
          or m.frequency <> desired.frequency or m.start_date <> date '2026-10-08'
          or m.end_date <> date '2026-10-08' + desired.duration_days - 1
          or m.status <> 'active' or m.instructions <> desired.instructions)) then
      raise exception 'Stable patient medication ID conflicts for %; refusing changes.', desired.medication_name;
    end if;
    insert into public.patient_medications
      (id,patient_id,prescription_item_id,medication_name,dose,frequency,start_date,end_date,status,instructions)
    values (target_medication_id,target_patient,target_item_id,desired.medication_name,
      desired.dose,desired.frequency,date '2026-10-08',
      date '2026-10-08' + desired.duration_days - 1,'active',desired.instructions)
    on conflict (id) do nothing;

    if not exists (select 1 from public.prescription_items i where i.id = target_item_id
        and i.prescription_id = target_prescription and i.medication_name = desired.medication_name)
       or not exists (select 1 from public.patient_medications m where m.id = target_medication_id
        and m.patient_id = target_patient and m.prescription_item_id = target_item_id
        and m.status = 'active') then
      raise exception 'Item/medication linkage verification failed for %; rolling back.', desired.medication_name;
    end if;
  end loop;

  if exists (select 1 from public.medication_schedules s
      join public.patient_medications m on m.id = s.patient_medication_id
      join public.prescription_items i on i.id = m.prescription_item_id
      where i.prescription_id = target_prescription)
     or exists (select 1 from public.medication_events e
      join public.medication_schedules s on s.id = e.schedule_id
      join public.patient_medications m on m.id = s.patient_medication_id
      join public.prescription_items i on i.id = m.prescription_item_id
      where i.prescription_id = target_prescription) then
    raise exception 'Unexpected schedule/event rows exist for this seed chain; refusing to alter them.';
  end if;

  raise notice 'Prepared Nandar cervical seed IDs: appointment=%, encounter=%, prescription=%; items=3; patient_medications=3; schedules=0; events=0',
    target_appointment,target_encounter,target_prescription;
end;
$seed$;

commit;
