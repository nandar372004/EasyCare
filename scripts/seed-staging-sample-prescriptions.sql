-- Staging-only, fail-closed demo prescription seed.
-- Requires exactly one patient clearly marked demo/synthetic/sample/test and
-- an existing encounter for that patient with one of the seeded verified
-- synthetic doctors. It never creates or modifies patients, providers,
-- encounters, appointments, schema, grants, or RLS policies.
-- Safe to rerun: stable IDs are inserted only when absent; existing rows are
-- validated and never overwritten.

begin;
set local lock_timeout = '10s';

lock table public.patients, public.providers, public.care_encounters in share mode;
lock table public.prescriptions, public.prescription_items in share row exclusive mode;

do $seed$
declare
  target_patient uuid;
  target_encounter uuid;
  target_provider uuid;
  candidate_count integer;
  expected_patient uuid := '65000000-0000-4000-8000-000000000001';
  expected_patient_2 uuid := '65000000-0000-4000-8000-000000000002';
  expected_patient_3 uuid := '65000000-0000-4000-8000-000000000003';
  expected_item_1 uuid := '65100000-0000-4000-8000-000000000001';
  expected_item_2 uuid := '65100000-0000-4000-8000-000000000002';
  expected_item_3 uuid := '65100000-0000-4000-8000-000000000003';
  expected_item_4 uuid := '65100000-0000-4000-8000-000000000004';
