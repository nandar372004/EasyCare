-- Read-only administrator preflight. Provider differences are review candidates;
-- current administrator workflows permit them. Patient mismatches are blockers.
select e.id as encounter_id,e.appointment_id,e.patient_id as encounter_patient_id,
       a.patient_id as appointment_patient_id,e.provider_id as encounter_provider_id,
       a.provider_id as appointment_provider_id,
       (a.id is null or e.patient_id is distinct from a.patient_id) as structural_blocker,
       (e.provider_id is distinct from a.provider_id) as provider_review_required
from public.care_encounters e left join public.appointments a on a.id=e.appointment_id
where a.id is null or e.patient_id is distinct from a.patient_id
   or e.provider_id is distinct from a.provider_id;

select rx.id as prescription_id,rx.patient_id as prescription_patient_id,
       e.id as encounter_id,e.patient_id as encounter_patient_id,
       a.id as appointment_id,a.patient_id as appointment_patient_id
from public.prescriptions rx
left join public.care_encounters e on e.id=rx.encounter_id
left join public.appointments a on a.id=e.appointment_id
where e.id is null or a.id is null or e.patient_id is distinct from a.patient_id
   or rx.patient_id is distinct from e.patient_id;
