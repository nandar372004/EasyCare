-- Read-only administrator preflight; no modification or rewriting of governance data.
-- Run as a trusted operator so RLS cannot hide inconsistent rows.

-- 1. Blocking condition: a complaint linked to an appointment that no longer
--    resolves, or whose patient differs from the appointment's patient.
select
  c.id as complaint_id,
  c.patient_id as complaint_patient_id,
  c.appointment_id,
  a.patient_id as appointment_patient_id,
  c.submitted_by_profile_id,
  c.status,
  c.created_at,
  case
    when a.id is null then 'missing_appointment'
    when c.patient_id is distinct from a.patient_id then 'patient_mismatch'
    else 'unknown_inconsistency'
  end as reason
from public.complaints as c
left join public.appointments as a on a.id = c.appointment_id
where c.appointment_id is not null
  and (a.id is null or c.patient_id is distinct from a.patient_id)
order by c.id;

-- 2. Reported only, not blocking: a complaint linked to an appointment but carrying
--    no patient_id. MATCH SIMPLE does not evaluate the composite key when the child
--    patient_id is NULL, so the link is structurally incomplete rather than
--    cross-patient. Reviewed here; deliberately not changed by this migration.
select
  c.id as complaint_id,
  c.patient_id,
  c.appointment_id,
  a.patient_id as appointment_patient_id,
  c.submitted_by_profile_id,
  c.status
from public.complaints as c
join public.appointments as a on a.id = c.appointment_id
where c.appointment_id is not null and c.patient_id is null
order by c.id;

-- 3. Reported only: standalone complaints, which remain a supported shape.
select
  case
    when c.appointment_id is null and c.patient_id is null then 'general_complaint'
    when c.appointment_id is null then 'patient_complaint_without_appointment'
    else 'appointment_complaint'
  end as complaint_shape,
  count(*) as complaint_count
from public.complaints as c
group by 1
order by 1;

-- 4. Downstream confirmation (Repair 5): encounters under a complained-about
--    appointment must already agree on the patient, so the chain
--    Patient -> Appointment -> Care Encounter -> Complaint stays auditable.
select
  e.id as encounter_id,
  e.appointment_id,
  e.patient_id as encounter_patient_id,
  a.patient_id as appointment_patient_id,
  c.id as complaint_id,
  c.patient_id as complaint_patient_id
from public.complaints as c
join public.appointments as a on a.id = c.appointment_id
join public.care_encounters as e on e.appointment_id = a.id
where c.patient_id is not null and e.patient_id is distinct from a.patient_id
order by e.id;