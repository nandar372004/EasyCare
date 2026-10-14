-- Fail-closed, rerunnable Staging seed for Nandar Kyaw's cervical care chain.
-- Does not reuse the allergy encounter, Cetirizine prescription, or the older
-- Paracetamol course. It creates no schedules/events and changes no schema,
-- grants, or RLS. Apply only after confirming an unused completed appointment
-- exists for the supplied patient and verified doctor; the schema requires an
-- appointment_id for each care_encounter.

begin;
set local lock_timeout = '10s';

lock table public.patients, public.providers, public.appointments in share mode;
lock table public.care_encounters, public.prescriptions, public.prescription_items,
  public.patient_medications in share row exclusive mode;

do $seed$
declare
  target_patient constant uuid := '2d329d5b-9093-45ca-a980-97466d2a71eb';
  target_provider constant uuid := '52000000-0000-4000-8000-000000000003';
  excluded_allergy_encounter constant uuid := '1e86e70f-d79b-6d62-4fe0-b327a9f4331e';
  target_encounter uuid;
  target_appointment uuid;
  target_encounter_type public.encounter_type;
  target_started_at timestamptz;
  target_ended_at timestamptz;
  target_prescription uuid;
  target_issued_at timestamptz;
  target_item_id uuid;
  target_medication_id uuid;
  candidate_count integer;
  desired record;
  existing record;
  rx_instructions constant text :=
    'Take medicines as directed. Follow posture, warm compress, and follow-up advice.';
