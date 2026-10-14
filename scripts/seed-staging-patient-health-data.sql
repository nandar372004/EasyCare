-- Hackathon Staging seed only. Never run against Production.
-- Creates completed appointment/encounter anchors, patient-specific
-- prescriptions/items/medications, and 2-3 health records per audited patient.
-- IDs are deterministic; existing seed rows are validated and never overwritten.
-- Re-running is safe: deterministic IDs plus content and ownership checks prevent
-- duplicates or overwriting unrelated records. The expected fingerprint locks
-- this script to the audited Staging snapshot. No schema, RLS, or grants change.

begin;
set local lock_timeout = '10s';

create temporary table seed_people (
  patient_id uuid primary key,
  plan_no integer unique,
  provider_id uuid,
  chief_complaint text,
  condition_name text,
  condition_status public.condition_status,
  diagnosed_on date,
  allergen text,
  allergy_reaction text,
  allergy_severity public.allergy_severity,
  history_category public.history_category,
  history_title text,
  history_date date
) on commit drop;

create temporary table seed_rx (
  patient_id uuid,
  plan_no integer,
  rx_slot integer,
  medication_name text,
  strength text,
  dose text,
  route text,
  frequency text,
  duration_days integer,
  rx_status public.prescription_status,
  issued_on date,
  item_instructions text,
  primary key(patient_id,rx_slot)
) on commit drop;

create temporary table seed_summary(summary jsonb) on commit drop;

do $seed$
declare
  execute_seed boolean := true;
  people_count integer;
  rx_count integer;
  item_count integer;
  medication_count integer;
  condition_count integer;
  allergy_count integer;
  history_count integer;
  appointment_count integer := 0;
  encounter_count integer := 0;
  patient_fingerprint text;
  profile_fingerprint text;
  provider_fingerprint text;
  appointment_fingerprint text;
  availability_fingerprint text;
  encounter_fingerprint text;
  prescription_fingerprint text;
  item_fingerprint text;
  medication_fingerprint text;
  condition_fingerprint text;
  allergy_fingerprint text;
  history_fingerprint text;
  plan_fingerprint text;
  inserted_count integer;
