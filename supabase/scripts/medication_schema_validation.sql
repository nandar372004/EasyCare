-- Read-only checks. Run as an authorized database administrator after Phase 7.
-- All queries below should return zero rows. No legacy records are rewritten.

-- Unvalidated medication foreign keys (a clean chain has none).
select conrelid::regclass as table_name, conname
from pg_constraint
where contype = 'f' and not convalidated and conrelid in (
  'public.prescriptions'::regclass, 'public.prescription_items'::regclass,
  'public.patient_medications'::regclass, 'public.medication_schedules'::regclass,
  'public.medication_events'::regclass
);

-- Existing single-column FKs do not guarantee patient consistency across chains.
select e.id as event_id, e.patient_id, m.patient_id as schedule_patient_id
from public.medication_events e
left join public.medication_schedules s on s.id = e.schedule_id
left join public.patient_medications m on m.id = s.patient_medication_id
where m.patient_id is distinct from e.patient_id;

select m.id as medication_id, m.patient_id, p.patient_id as prescription_patient_id
from public.patient_medications m
left join public.prescription_items i on i.id = m.prescription_item_id
left join public.prescriptions p on p.id = i.prescription_id
where m.prescription_item_id is not null and p.patient_id is distinct from m.patient_id;

select p.id as prescription_id, p.patient_id, e.patient_id as encounter_patient_id
from public.prescriptions p
left join public.care_encounters e on e.id = p.encounter_id
where e.patient_id is distinct from p.patient_id;

select m.id as medication_id
from public.patient_medications m
left join public.providers p on p.id = m.prescribing_provider_id
where m.prescribing_provider_id is not null and p.id is null;

select c.oid::regclass as table_without_rls
from pg_class c
where c.oid in ('public.prescriptions'::regclass, 'public.prescription_items'::regclass,
  'public.patient_medications'::regclass, 'public.medication_schedules'::regclass,
  'public.medication_events'::regclass) and not c.relrowsecurity;