begin
  if not exists (select 1 from public.patients p
      where p.id = target_patient and lower(btrim(p.full_name)) = 'nandar kyaw') then
    raise exception 'Confirmed Nandar Kyaw patient ID no longer matches; refusing seed.';
  end if;
  if not exists (select 1 from public.providers p
      where p.id = target_provider and p.provider_type = 'doctor'
        and p.verification_status = 'verified') then
    raise exception 'Confirmed doctor is absent, not a doctor, or not verified; refusing seed.';
  end if;

  target_encounter := md5('easycare:nandar-cervical-encounter:v1:' || target_patient::text)::uuid;
  target_prescription := md5('easycare:nandar-cervical-prescription:v1:' || target_patient::text)::uuid;

  if target_encounter = excluded_allergy_encounter then
    raise exception 'Stable cervical encounter ID collides with the excluded allergy encounter.';
  end if;

  -- Reruns use the same encounter and its appointment. Existing contents must
  -- match this seed exactly; unrelated or partially conflicting rows stop it.
  if exists (select 1 from public.care_encounters where id = target_encounter) then
    select appointment_id, encounter_type, started_at, ended_at
      into target_appointment, target_encounter_type, target_started_at, target_ended_at
    from public.care_encounters where id = target_encounter;
    if not exists (select 1 from public.care_encounters e
        where e.id = target_encounter and e.patient_id = target_patient
          and e.provider_id = target_provider and e.status = 'completed'
          and e.chief_complaint = 'Neck pain and stiffness'
          and e.assessment_summary = 'Cervical spondylosis / mechanical neck pain'
          and e.care_plan = 'Medication, posture care, warm compress, gentle neck exercises, and follow-up as advised.') then
      raise exception 'Stable cervical encounter ID contains conflicting data; refusing changes.';
    end if;
  else
    -- A care_encounter must reference a same-patient appointment, and the
    -- appointment is unique per encounter. Reuse only an unused completed one.
    select count(*), (array_agg(a.id order by a.scheduled_start, a.id))[1]
      into candidate_count, target_appointment
    from public.appointments a
    where a.patient_id = target_patient and a.provider_id = target_provider
      and a.status = 'completed'
      and not exists (select 1 from public.care_encounters e where e.appointment_id = a.id);
    if candidate_count = 0 then
      raise exception 'No unused completed appointment exists for Nandar and the selected doctor. No rows written.';
    elsif candidate_count > 1 then
      raise exception 'Multiple unused completed appointments match; refusing ambiguous encounter linkage.';
    end if;
    select a.scheduled_start, a.scheduled_end
      into target_started_at, target_ended_at
    from public.appointments a where a.id = target_appointment
      and a.patient_id = target_patient and a.provider_id = target_provider;
    select case when p.teleconsult_enabled then 'teleconsultation'::public.encounter_type
                else 'home_visit'::public.encounter_type end
      into target_encounter_type
    from public.providers p where p.id = target_provider;
  end if;

  if target_appointment is null or target_started_at is null or target_ended_at is null then
    raise exception 'Matching appointment/date details are unavailable; refusing seed.';
  end if;
  if not exists (select 1 from public.appointments a
      where a.id = target_appointment and a.patient_id = target_patient
        and a.provider_id = target_provider and a.status = 'completed') then
    raise exception 'Encounter appointment does not belong to the confirmed patient/doctor or is not completed.';
  end if;
  if exists (select 1 from public.care_encounters e
      where e.id = excluded_allergy_encounter and e.patient_id = target_patient) then
    -- Explicit exclusion guard: the known allergy encounter is never selected.
    if target_encounter = excluded_allergy_encounter or target_appointment =
       (select appointment_id from public.care_encounters where id = excluded_allergy_encounter) then
      raise exception 'Refusing to reuse the known allergy encounter or its appointment.';
    end if;
  end if;

  -- If a completed bundle already matches, stop rather than silently creating
  -- a second cervical prescription under another encounter/identifier.
  if exists (
    select 1 from public.prescriptions p
    where p.patient_id = target_patient and p.status = 'active'
      and p.id <> target_prescription
      and (select count(distinct i.medication_name) from public.prescription_items i
           where i.prescription_id = p.id
             and i.medication_name in ('Paracetamol','Diclofenac Gel','Vitamin B Complex')) = 3
  ) then
    raise exception 'A matching three-item active prescription already exists under another ID; inspect and reuse it manually.';
  end if;

  if exists (select 1 from public.care_encounters where appointment_id = target_appointment
      and id <> target_encounter) then
    raise exception 'Selected appointment is already linked to another encounter; refusing duplicate.';
  end if;

  insert into public.care_encounters
    (id, appointment_id, patient_id, provider_id, encounter_type, started_at, ended_at,
     chief_complaint, assessment_summary, care_plan, status)
  values (target_encounter, target_appointment, target_patient, target_provider,
    target_encounter_type, target_started_at, target_ended_at,
    'Neck pain and stiffness', 'Cervical spondylosis / mechanical neck pain',
    'Medication, posture care, warm compress, gentle neck exercises, and follow-up as advised.',
    'completed')
  on conflict (id) do nothing;

  target_issued_at := target_started_at;
  if exists (select 1 from public.prescriptions p where p.id = target_prescription
      and (p.patient_id <> target_patient or p.encounter_id <> target_encounter
        or p.doctor_provider_id <> target_provider or p.status <> 'active'
        or p.instructions <> rx_instructions or p.issued_at <> target_issued_at)) then
    raise exception 'Stable prescription ID contains conflicting data; refusing changes.';
  end if;
  insert into public.prescriptions
    (id, encounter_id, patient_id, doctor_provider_id, status, instructions, issued_at)
  values (target_prescription, target_encounter, target_patient, target_provider,
    'active', rx_instructions, target_issued_at)
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
    select count(*), (array_agg(i.id))[1] into candidate_count, target_item_id
    from public.prescription_items i
    where i.prescription_id = target_prescription and i.medication_name = desired.medication_name;
    if candidate_count > 1 then
      raise exception 'Duplicate items exist for %; refusing changes.', desired.medication_name;
    elsif candidate_count = 1 then
      select * into existing from public.prescription_items where id = target_item_id;
      if existing.strength is distinct from desired.strength or existing.dose is distinct from desired.dose
         or existing.route is distinct from desired.route or existing.frequency is distinct from desired.frequency
         or existing.duration_days is distinct from desired.duration_days
         or existing.instructions is distinct from desired.instructions then
        raise exception 'Existing item % conflicts with this seed; refusing changes.', desired.medication_name;
      end if;
    else
      target_item_id := md5('easycare:nandar-cervical-item:v1:' || target_patient::text || ':' || desired.item_key)::uuid;
      insert into public.prescription_items
        (id,prescription_id,medication_name,strength,dose,route,frequency,duration_days,instructions)
      values (target_item_id,target_prescription,desired.medication_name,desired.strength,
        desired.dose,desired.route,desired.frequency,desired.duration_days,desired.instructions)
      on conflict (id) do nothing;
      if not exists (select 1 from public.prescription_items i where i.id = target_item_id
          and i.prescription_id = target_prescription and i.medication_name = desired.medication_name
          and i.strength is not distinct from desired.strength and i.dose = desired.dose
          and i.route = desired.route and i.frequency = desired.frequency
          and i.duration_days = desired.duration_days and i.instructions = desired.instructions) then
        raise exception 'Stable item ID conflicts for %; refusing changes.', desired.medication_name;
      end if;
    end if;

    select count(*), (array_agg(m.id))[1] into candidate_count, target_medication_id
    from public.patient_medications m where m.prescription_item_id = target_item_id;
    if candidate_count > 1 then
      raise exception 'Multiple medication courses link to %; refusing changes.', desired.medication_name;
    elsif candidate_count = 1 then
      select * into existing from public.patient_medications where id = target_medication_id;
      if existing.patient_id <> target_patient or existing.medication_name <> desired.medication_name
         or existing.dose <> desired.dose or existing.frequency <> desired.frequency
         or existing.start_date <> (target_started_at at time zone 'Asia/Yangon')::date
         or existing.end_date <> (target_started_at at time zone 'Asia/Yangon')::date + desired.duration_days - 1
         or existing.status <> 'active' or existing.instructions <> desired.instructions then
        raise exception 'Existing linked course for % conflicts with this seed; refusing changes.', desired.medication_name;
      end if;
    else
      target_medication_id := md5('easycare:nandar-cervical-medication:v1:' || target_patient::text || ':' || desired.item_key)::uuid;
      insert into public.patient_medications
        (id,patient_id,prescription_item_id,medication_name,dose,frequency,start_date,end_date,status,instructions)
      values (target_medication_id,target_patient,target_item_id,desired.medication_name,
        desired.dose,desired.frequency,(target_started_at at time zone 'Asia/Yangon')::date,
        (target_started_at at time zone 'Asia/Yangon')::date + desired.duration_days - 1,'active',desired.instructions)
      on conflict (id) do nothing;
      if not exists (select 1 from public.patient_medications m where m.id = target_medication_id
          and m.patient_id = target_patient and m.prescription_item_id = target_item_id
          and m.medication_name = desired.medication_name and m.dose = desired.dose
          and m.frequency = desired.frequency and m.start_date = (target_started_at at time zone 'Asia/Yangon')::date
          and m.end_date = (target_started_at at time zone 'Asia/Yangon')::date + desired.duration_days - 1
          and m.status = 'active' and m.instructions = desired.instructions) then
        raise exception 'Stable medication ID conflicts for %; refusing changes.', desired.medication_name;
      end if;
    end if;
  end loop;

  if not exists (select 1 from public.prescriptions p
      where p.id = target_prescription and p.patient_id = target_patient
        and p.encounter_id = target_encounter and p.doctor_provider_id = target_provider)
     or (select count(*) from public.prescription_items i where i.prescription_id = target_prescription
         and i.medication_name in ('Paracetamol','Diclofenac Gel','Vitamin B Complex')) <> 3
     or (select count(*) from public.patient_medications m join public.prescription_items i
           on i.id = m.prescription_item_id
         where m.patient_id = target_patient and i.prescription_id = target_prescription
           and i.medication_name in ('Paracetamol','Diclofenac Gel','Vitamin B Complex')) <> 3 then
    raise exception 'Post-seed patient/prescription/item/medication linkage check failed; rolling back.';
  end if;

  raise notice 'Prepared cervical chain: patient=%, encounter=%, appointment=%, provider=%, prescription=%, issued_at=%, item_count=3; schedules=0; events=0',
    target_patient,target_encounter,target_appointment,target_provider,target_prescription,target_issued_at;
end;
$seed$;

commit;
