-- Read-only administrator preflight; no inference or rewriting of clinical identity.
-- Run as a trusted operator so RLS cannot hide inconsistent rows.

select
  vital.id as vital_reading_id,
  vital.patient_id as vital_patient_id,
  vital.encounter_id,
  encounter.patient_id as encounter_patient_id,
  case
    when encounter.id is null then 'missing_encounter'
    else 'patient_mismatch'
  end as reason
from public.vital_readings as vital
left join public.care_encounters as encounter on encounter.id = vital.encounter_id
where vital.encounter_id is not null
  and (encounter.id is null or vital.patient_id is distinct from encounter.patient_id)
order by vital.id;

-- Direct downstream FK references. Also report independently inconsistent alert
-- patient links for review; this repair does not rewrite or constrain alerts.
select
  alert.id as alert_id,
  alert.patient_id as alert_patient_id,
  alert.vital_reading_id,
  vital.patient_id as vital_patient_id,
  vital.encounter_id,
  encounter.patient_id as encounter_patient_id
from public.monitoring_alerts as alert
left join public.vital_readings as vital on vital.id = alert.vital_reading_id
left join public.care_encounters as encounter on encounter.id = vital.encounter_id
where alert.vital_reading_id is not null
  and (
    vital.id is null
    or alert.patient_id is distinct from vital.patient_id
    or (
      vital.encounter_id is not null
      and (encounter.id is null or vital.patient_id is distinct from encounter.patient_id)
    )
  )
order by alert.id;
