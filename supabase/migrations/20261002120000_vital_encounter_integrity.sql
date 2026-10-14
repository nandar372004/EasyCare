begin;
set local lock_timeout = '10s';

-- Stabilize preflight against concurrent clinical writes. No vital, encounter,
-- alert, or other clinical row is modified, inferred, or deleted.
lock table public.care_encounters, public.vital_readings in share row exclusive mode;

do $$
declare inconsistent_count bigint;
begin
  select count(*) into inconsistent_count
  from public.vital_readings as vital
  left join public.care_encounters as encounter on encounter.id = vital.encounter_id
  where vital.encounter_id is not null
    and (encounter.id is null or vital.patient_id is distinct from encounter.patient_id);
  if inconsistent_count > 0 then
    raise exception 'Vital relationship repair stopped: % inconsistent encounter/patient relationships', inconsistent_count
      using errcode = '23514',
            hint = 'Run supabase/scripts/vital_encounter_validation.sql as a trusted operator. Review the reported IDs; do not automatically rewrite clinical data.';
  end if;
end;
$$;

-- Reuse care_encounters_id_patient_key. MATCH SIMPLE keeps encounter_id NULL
-- standalone vitals valid; patient_id remains NOT NULL. Existing single-column
-- FKs are retained. INSERT/UPDATE and parent patient moves are enforced even
-- with RLS bypass.
alter table public.vital_readings
  add constraint vital_readings_encounter_patient_fk
  foreign key (encounter_id, patient_id)
  references public.care_encounters(id, patient_id)
  match simple
  on update restrict on delete restrict;

create index vital_readings_encounter_patient_idx
  on public.vital_readings(encounter_id, patient_id)
  where encounter_id is not null;

-- No authorization change: vitals_read, vitals_assigned_create, and Repair 3's
-- restrictive clinical_identity_required remain the access model. No client
-- UPDATE/DELETE privilege is added.
commit;
