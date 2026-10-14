begin;
set local lock_timeout = '10s';

-- Stabilize the preflight and validation against concurrent clinical writes.
-- No clinical row is modified, inferred, reassigned, or deleted.
lock table public.care_encounters, public.prescriptions in share row exclusive mode;

do $$
declare inconsistent_count bigint;
begin
  select count(*) into inconsistent_count
  from public.prescriptions as rx
  left join public.care_encounters as encounter on encounter.id = rx.encounter_id
  where encounter.id is null
     or rx.patient_id is distinct from encounter.patient_id;
  if inconsistent_count > 0 then
    raise exception 'Prescription relationship repair stopped: % inconsistent prescription/encounter patient relationships', inconsistent_count
      using errcode = '23514',
            hint = 'Run supabase/scripts/prescription_relationship_validation.sql as a trusted operator. Review the reported IDs; do not automatically rewrite clinical data.';
  end if;
end;
$$;

-- Reuse care_encounters_id_patient_key from the laboratory migration.
-- This FK covers INSERT and UPDATE, even with RLS bypass, and rejects changes
-- to the parent patient while referenced. Existing individual FKs are retained.
alter table public.prescriptions
  add constraint prescriptions_encounter_patient_fk
  foreign key (encounter_id, patient_id)
  references public.care_encounters(id, patient_id)
  on update restrict on delete restrict;

create index prescriptions_encounter_patient_idx
  on public.prescriptions(encounter_id, patient_id);

-- Qualify ALL outer references: the old e.patient_id = patient_id expression
-- resolved both sides to the inner encounter. Keep the existing doctor role,
-- provider ownership and encounter-provider authorization model.
alter policy prescriptions_doctor_create on public.prescriptions
with check (
  public.current_profile_role() = 'doctor'
  and exists (
    select 1
    from public.providers as provider
    join public.care_encounters as encounter on encounter.provider_id = provider.id
    where provider.id = prescriptions.doctor_provider_id
      and provider.profile_id = auth.uid()
      and encounter.id = prescriptions.encounter_id
      and encounter.patient_id = prescriptions.patient_id
  )
);

-- Preserve prescriptions_read and prescription_items policies. No new UPDATE
-- policy or privilege: ordinary users remain unable to update prescriptions;
-- trusted updates must satisfy the new FK, just like trusted inserts.
commit;
