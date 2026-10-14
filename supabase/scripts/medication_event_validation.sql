-- Read-only administrator preflight; no modification or rewriting of clinical data.
-- Run as a trusted operator so RLS cannot hide inconsistent rows.

select
  e.id as event_id,
  e.patient_id as event_patient_id,
  e.schedule_id,
  m.patient_id as schedule_patient_id,
  e.status,
  e.scheduled_at,
  case
    when s.id is null then 'missing_schedule'
    when m.id is null then 'missing_patient_medication'
    when m.patient_id is distinct from e.patient_id then 'patient_mismatch'
    else 'unknown_inconsistency'
  end as reason
from public.medication_events as e
left join public.medication_schedules as s on s.id = e.schedule_id
left join public.patient_medications as m on m.id = s.patient_medication_id
where s.id is null or m.id is null or m.patient_id is distinct from e.patient_id
order by e.id;

-- Also report any upstream prescription/patient_medication mismatches for review
select
  m.id as patient_medication_id,
  m.patient_id as medication_patient_id,
  m.prescription_item_id,
  p.patient_id as prescription_patient_id,
  case
    when i.id is null then 'missing_prescription_item'
    when p.id is null then 'missing_prescription'
    when p.patient_id is distinct from m.patient_id then 'prescription_patient_mismatch'
  end as review_reason
from public.patient_medications as m
left join public.prescription_items as i on i.id = m.prescription_item_id
left join public.prescriptions as p on p.id = i.prescription_id
where m.prescription_item_id is not null and (
  i.id is null or p.id is null or p.patient_id is distinct from m.patient_id
)
order by m.id;
