-- Read-only administrator preflight; no modification or rewriting of clinical data.
-- Run as a trusted operator so RLS cannot hide inconsistent rows.

-- 1. Blocking condition: appointments whose linked care request belongs to a
--    different patient, or whose care_request_id no longer resolves.
select
  a.id as appointment_id,
  a.patient_id as appointment_patient_id,
  a.care_request_id,
  r.patient_id as care_request_patient_id,
  a.status as appointment_status,
  a.scheduled_start,
  case
    when r.id is null then 'missing_care_request'
    when r.patient_id is distinct from a.patient_id then 'patient_mismatch'
    else 'unknown_inconsistency'
  end as reason
from public.appointments as a
left join public.care_requests as r on r.id = a.care_request_id
where a.care_request_id is not null
  and (r.id is null or r.patient_id is distinct from a.patient_id)
order by a.id;

-- 2. Reported only, never rewritten: care requests with no linked appointment.
select
  r.id as care_request_id,
  r.patient_id,
  r.status,
  count(a.id) as appointment_count
from public.care_requests as r
left join public.appointments as a on a.care_request_id = r.id
group by r.id, r.patient_id, r.status
having count(a.id) = 0
order by r.id;

-- 3. Downstream review: care assignments whose care request and appointment
--    describe different patients. This is a separate, unrepaired relationship
--    (reported only) and does not block this migration.
select
  ca.id as care_assignment_id,
  ca.care_request_id,
  r.patient_id as care_request_patient_id,
  ca.appointment_id,
  a.patient_id as appointment_patient_id,
  ca.provider_id,
  ca.status
from public.care_assignments as ca
left join public.care_requests as r on r.id = ca.care_request_id
left join public.appointments as a on a.id = ca.appointment_id
where ca.appointment_id is not null
  and (a.patient_id is distinct from r.patient_id)
order by ca.id;

-- 4. Downstream confirmation: encounters must already agree with their
--    appointment patient (Repair 5). Reported so the intended chain
--    Patient -> Care Request -> Appointment -> Care Encounter is auditable.
select
  e.id as encounter_id,
  e.appointment_id,
  e.patient_id as encounter_patient_id,
  a.patient_id as appointment_patient_id,
  a.care_request_id
from public.care_encounters as e
join public.appointments as a on a.id = e.appointment_id
where e.patient_id is distinct from a.patient_id
order by e.id;