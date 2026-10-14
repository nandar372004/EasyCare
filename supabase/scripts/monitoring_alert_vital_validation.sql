-- Read-only administrator preflight for Security Repair 11.
-- Detects cross-patient monitoring_alerts/vital_readings relationships.
-- Run as a trusted operator so RLS cannot hide inconsistent rows.
-- This script never infers, rewrites, reassigns, or deletes clinical data.

-- 1. The blocking condition: an alert whose patient differs from the patient
--    that owns the vital reading it references. These rows are what the new
--    composite foreign key would reject.
select
  alert_row.id as alert_id,
  alert_row.patient_id as alert_patient_id,
  alert_row.vital_reading_id,
  vital.patient_id as vital_patient_id,
  alert_row.source_type,
  alert_row.source_id,
  alert_row.status,
  alert_row.created_at,
  'patient_mismatch' as reason
from public.monitoring_alerts as alert_row
join public.vital_readings as vital on vital.id = alert_row.vital_reading_id
where alert_row.patient_id is distinct from vital.patient_id
order by alert_row.id;

-- 2. Missing referenced vital readings. The pre-existing single-column FK
--    normally prevents this, so a non-empty result means the constraint was
--    dropped or bypassed. Listed separately because the composite foreign key
--    also rejects these rows.
select
  alert_row.id as alert_id,
  alert_row.patient_id as alert_patient_id,
  alert_row.vital_reading_id,
  'missing_vital_reading' as reason
from public.monitoring_alerts as alert_row
where alert_row.vital_reading_id is not null
  and not exists (
    select 1
    from public.vital_readings as vital
    where vital.id = alert_row.vital_reading_id
  )
order by alert_row.id;

-- 3. Suspicious polymorphic provenance: source_type='vital' with a source_id
--    that resolves to a vital reading owned by a different patient. This is
--    metadata only and is not constrained by this repair, but it can surface a
--    cross-patient clinical relationship recorded outside vital_reading_id.
select
  alert_row.id as alert_id,
  alert_row.patient_id as alert_patient_id,
  alert_row.vital_reading_id,
  alert_row.source_type,
  alert_row.source_id,
  vital.patient_id as source_vital_patient_id,
  'vital_source_patient_mismatch' as reason
from public.monitoring_alerts as alert_row
join public.vital_readings as vital on vital.id = alert_row.source_id
where alert_row.source_type = 'vital'
  and alert_row.patient_id is distinct from vital.patient_id
order by alert_row.id;

-- 4. Standalone alert census. These rows legitimately have no vital_reading_id
--    and are preserved by MATCH SIMPLE. Reported for operator awareness only.
select
  count(*) as standalone_alert_count
from public.monitoring_alerts
where vital_reading_id is null;