begin
  if current_database() <> 'postgres' then
    raise exception 'Unexpected database; Staging seed refused.';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.prescriptions'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.prescription_items'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.patient_medications'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.patient_conditions'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.patient_allergies'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.medical_history_items'::regclass) then
    raise exception 'Expected clinical RLS enabled; refusing seed.';
  end if;

  lock table public.patients, public.profiles, public.providers in share mode;
  lock table public.appointments, public.provider_availability, public.care_encounters,
    public.prescriptions, public.prescription_items, public.patient_medications,
    public.patient_conditions, public.patient_allergies, public.medical_history_items in share row exclusive mode;

  insert into seed_people values
    ('050b666c-71c9-402a-928f-8932b5750e99',1,'52000000-0000-4000-8000-000000000001','Occasional tension headache','Tension-type headache','resolved','2026-09-01',null,null,null,'vaccination','Seasonal influenza vaccination','2025-11-14'),
    ('151c4997-b667-4787-b4a8-1f5b5c996f98',2,'52000000-0000-4000-8000-000000000002','Occasional heartburn','Occasional heartburn','active','2026-09-04',null,null,null,'vaccination','Routine vaccination recorded','2025-10-20'),
    ('2d329d5b-9093-45ca-a980-97466d2a71eb',3,'52000000-0000-4000-8000-000000000003','Seasonal allergy symptoms','Seasonal allergic rhinitis','active','2026-09-10','Pollen','Sneezing and itchy eyes','mild','vaccination','Seasonal influenza vaccination','2025-11-02'),
    ('6e4232cc-dcc9-4027-93f4-ff390e30f628',4,'52000000-0000-4000-8000-000000000004','Seasonal allergy symptoms','Seasonal allergic rhinitis','active','2026-09-12','Pollen','Sneezing','mild',null,null,null),
    ('8449926d-1299-40d2-9b8a-eb8e7eeafd2f',5,'52000000-0000-4000-8000-000000000005','Mild gastric discomfort','Gastric discomfort','resolved','2026-08-28',null,null,null,'vaccination','Routine vaccination recorded','2025-09-18'),
    ('97958ec8-e525-48d4-a60d-8ed6ed4619b5',6,'52000000-0000-4000-8000-000000000006','Mild headache episode','Tension-type headache','historical','2026-08-19','House dust','Sneezing','mild','other','Headache self-care review','2026-08-20'),
    ('9d9a77c3-ce2c-4773-8ddc-69dd16b238ab',7,'52000000-0000-4000-8000-000000000001','Seasonal allergy symptoms','Allergic rhinitis','active','2026-09-06','Pollen','Watery eyes','mild',null,null,null),
    ('b57f1f52-d0dc-413a-9494-964a40dada0b',8,'52000000-0000-4000-8000-000000000002','Intermittent heartburn','Gastric discomfort','active','2026-09-08',null,null,null,'vaccination','Routine vaccination recorded','2025-08-26'),
    ('fdd28edf-d116-481d-b623-48baa68a9eb3',9,'52000000-0000-4000-8000-000000000003','Occasional tension headache','Tension-type headache','resolved','2026-08-30',null,null,null,'vaccination','Seasonal influenza vaccination','2025-10-11');

  select count(*) into people_count from seed_people p
    join public.patients pt on pt.id=p.patient_id
    join public.profiles pf on pf.id=pt.profile_id
    join public.providers pr on pr.id=p.provider_id and pr.provider_type='doctor' and pr.verification_status='verified';
  if people_count<>9 or (select count(*) from public.patients)<>9 then
    raise exception 'Audited Staging patient set changed; expected exactly nine existing patients, found %. No rows written.', (select count(*) from public.patients);
  end if;
  if (select count(*) from seed_people p join public.patients pt on pt.id=p.patient_id where pt.full_name='Nandar Kyaw')<>1 then
    raise exception 'Could not identify exactly one existing Nandar Kyaw patient; refusing seed.';
  end if;

  insert into seed_rx values
    ('050b666c-71c9-402a-928f-8932b5750e99',1,1,'Paracetamol','500 mg','1 tablet','oral','Twice daily as needed',3,'active','2026-10-08','Take after meals.'),
    ('050b666c-71c9-402a-928f-8932b5750e99',1,2,'Cetirizine','10 mg','1 tablet','oral','Once daily',7,'completed','2026-09-15','Take in the evening.'),
    ('151c4997-b667-4787-b4a8-1f5b5c996f98',2,1,'Omeprazole','20 mg','1 capsule','oral','Once daily',14,'active','2026-10-08','Take 30 minutes before breakfast.'),
    ('151c4997-b667-4787-b4a8-1f5b5c996f98',2,2,'Paracetamol','500 mg','1 tablet','oral','Once daily as needed',3,'completed','2026-09-15','Take after meals.'),
    ('2d329d5b-9093-45ca-a980-97466d2a71eb',3,1,'Cetirizine','10 mg','1 tablet','oral','Once daily',7,'active','2026-10-08','Take in the evening.'),
    ('2d329d5b-9093-45ca-a980-97466d2a71eb',3,2,'Paracetamol','500 mg','1 tablet','oral','Twice daily as needed',3,'completed','2026-09-15','Take after meals.'),
    ('6e4232cc-dcc9-4027-93f4-ff390e30f628',4,1,'Loratadine','10 mg','1 tablet','oral','Once daily',7,'active','2026-10-08','Take once daily.'),
    ('6e4232cc-dcc9-4027-93f4-ff390e30f628',4,2,'Paracetamol','500 mg','1 tablet','oral','Once daily as needed',3,'completed','2026-09-15','Take after meals.'),
    ('8449926d-1299-40d2-9b8a-eb8e7eeafd2f',5,1,'Omeprazole','20 mg','1 capsule','oral','Once daily',14,'active','2026-10-08','Take 30 minutes before breakfast.'),
    ('8449926d-1299-40d2-9b8a-eb8e7eeafd2f',5,2,'Cetirizine','10 mg','1 tablet','oral','Once daily',5,'completed','2026-09-15','Take in the evening.'),
    ('97958ec8-e525-48d4-a60d-8ed6ed4619b5',6,1,'Paracetamol','500 mg','1 tablet','oral','Twice daily as needed',3,'active','2026-10-08','Take after meals.'),
    ('97958ec8-e525-48d4-a60d-8ed6ed4619b5',6,2,'Omeprazole','20 mg','1 capsule','oral','Once daily',14,'completed','2026-09-15','Take 30 minutes before breakfast.'),
    ('9d9a77c3-ce2c-4773-8ddc-69dd16b238ab',7,1,'Cetirizine','10 mg','1 tablet','oral','Once daily',7,'active','2026-10-08','Take in the evening.'),
    ('9d9a77c3-ce2c-4773-8ddc-69dd16b238ab',7,2,'Paracetamol','500 mg','1 tablet','oral','Once daily as needed',3,'completed','2026-09-15','Take after meals.'),
    ('b57f1f52-d0dc-413a-9494-964a40dada0b',8,1,'Omeprazole','20 mg','1 capsule','oral','Once daily',14,'active','2026-10-08','Take 30 minutes before breakfast.'),
    ('b57f1f52-d0dc-413a-9494-964a40dada0b',8,2,'Loratadine','10 mg','1 tablet','oral','Once daily',7,'completed','2026-09-15','Take once daily.'),
    ('fdd28edf-d116-481d-b623-48baa68a9eb3',9,1,'Loratadine','10 mg','1 tablet','oral','Once daily',7,'active','2026-10-08','Take once daily.'),
    ('fdd28edf-d116-481d-b623-48baa68a9eb3',9,2,'Paracetamol','500 mg','1 tablet','oral','Twice daily as needed',3,'completed','2026-09-15','Take after meals.');

  select count(*) into rx_count from seed_rx;
  if rx_count<>18 then raise exception 'Unexpected prescription plan count.'; end if;
  select count(*) into item_count from seed_rx;
  medication_count := item_count;
  select count(*) into condition_count from seed_people where condition_name is not null;
  select count(*) into allergy_count from seed_people where allergen is not null;
  select count(*) into history_count from seed_people where history_title is not null;

  select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into patient_fingerprint from public.patients x;
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into profile_fingerprint from public.profiles x;
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into provider_fingerprint from public.providers x;
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into appointment_fingerprint from public.appointments x where x.id not in (select md5('easycare-hackathon-v1:appointment:'||patient_id::text)::uuid from seed_people);
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into availability_fingerprint from public.provider_availability x where x.id not in (select md5('easycare-hackathon-v1:availability:'||patient_id::text)::uuid from seed_people);
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into encounter_fingerprint from public.care_encounters x where x.id not in (select md5('easycare-hackathon-v1:encounter:'||patient_id::text)::uuid from seed_people);
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into prescription_fingerprint from public.prescriptions x where x.id not in (select md5('easycare-hackathon-v1:prescription:'||patient_id::text||':'||rx_slot::text)::uuid from seed_rx);
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into item_fingerprint from public.prescription_items x where x.id not in (select md5('easycare-hackathon-v1:item:'||patient_id::text||':'||rx_slot::text)::uuid from seed_rx);
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into medication_fingerprint from public.patient_medications x where x.id not in (select md5('easycare-hackathon-v1:medication:'||patient_id::text||':'||rx_slot::text)::uuid from seed_rx) and x.id not in ('7f7be2a9-1576-4fba-a0d6-0c5396576ffe','6fd8636b-0234-4f58-ab9b-32b8b6987ffc','a526c5ad-a1ce-4f1d-9775-5a597dba910b');
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into condition_fingerprint from public.patient_conditions x where x.id not in (select md5('easycare-hackathon-v1:condition:'||patient_id::text)::uuid from seed_people);
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into allergy_fingerprint from public.patient_allergies x where x.id not in (select md5('easycare-hackathon-v1:allergy:'||patient_id::text)::uuid from seed_people where allergen is not null);
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into history_fingerprint from public.medical_history_items x where x.id not in (select md5('easycare-hackathon-v1:history:'||patient_id::text)::uuid from seed_people where history_title is not null);
  select md5(patient_fingerprint||profile_fingerprint||provider_fingerprint||appointment_fingerprint||availability_fingerprint||encounter_fingerprint||prescription_fingerprint||item_fingerprint||medication_fingerprint||condition_fingerprint||allergy_fingerprint||history_fingerprint||jsonb_agg(jsonb_build_object('patient',p.patient_id,'provider',p.provider_id,'plan',p.plan_no) order by p.patient_id)::text)
    into plan_fingerprint from seed_people p;

  if execute_seed then
    if '154fdcbaf9b1789f2fa075130aca9e0a' !~ '^[a-f0-9]{32}$' or plan_fingerprint<>'154fdcbaf9b1789f2fa075130aca9e0a' then
      raise exception 'Staging changed since preview; refusing to seed.';
    end if;

    insert into public.provider_availability(id,provider_id,service_type,start_at,end_at,status)
    select md5('easycare-hackathon-v1:availability:'||p.patient_id::text)::uuid,
      pr.id,
      case when pr.teleconsult_enabled then 'teleconsultation'::public.service_mode else 'home_visit'::public.service_mode end,
      ((date '2026-09-15'+(p.plan_no-1))+time '10:00') at time zone 'Asia/Yangon',
      ((date '2026-09-15'+(p.plan_no-1))+time '10:30') at time zone 'Asia/Yangon',
      'available'
    from seed_people p join public.providers pr on pr.id=p.provider_id
    on conflict(id) do nothing;

    insert into public.appointments(id,care_request_id,patient_id,provider_id,booked_by_profile_id,appointment_type,scheduled_start,scheduled_end,reason_symptoms,status,fee_amount,currency,provider_availability_id,consultation_channel,booking_code)
    select md5('easycare-hackathon-v1:appointment:'||p.patient_id::text)::uuid,null,p.patient_id,p.provider_id,pt.profile_id,
      case when pr.teleconsult_enabled then 'teleconsultation'::public.service_mode else 'home_visit'::public.service_mode end,
      a.start_at,a.end_at,p.chief_complaint,'completed',pr.consultation_fee_mmk,'MMK',a.id,
      case when pr.teleconsult_enabled then 'video' else 'home_visit' end,
      'ECS-'||upper(substr(replace(md5('easycare-hackathon-v1:appointment:'||p.patient_id::text),'-',''),1,12))
    from seed_people p join public.patients pt on pt.id=p.patient_id join public.providers pr on pr.id=p.provider_id
    join public.provider_availability a on a.id=md5('easycare-hackathon-v1:availability:'||p.patient_id::text)::uuid
    on conflict(id) do nothing;

    insert into public.care_encounters(id,appointment_id,patient_id,provider_id,encounter_type,started_at,ended_at,chief_complaint,assessment_summary,care_plan,status)
    select md5('easycare-hackathon-v1:encounter:'||p.patient_id::text)::uuid,
      md5('easycare-hackathon-v1:appointment:'||p.patient_id::text)::uuid,p.patient_id,p.provider_id,
      case when pr.teleconsult_enabled then 'teleconsultation'::public.encounter_type else 'home_visit'::public.encounter_type end,
      a.scheduled_start,a.scheduled_end,p.chief_complaint,p.condition_name,
      'Personalized care plan recorded for the current concern. Prescription directions are listed with each medication.',
      'completed'
    from seed_people p join public.providers pr on pr.id=p.provider_id
    join public.appointments a on a.id=md5('easycare-hackathon-v1:appointment:'||p.patient_id::text)::uuid
    on conflict(id) do nothing;

    insert into public.prescriptions(id,encounter_id,patient_id,doctor_provider_id,status,instructions,issued_at)
    select md5('easycare-hackathon-v1:prescription:'||r.patient_id::text||':'||r.rx_slot::text)::uuid,
      md5('easycare-hackathon-v1:encounter:'||r.patient_id::text)::uuid,r.patient_id,p.provider_id,r.rx_status,
      'Please follow the directions listed for each medication.',r.issued_on::timestamp at time zone 'Asia/Yangon'
    from seed_rx r join seed_people p on p.patient_id=r.patient_id
    on conflict(id) do nothing;

    insert into public.prescription_items(id,prescription_id,medication_name,strength,dose,route,frequency,duration_days,instructions)
    select md5('easycare-hackathon-v1:item:'||r.patient_id::text||':'||r.rx_slot::text)::uuid,
      md5('easycare-hackathon-v1:prescription:'||r.patient_id::text||':'||r.rx_slot::text)::uuid,
      r.medication_name,r.strength,r.dose,r.route,r.frequency,r.duration_days,r.item_instructions
    from seed_rx r on conflict(id) do nothing;

    insert into public.patient_medications(id,patient_id,prescription_item_id,medication_name,dose,frequency,start_date,end_date,status,created_by_profile_id)
    select md5('easycare-hackathon-v1:medication:'||r.patient_id::text||':'||r.rx_slot::text)::uuid,
      r.patient_id,md5('easycare-hackathon-v1:item:'||r.patient_id::text||':'||r.rx_slot::text)::uuid,
      r.medication_name,r.dose||' ('||r.strength||')',r.frequency,r.issued_on,r.issued_on+r.duration_days-1,
      case when r.rx_slot=1 then 'active'::public.patient_medication_status else 'completed'::public.patient_medication_status end,
      pt.profile_id
    from seed_rx r join public.patients pt on pt.id=r.patient_id
    on conflict(id) do nothing;

    insert into public.patient_conditions(id,patient_id,condition_name,status,diagnosed_at,notes)
    select md5('easycare-hackathon-v1:condition:'||p.patient_id::text)::uuid,p.patient_id,p.condition_name,p.condition_status,p.diagnosed_on,
      'Intermittent, mild symptoms recorded during the visit.'
    from seed_people p where p.condition_name is not null on conflict(id) do nothing;

    insert into public.patient_allergies(id,patient_id,allergen,reaction,severity,status)
    select md5('easycare-hackathon-v1:allergy:'||p.patient_id::text)::uuid,p.patient_id,p.allergen,p.allergy_reaction,p.allergy_severity,'active'
    from seed_people p where p.allergen is not null on conflict(id) do nothing;

    insert into public.medical_history_items(id,patient_id,category,title,occurred_on,details)
    select md5('easycare-hackathon-v1:history:'||p.patient_id::text)::uuid,p.patient_id,p.history_category,p.history_title,p.history_date,
      'Recorded in the patient health history.'
    from seed_people p where p.history_title is not null on conflict(id) do nothing;

    -- Remove the display-only prefix from the three previously seeded Nandar
    -- demo medication names; preserve their IDs, status, dose and all other data.
    update public.patient_medications
    set medication_name=regexp_replace(medication_name,'^Demo[[:space:]]+','')
    where patient_id='2d329d5b-9093-45ca-a980-97466d2a71eb'
      and id in ('7f7be2a9-1576-4fba-a0d6-0c5396576ffe','6fd8636b-0234-4f58-ab9b-32b8b6987ffc','a526c5ad-a1ce-4f1d-9775-5a597dba910b')
      and medication_name ~ '^Demo[[:space:]]+';

    select count(*) into inserted_count from public.appointments where id in (select md5('easycare-hackathon-v1:appointment:'||patient_id::text)::uuid from seed_people) and status='completed';
    appointment_count:=inserted_count;
    select count(*) into inserted_count from public.care_encounters where id in (select md5('easycare-hackathon-v1:encounter:'||patient_id::text)::uuid from seed_people) and status='completed';
    encounter_count:=inserted_count;

    if appointment_count<>9 or encounter_count<>9
      or (select count(*) from public.prescriptions where id in (select md5('easycare-hackathon-v1:prescription:'||patient_id::text||':'||rx_slot::text)::uuid from seed_rx))<>18
      or (select count(*) from public.prescription_items where id in (select md5('easycare-hackathon-v1:item:'||patient_id::text||':'||rx_slot::text)::uuid from seed_rx))<>18
      or (select count(*) from public.patient_medications where id in (select md5('easycare-hackathon-v1:medication:'||patient_id::text||':'||rx_slot::text)::uuid from seed_rx))<>18
      or (select count(*) from public.patient_conditions where id in (select md5('easycare-hackathon-v1:condition:'||patient_id::text)::uuid from seed_people))<>9
      or (select count(*) from public.patient_allergies where id in (select md5('easycare-hackathon-v1:allergy:'||patient_id::text)::uuid from seed_people where allergen is not null))<>allergy_count
      or (select count(*) from public.medical_history_items where id in (select md5('easycare-hackathon-v1:history:'||patient_id::text)::uuid from seed_people where history_title is not null))<>history_count then
      raise exception 'Post-seed row count verification failed; rolling back.';
    end if;

    if exists (
      select 1 from seed_people p
      join public.appointments a on a.id=md5('easycare-hackathon-v1:appointment:'||p.patient_id::text)::uuid
      join public.care_encounters e on e.id=md5('easycare-hackathon-v1:encounter:'||p.patient_id::text)::uuid
      where a.patient_id<>p.patient_id or a.provider_id<>p.provider_id or a.status<>'completed'
        or e.patient_id<>p.patient_id or e.provider_id<>p.provider_id or e.appointment_id<>a.id or e.status<>'completed'
    ) or exists (
      select 1 from seed_rx r
      join public.prescriptions rx on rx.id=md5('easycare-hackathon-v1:prescription:'||r.patient_id::text||':'||r.rx_slot::text)::uuid
      join public.prescription_items i on i.id=md5('easycare-hackathon-v1:item:'||r.patient_id::text||':'||r.rx_slot::text)::uuid
      join public.patient_medications m on m.id=md5('easycare-hackathon-v1:medication:'||r.patient_id::text||':'||r.rx_slot::text)::uuid
      where rx.patient_id<>r.patient_id or rx.encounter_id<>md5('easycare-hackathon-v1:encounter:'||r.patient_id::text)::uuid
        or rx.status<>r.rx_status or i.prescription_id<>rx.id or i.medication_name<>r.medication_name or i.strength<>r.strength
        or i.dose<>r.dose or i.route<>r.route or i.frequency<>r.frequency or i.duration_days<>r.duration_days
        or m.patient_id<>r.patient_id or m.prescription_item_id<>i.id or m.medication_name<>r.medication_name
        or m.frequency<>r.frequency
    ) then
      raise exception 'Seed relationship/content verification failed; rolling back.';
    end if;

    if patient_fingerprint<>(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.patients x)
      or profile_fingerprint<>(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.profiles x)
      or provider_fingerprint<>(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.providers x)
      or appointment_fingerprint<>(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.appointments x where x.id not in (select md5('easycare-hackathon-v1:appointment:'||patient_id::text)::uuid from seed_people))
      or availability_fingerprint<>(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.provider_availability x where x.id not in (select md5('easycare-hackathon-v1:availability:'||patient_id::text)::uuid from seed_people))
      or encounter_fingerprint<>(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.care_encounters x where x.id not in (select md5('easycare-hackathon-v1:encounter:'||patient_id::text)::uuid from seed_people))
      or prescription_fingerprint<>(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.prescriptions x where x.id not in (select md5('easycare-hackathon-v1:prescription:'||patient_id::text||':'||rx_slot::text)::uuid from seed_rx))
      or item_fingerprint<>(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.prescription_items x where x.id not in (select md5('easycare-hackathon-v1:item:'||patient_id::text||':'||rx_slot::text)::uuid from seed_rx))
      or medication_fingerprint<>(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.patient_medications x where x.id not in (select md5('easycare-hackathon-v1:medication:'||patient_id::text||':'||rx_slot::text)::uuid from seed_rx) and x.id not in ('7f7be2a9-1576-4fba-a0d6-0c5396576ffe','6fd8636b-0234-4f58-ab9b-32b8b6987ffc','a526c5ad-a1ce-4f1d-9775-5a597dba910b'))
      or condition_fingerprint<>(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.patient_conditions x where x.id not in (select md5('easycare-hackathon-v1:condition:'||patient_id::text)::uuid from seed_people))
      or allergy_fingerprint<>(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.patient_allergies x where x.id not in (select md5('easycare-hackathon-v1:allergy:'||patient_id::text)::uuid from seed_people where allergen is not null))
      or history_fingerprint<>(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.medical_history_items x where x.id not in (select md5('easycare-hackathon-v1:history:'||patient_id::text)::uuid from seed_people where history_title is not null)) then
      raise exception 'Protected existing data changed; rolling back.';
    end if;
  end if;

  insert into seed_summary
  select jsonb_build_object('patients',people_count,'prescriptions',rx_count,'items',item_count,'medications',medication_count,
    'conditions',condition_count,'allergies',allergy_count,'history_records',history_count,
    'planned_appointments',people_count,'planned_encounters',people_count,
    'present_appointments',case when execute_seed then appointment_count else 0 end,
    'present_encounters',case when execute_seed then encounter_count else 0 end,
    'active_prescriptions',people_count,'past_prescriptions',people_count,
    'plan_fingerprint',plan_fingerprint,'executed',execute_seed);
end;
$seed$;

select summary from seed_summary;
commit;
