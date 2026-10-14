-- Fail-closed, rerunnable Staging seed for Nandar Kyaw's sample prescription.
-- Creates one prescription and its three medication records only. It never
-- creates schedules/events or changes schema, grants, or RLS.
-- Uses only the live-safe patient_medications columns listed below.
-- Review the resolved patient/provider/encounter and date before applying.

begin;
set local lock_timeout = '10s';

lock table public.patients, public.providers, public.care_encounters in share mode;
lock table public.prescriptions, public.prescription_items, public.patient_medications
  in share row exclusive mode;

do $seed$
declare
  target_patient uuid;
  target_provider uuid;
  target_encounter uuid;
  target_prescription uuid;
  target_item_id uuid;
  target_medication_id uuid;
  issued_on date;
  candidate_count integer;
  item_row record;
  desired record;
  expected_prescription_instructions constant text :=
    'Take medicines as directed. Follow the recorded care instructions.';
begin
  -- Resolve by exact existing patient name; ambiguity or absence aborts.
  select count(*), (array_agg(id))[1] into candidate_count, target_patient
  from public.patients
  where lower(btrim(full_name)) = lower('Nandar Kyaw');
  if candidate_count <> 1 then
    raise exception 'Expected exactly one existing Nandar Kyaw patient; found %. No rows written.', candidate_count;
  end if;

  -- Prefer an existing prescription created by this script. This makes reruns
  -- stable even if another encounter is later added for the patient.
  target_prescription := md5('easycare:nandar-cervical-rx:v1:' || target_patient::text)::uuid;
  if exists (select 1 from public.prescriptions where id = target_prescription) then
    select encounter_id, doctor_provider_id, issued_at::date
      into target_encounter, target_provider, issued_on
    from public.prescriptions where id = target_prescription;
    if not exists (
      select 1 from public.care_encounters e
      join public.providers p on p.id = e.provider_id
      where e.id = target_encounter and e.patient_id = target_patient
        and p.id = target_provider and p.id = e.provider_id
        and p.provider_type = 'doctor' and p.verification_status = 'verified'
    ) then
      raise exception 'Existing seed prescription has no valid matching patient encounter/doctor; refusing changes.';
    end if;
  else
    -- Reuse the patient's existing suitable encounter and its verified doctor.
    -- A cervical-spondylosis encounter is preferred when present.
    select e.id, p.id into target_encounter, target_provider
    from public.care_encounters e
    join public.providers p on p.id = e.provider_id
    where e.patient_id = target_patient
      and p.provider_type = 'doctor'
      and p.verification_status = 'verified'
    order by (lower(coalesce(e.assessment_summary, '') || ' ' || coalesce(e.chief_complaint, ''))
              like '%cervical spondylosis%') desc,
             e.started_at desc nulls last, e.created_at desc, e.id
    limit 1;
    if target_encounter is null or target_provider is null then
      raise exception 'No existing suitable encounter with a verified doctor for Nandar Kyaw; no rows written.';
    end if;

    -- No date is present in the checked-in cervical prescription sample text.
    -- Reuse the date of an existing matching active sample prescription if one
    -- exists; otherwise use today when the seed is applied.
    select min(p.issued_at::date) into issued_on
    from public.prescriptions p
    where p.patient_id = target_patient and p.status = 'active'
      and exists (select 1 from public.prescription_items i where i.prescription_id = p.id and i.medication_name = 'Paracetamol')
      and exists (select 1 from public.prescription_items i where i.prescription_id = p.id and i.medication_name = 'Diclofenac Gel')
      and exists (select 1 from public.prescription_items i where i.prescription_id = p.id and i.medication_name = 'Vitamin B Complex');
    issued_on := coalesce(issued_on, current_date);
  end if;

  if exists (
    select 1 from public.prescriptions p
    where p.id = target_prescription
      and (p.patient_id <> target_patient or p.encounter_id <> target_encounter
        or p.doctor_provider_id <> target_provider or p.status <> 'active'
        or p.instructions <> expected_prescription_instructions)
  ) then
    raise exception 'Stable prescription ID contains different data; refusing to overwrite.';
  end if;

  insert into public.prescriptions
    (id, encounter_id, patient_id, doctor_provider_id, status, instructions, issued_at)
  values (target_prescription, target_encounter, target_patient, target_provider,
    'active', expected_prescription_instructions,
    issued_on::timestamp at time zone 'Asia/Yangon')
  on conflict (id) do nothing;

  create temporary table seed_medications (
    item_key text primary key,
    medication_name text not null,
    strength text,
    dose text not null,
    route text not null,
    frequency text not null,
    duration_days integer not null,
    item_instructions text not null
  ) on commit drop;

  insert into seed_medications values
    ('paracetamol', 'Paracetamol', '500 mg', '1 tablet', 'oral', 'Every 8 hours as needed for pain', 5, 'Take as needed for pain.'),
    ('diclofenac-gel', 'Diclofenac Gel', null, 'Thin layer', 'topical', '3 times daily', 7, 'Apply a thin layer to the neck area.'),
    ('vitamin-b-complex', 'Vitamin B Complex', null, '1 tablet', 'oral', 'Once daily', 14, 'Take after food.');

  for desired in select * from seed_medications order by item_key loop
    -- Reuse exactly one matching item if already present; reject ambiguous or
    -- conflicting same-name items on this prescription.
    select count(*), (array_agg(id))[1] into candidate_count, target_item_id
    from public.prescription_items
    where prescription_id = target_prescription and medication_name = desired.medication_name;
    if candidate_count > 1 then
      raise exception 'Duplicate prescription items already exist for %; refusing changes.', desired.medication_name;
    end if;

    if candidate_count = 1 then
      select * into item_row from public.prescription_items where id = target_item_id;
      if item_row.strength is distinct from desired.strength
         or item_row.dose is distinct from desired.dose
         or item_row.route is distinct from desired.route
         or item_row.frequency is distinct from desired.frequency
         or item_row.duration_days is distinct from desired.duration_days
         or item_row.instructions is distinct from desired.item_instructions then
        raise exception 'Existing prescription item % has conflicting recorded details; refusing overwrite.', desired.medication_name;
      end if;
    else
      target_item_id := md5('easycare:nandar-cervical-item:v1:' || target_patient::text || ':' || desired.item_key)::uuid;
      insert into public.prescription_items
        (id, prescription_id, medication_name, strength, dose, route, frequency, duration_days, instructions)
      values (target_item_id, target_prescription, desired.medication_name, desired.strength,
        desired.dose, desired.route, desired.frequency, desired.duration_days, desired.item_instructions)
      on conflict (id) do nothing;
      if not exists (select 1 from public.prescription_items where id = target_item_id
          and prescription_id = target_prescription and medication_name = desired.medication_name
          and strength is not distinct from desired.strength and dose = desired.dose and route = desired.route
          and frequency = desired.frequency and duration_days = desired.duration_days
          and instructions = desired.item_instructions) then
        raise exception 'Stable item ID conflicts with existing data for %; refusing changes.', desired.medication_name;
      end if;
    end if;

    if candidate_count = 1 then
      target_item_id := item_row.id;
    end if;

    -- Reuse the linked medication when present. This INSERT/UPDATE references
    -- only the approved live Staging medication columns; created_by_profile_id
    -- is omitted because the checked-in schema allows it to be NULL.
    select count(*), (array_agg(id))[1] into candidate_count, target_medication_id
    from public.patient_medications
    where prescription_item_id = target_item_id;
    if candidate_count > 1 then
      raise exception 'Multiple patient medication rows already link to %; refusing changes.', desired.medication_name;
    elsif candidate_count = 1 then
      update public.patient_medications
      set patient_id = target_patient,
          medication_name = desired.medication_name,
          dose = desired.dose,
          frequency = desired.frequency,
          start_date = issued_on,
          end_date = issued_on + desired.duration_days - 1,
          status = 'active',
          instructions = desired.item_instructions
      where id = target_medication_id
        and (patient_id, prescription_item_id) is not distinct from (target_patient, target_item_id);
      if not found then
        raise exception 'Existing medication ownership does not match %; refusing changes.', desired.medication_name;
      end if;
    else
      target_medication_id := md5('easycare:nandar-cervical-medication:v1:' || target_patient::text || ':' || desired.item_key)::uuid;
      insert into public.patient_medications
        (id, patient_id, prescription_item_id, medication_name, dose, frequency,
         start_date, end_date, status, instructions)
      values (target_medication_id, target_patient, target_item_id, desired.medication_name,
        desired.dose, desired.frequency, issued_on, issued_on + desired.duration_days - 1,
        'active', desired.item_instructions)
      on conflict (id) do nothing;
      if not exists (select 1 from public.patient_medications where id = target_medication_id
          and patient_id = target_patient and prescription_item_id = target_item_id
          and medication_name = desired.medication_name and dose = desired.dose
          and frequency = desired.frequency and start_date = issued_on
          and end_date = issued_on + desired.duration_days - 1 and status = 'active'
          and instructions = desired.item_instructions) then
        raise exception 'Stable medication ID conflicts with existing data for %; refusing changes.', desired.medication_name;
      end if;
    end if;
  end loop;

  -- Preserve the no-fabricated-time contract: no schedule or event rows are
  -- inserted. Verify every prescription/item/medication link belongs to target.
  if (select count(*) from public.prescription_items
      where prescription_id = target_prescription
        and medication_name in ('Paracetamol','Diclofenac Gel','Vitamin B Complex')) <> 3
     or (select count(*) from public.patient_medications m
         join public.prescription_items i on i.id = m.prescription_item_id
         where m.patient_id = target_patient and i.prescription_id = target_prescription
           and i.medication_name in ('Paracetamol','Diclofenac Gel','Vitamin B Complex')) <> 3 then
    raise exception 'Post-seed linkage/schedule/event verification failed; rolling back.';
  end if;

  raise notice 'Nandar seed prepared: patient_id=%, prescription_id=%, encounter_id=%, doctor_provider_id=%, issued_on=%, items=3, schedules=0, events=0',
    target_patient, target_prescription, target_encounter, target_provider, issued_on;
end;
$seed$;

commit;
