-- Read-only administrator preflight for Security Repair 12.
-- Detects patient_medications / prescription_items / prescriptions patient mismatches.
-- Run as a trusted operator so RLS cannot hide inconsistent rows.
-- This script never infers, rewrites, reassigns, or deletes clinical data.

-- 1. The blocking condition: a patient medication whose patient differs from the
--    patient owning the prescription that the referenced item belongs to.
--    Ownership is derived: patient_medications.prescription_item_id
--      -> prescription_items.prescription_id -> prescriptions.patient_id
select
  m.id as patient_medication_id,
  m.patient_id as medication_patient_id,
  m.prescription_item_id,
  i.prescription_id,
  p.patient_id as prescription_patient_id,
  m.status,
  'prescription_patient_mismatch' as reason
from public.patient_medications as m
join public.prescription_items as i on i.id = m.prescription_item_id
join public.prescriptions as p on p.id = i.prescription_id
where m.patient_id is distinct from p.patient_id
order by m.id;

-- 2. Missing referenced prescription item. The pre-existing single-column FK
--    normally prevents this; a non-empty result means that constraint was
--    dropped or bypassed. Listed separately because it is reported, not repaired.
select
  m.id as patient_medication_id,
  m.patient_id as medication_patient_id,
  m.prescription_item_id,
  'missing_prescription_item' as reason
from public.patient_medications as m
where m.prescription_item_id is not null
  and not exists (
    select 1 from public.prescription_items as i where i.id = m.prescription_item_id
  )
order by m.id;

-- 3. Broken prescription ownership chain above this boundary: an item whose
--    owning prescription disagrees with that prescription's care encounter.
--    Repair 1 already prevents creating or reaching this state; reported here
--    for operator awareness because it sits directly above the repaired link.
select
  i.id as prescription_item_id,
  i.prescription_id,
  p.patient_id as prescription_patient_id,
  p.encounter_id,
  e.patient_id as encounter_patient_id,
  'prescription_encounter_patient_mismatch' as reason
from public.prescription_items as i
join public.prescriptions as p on p.id = i.prescription_id
left join public.care_encounters as e on e.id = p.encounter_id
where p.patient_id is distinct from e.patient_id
order by i.id;

-- 4. Suspicious cross-patient medication relationships: a prescribed medication
--    attributed to a different patient than the prescriber's prescription,
--    surfaced through prescribing_provider_id rather than the item link.
select
  m.id as patient_medication_id,
  m.patient_id as medication_patient_id,
  m.prescription_item_id,
  p.id as prescriber_prescription_id,
  p.patient_id as prescriber_prescription_patient_id,
  m.prescribing_provider_id,
  'prescriber_patient_mismatch' as reason
from public.patient_medications as m
join public.prescriptions as p on p.doctor_provider_id = m.prescribing_provider_id
where m.prescribing_provider_id is not null
  and m.patient_id is distinct from p.patient_id
order by m.id;

-- 5. Manual/standalone medication census. These rows have no prescription_item_id
--    and are deliberately preserved by this repair. Reported for awareness only.
select
  count(*) as manual_medication_count
from public.patient_medications
where prescription_item_id is null;