begin
  if not (select relrowsecurity from pg_class where oid='public.prescriptions'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.prescription_items'::regclass) then
    raise exception 'Expected prescription RLS enabled; refusing seed.';
  end if;

  if exists (
    select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
    join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typname='prescription_status'
      and e.enumlabel in ('active','completed')
    group by t.oid having count(distinct e.enumlabel) < 2
  ) or not exists (
    select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
    join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typname='prescription_status' and e.enumlabel='active'
  ) or not exists (
    select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
    join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typname='prescription_status' and e.enumlabel='completed'
  ) then
    raise exception 'Required active/completed prescription statuses are unavailable; refusing seed.';
  end if;

  select count(distinct pt.id)
    into candidate_count
  from public.patients pt
  join public.care_encounters ce on ce.patient_id=pt.id
  join public.providers pr on pr.id=ce.provider_id
  where (lower(coalesce(pt.full_name,'')) ~ '(demo|synthetic|sample|test patient)'
         or lower(coalesce(pt.email,'')) ~ '(demo|synthetic|sample|test|example\\.com|example\\.test)')
    and pr.id in (
      '52000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000002',
      '52000000-0000-4000-8000-000000000003','52000000-0000-4000-8000-000000000004',
      '52000000-0000-4000-8000-000000000005','52000000-0000-4000-8000-000000000006'
    )
    and pr.provider_type='doctor' and pr.verification_status='verified';

  if candidate_count <> 1 then
    raise exception 'Expected exactly one clearly synthetic patient with an existing synthetic-doctor encounter; found %. No rows written.', candidate_count;
  end if;

  select pt.id, ce.id, pr.id
    into target_patient, target_encounter, target_provider
  from public.patients pt
  join public.care_encounters ce on ce.patient_id=pt.id
  join public.providers pr on pr.id=ce.provider_id
  where (lower(coalesce(pt.full_name,'')) ~ '(demo|synthetic|sample|test patient)'
         or lower(coalesce(pt.email,'')) ~ '(demo|synthetic|sample|test|example\\.com|example\\.test)')
    and pr.id in (
      '52000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000002',
      '52000000-0000-4000-8000-000000000003','52000000-0000-4000-8000-000000000004',
      '52000000-0000-4000-8000-000000000005','52000000-0000-4000-8000-000000000006'
    )
    and pr.provider_type='doctor' and pr.verification_status='verified'
  order by ce.id
  limit 1;

  if exists (select 1 from public.prescriptions where id in (expected_patient,expected_patient_2,expected_patient_3))
     or exists (select 1 from public.prescription_items where id in (expected_item_1,expected_item_2,expected_item_3,expected_item_4)) then
    if exists (
      select 1 from public.prescriptions p
      where p.id in (expected_patient,expected_patient_2,expected_patient_3)
        and (p.patient_id<>target_patient or p.doctor_provider_id<>target_provider or p.encounter_id<>target_encounter
          or p.status<>case p.id when expected_patient then 'active'::public.prescription_status
                                 when expected_patient_2 then 'active'::public.prescription_status
                                 else 'completed'::public.prescription_status end
          or p.instructions<>'SYNTHETIC DEMO DATA — sample prescription for UI demonstration.'
          or p.issued_at<>case p.id
              when expected_patient then timestamp '2026-10-20 09:00:00' at time zone 'Asia/Yangon'
              when expected_patient_2 then timestamp '2026-10-08 09:00:00' at time zone 'Asia/Yangon'
              else timestamp '2026-09-15 09:00:00' at time zone 'Asia/Yangon' end)
    ) or exists (
      select 1 from public.prescription_items i
      join public.prescriptions p on p.id=i.prescription_id
      where i.id in (expected_item_1,expected_item_2,expected_item_3,expected_item_4)
        and (p.patient_id<>target_patient or
          (i.id=expected_item_1 and (i.prescription_id<>expected_patient or i.medication_name<>'Amoxicillin' or i.strength<>'500 mg' or i.dose<>'1 capsule' or i.route<>'oral' or i.frequency<>'3 times daily' or i.duration_days<>5 or i.instructions<>'Take after meals. Complete the full course as prescribed.')) or
          (i.id=expected_item_2 and (i.prescription_id<>expected_patient or i.medication_name<>'Paracetamol' or i.strength<>'500 mg' or i.dose<>'1 tablet' or i.route<>'oral' or i.frequency<>'Twice daily as needed' or i.duration_days<>3 or i.instructions<>'Take after meals.')) or
          (i.id=expected_item_3 and (i.prescription_id<>expected_patient_2 or i.medication_name<>'Cetirizine' or i.strength<>'10 mg' or i.dose<>'1 tablet' or i.route<>'oral' or i.frequency<>'Once daily' or i.duration_days<>7 or i.instructions<>'Take in the evening.')) or
          (i.id=expected_item_4 and (i.prescription_id<>expected_patient_3 or i.medication_name<>'Omeprazole' or i.strength<>'20 mg' or i.dose<>'1 capsule' or i.route<>'oral' or i.frequency<>'Once daily' or i.duration_days<>14 or i.instructions<>'Take 30 minutes before breakfast.')))
    ) then
      raise exception 'Stable demo seed IDs already contain different data; refusing to overwrite.';
    end if;
  end if;

  insert into public.prescriptions (id,encounter_id,patient_id,doctor_provider_id,status,instructions,issued_at)
  values
    (expected_patient,target_encounter,target_patient,target_provider,'active','SYNTHETIC DEMO DATA — sample prescription for UI demonstration.',timestamp '2026-10-20 09:00:00' at time zone 'Asia/Yangon'),
    (expected_patient_2,target_encounter,target_patient,target_provider,'active','SYNTHETIC DEMO DATA — sample prescription for UI demonstration.',timestamp '2026-10-08 09:00:00' at time zone 'Asia/Yangon'),
    (expected_patient_3,target_encounter,target_patient,target_provider,'completed','SYNTHETIC DEMO DATA — sample prescription for UI demonstration.',timestamp '2026-09-15 09:00:00' at time zone 'Asia/Yangon')
  on conflict (id) do nothing;

  insert into public.prescription_items (id,prescription_id,medication_name,strength,dose,route,frequency,duration_days,instructions)
  values
    (expected_item_1,expected_patient,'Amoxicillin','500 mg','1 capsule','oral','3 times daily',5,'Take after meals. Complete the full course as prescribed.'),
    (expected_item_2,expected_patient,'Paracetamol','500 mg','1 tablet','oral','Twice daily as needed',3,'Take after meals.'),
    (expected_item_3,expected_patient_2,'Cetirizine','10 mg','1 tablet','oral','Once daily',7,'Take in the evening.'),
    (expected_item_4,expected_patient_3,'Omeprazole','20 mg','1 capsule','oral','Once daily',14,'Take 30 minutes before breakfast.')
  on conflict (id) do nothing;

  if (select count(*) from public.prescriptions where id in (expected_patient,expected_patient_2,expected_patient_3))<>3
     or (select count(*) from public.prescription_items where id in (expected_item_1,expected_item_2,expected_item_3,expected_item_4))<>4 then
    raise exception 'Post-seed verification failed; rolling back.';
  end if;

  if exists (
    select 1 from public.prescription_items i
    join public.prescriptions p on p.id=i.prescription_id
    where i.id in (expected_item_1,expected_item_2,expected_item_3,expected_item_4)
      and (p.patient_id<>target_patient or p.doctor_provider_id<>target_provider or p.encounter_id<>target_encounter)
  ) then
    raise exception 'Demo prescription ownership verification failed; rolling back.';
  end if;
end;
$seed$;

commit;
