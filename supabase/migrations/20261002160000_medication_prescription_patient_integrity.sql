begin;
set local lock_timeout = '10s';

-- Stabilize the preflight and validation against concurrent clinical writes.
-- No medication, prescription, item, encounter, or other clinical row is
-- modified, inferred, reassigned, or deleted.
lock table public.patient_medications, public.prescription_items, public.prescriptions in share row exclusive mode;

do $$
declare inconsistent_count bigint;
begin
  select count(*) into inconsistent_count
  from public.patient_medications as m
  left join public.prescription_items as i on i.id = m.prescription_item_id
  left join public.prescriptions as p on p.id = i.prescription_id
  where m.prescription_item_id is not null
    and (i.id is null or p.id is null or m.patient_id is distinct from p.patient_id);

  if inconsistent_count > 0 then
    raise exception 'Medication prescription relationship repair stopped: % inconsistent medication/prescription patient relationships', inconsistent_count
      using errcode = '23514',
            hint = 'Run supabase/scripts/medication_prescription_validation.sql as a trusted operator. Review the reported IDs; do not automatically rewrite clinical data.';
  end if;
end;
$$;

-- prescription_items does NOT store patient_id, so a composite foreign key is
-- not possible without adding a denormalized column and duplicating ownership
-- that already exists on the parent prescription. Ownership is therefore derived
-- through prescriptions and enforced with triggers, as Repair 10 did for
-- medication_schedules/medication_events. No column is added and no existing
-- constraint, policy, privilege, or trigger is altered.
--
-- A NULL prescription_item_id is not checked, so manually entered medications
-- that carry no prescription remain valid and are preserved.
create function public.check_medication_prescription_patient_chain() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  item_patient uuid;
  new_prescription uuid;
begin
  if tg_table_name = 'patient_medications' then
    if new.prescription_item_id is null then
      -- Manual medication with no prescription origin. Nothing to compare.
      return new;
    end if;

    select p.patient_id into item_patient
    from public.prescription_items as i
    join public.prescriptions as p on p.id = i.prescription_id
    where i.id = new.prescription_item_id
    for share of i, p;

    -- A missing item is already rejected by the pre-existing single-column
    -- foreign key with 23503. Defer to it so error codes are unchanged.
    if item_patient is null then
      return new;
    end if;

    if new.patient_id is distinct from item_patient then
      raise exception 'Patient medication prescription mismatch: medication patient % does not match prescription item patient %', new.patient_id, item_patient
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'prescription_items' then
    if new.prescription_id is not distinct from old.prescription_id then
      return new;
    end if;

    select p.patient_id into new_prescription
    from public.prescriptions as p
    where p.id = new.prescription_id
    for share of p;

    -- Unknown prescription: the pre-existing foreign key reports 23503.
    if new_prescription is null then
      return new;
    end if;

    if exists (
      select 1 from public.patient_medications as m
      where m.prescription_item_id = old.id and m.patient_id is distinct from new_prescription
    ) then
      raise exception 'Prescription item reassignment would invalidate patient medication patient ownership'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'prescriptions' then
    if new.patient_id is not distinct from old.patient_id then
      return new;
    end if;

    -- Unknown patient: the pre-existing foreign key reports 23503. Repair 1's
    -- prescriptions_encounter_patient_fk also still guards the encounter link;
    -- neither is weakened or duplicated here.
    if not exists (select 1 from public.patients as pt where pt.id = new.patient_id) then
      return new;
    end if;

    if exists (
      select 1
      from public.prescription_items as i
      join public.patient_medications as m on m.prescription_item_id = i.id
      where i.prescription_id = old.id and m.patient_id is distinct from new.patient_id
    ) then
      raise exception 'Prescription patient reassignment would invalidate patient medication patient ownership'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.check_medication_prescription_patient_chain() from public, anon, authenticated;

-- Child side: INSERT and UPDATE of either the patient or the item link.
-- This is the boundary the audit finding targeted. It composes with Repair 10's
-- existing patient_medications_parent_guard; both triggers remain in place.
create trigger patient_medications_prescription_guard
  before insert or update of prescription_item_id, patient_id
  on public.patient_medications
  for each row execute function public.check_medication_prescription_patient_chain();

-- Parent side: re-pointing an item at a different prescription, or moving a
-- prescription to a different patient, must not strand an inconsistent medication.
create trigger prescription_items_prescription_guard
  before update of prescription_id
  on public.prescription_items
  for each row execute function public.check_medication_prescription_patient_chain();

create trigger prescriptions_medication_guard
  before update of patient_id
  on public.prescriptions
  for each row execute function public.check_medication_prescription_patient_chain();

-- Supporting lookup for the child-side check on prescribed medications.
create index patient_medications_prescription_item_idx
  on public.patient_medications(prescription_item_id)
  where prescription_item_id is not null;

-- No authorization change. patient_medications_read_own and the
-- prescription_items policies are untouched, and Repair 3's restrictive
-- clinical_identity_required policies remain in force. There is still no
-- INSERT/UPDATE policy or privilege on patient_medications for authenticated
-- callers; this repair adds none. No policy, grant, or helper is broadened.
commit;