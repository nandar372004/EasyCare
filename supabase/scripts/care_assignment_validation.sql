-- Read-only administrator preflight; no modification or rewriting of clinical data.
-- Run as a trusted operator so RLS cannot hide inconsistent rows.

-- 1. Blocking condition: a care assignment whose linked appointment belongs to a
--    different patient than its care request, or whose chain no longer resolves.
select
  a.id as care_assignment_id,
  a.care_request_id,
  r.patient_id as care_request_patient_id,
  a.appointment_id,
  p.patient_id as appointment_patient_id,
  a.provider_id,
  a.status,
  case
    when r.id is null then 'missing_care_request'
    when p.id is null then 'missing_appointment'
    when r.patient_id is distinct from p.patient_id then 'patient_mismatch'
    else 'unknown_inconsistency'
  end as reason
from public.care_assignments as a
left join public.care_requests as r on r.id = a.care_request_id
left join public.appointments as p on p.id = a.appointment_id
where a.appointment_id is not null
  and (r.id is null or p.id is null or r.patient_id is distinct from p.patient_id)
order by a.id;

-- 2. Reported only: assignments still awaiting an appointment. These are a legitimate
--    coordinator matching state and are not touched by this migration.
select
  a.id as care_assignment_id,
  a.care_request_id,
  r.patient_id,
  a.provider_id,
  a.status,
  a.assigned_at
from public.care_assignments as a
join public.care_requests as r on r.id = a.care_request_id
where a.appointment_id is null
order by a.id;

-- 3. Reported only: several assignments pointing at one appointment. Useful for
--    coordinator review; the repaired invariant is same-patient, not single-assignment.
select
  a.appointment_id,
  p.patient_id as appointment_patient_id,
  count(*) as assignment_count,
  array_agg(a.care_request_id order by a.care_request_id) as care_request_ids
from public.care_assignments as a
join public.appointments as p on p.id = a.appointment_id
where a.appointment_id is not null
group by a.appointment_id, p.patient_id
having count(*) > 1
order by a.appointment_id;

-- 4. Downstream confirmation (Repair 5): encounters attached to the appointment of a
--    care assignment must already agree on the patient, so the chain
--    Patient -> Care Request -> Care Assignment -> Appointment -> Care Encounter holds.
select
  e.id as encounter_id,
  e.appointment_id,
  e.patient_id as encounter_patient_id,
  p.patient_id as appointment_patient_id,
  r.patient_id as care_request_patient_id
from public.care_assignments as a
join public.appointments as p on p.id = a.appointment_id
join public.care_requests as r on r.id = a.care_request_id
join public.care_encounters as e on e.appointment_id = a.appointment_id
where e.patient_id is distinct from p.patient_id
   or r.patient_id is distinct from p.patient_id
order by e.id;