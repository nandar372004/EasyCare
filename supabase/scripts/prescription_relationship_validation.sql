-- Read-only preflight. Run as a trusted database operator so RLS cannot hide
-- inconsistent rows. Results contain identifiers only, not clinical content.
-- Must return zero rows before applying the relationship repair migration.
select rx.id as prescription_id,
       rx.encounter_id,
       rx.patient_id as prescription_patient_id,
       encounter.patient_id as encounter_patient_id
from public.prescriptions as rx
left join public.care_encounters as encounter on encounter.id = rx.encounter_id
left join public.patients as patient on patient.id = rx.patient_id
where encounter.id is null
   or patient.id is null
   or rx.patient_id is distinct from encounter.patient_id
order by rx.id;

-- Separate attribution review: these rows do not match the existing browser
-- prescribing rule (the doctor must own the referenced encounter). Report for
-- clinical review; never automatically reassign a historical prescription.
select rx.id as prescription_id, rx.encounter_id,
       rx.doctor_provider_id as prescribing_provider_id,
       encounter.provider_id as encounter_provider_id
from public.prescriptions as rx
join public.care_encounters as encounter on encounter.id = rx.encounter_id
left join public.providers as provider on provider.id = rx.doctor_provider_id
where provider.id is null
   or rx.doctor_provider_id is distinct from encounter.provider_id
order by rx.id;
