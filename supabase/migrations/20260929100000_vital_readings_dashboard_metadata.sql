begin;

set local lock_timeout = '10s';

-- Keep existing measurements and their units: spo2 (%), temperature_c (C),
-- glucose_mg_dl (mg/dL). Do not create competing measurement columns.
-- source already stores manual/provider/device. Expose the dashboard name as
-- a generated alias so existing writers work and the two names cannot diverge.
alter table public.vital_readings
  add column measurement_context text,
  add column source_type public.vital_source generated always as (source) stored,
  add constraint vital_readings_measurement_context_check
    check (measurement_context is null or length(btrim(measurement_context)) between 1 and 500);

comment on column public.vital_readings.measurement_context is
  'Optional measurement circumstances, e.g. resting, fasting, or after exercise. Not an AI interpretation.';
comment on column public.vital_readings.source_type is
  'Read-only dashboard alias of source (manual/provider/device). Inserts continue to supply source.';

-- Preserve all historical data, including anomalies. NOT VALID enforces these
-- checks for new inserts/updates without rejecting the migration for old rows.
-- No diagnosis thresholds: reject non-finite values and physically invalid
-- measurements only. Existing blood-pressure, heart-rate and spo2 checks stay.
alter table public.vital_readings
  add constraint vital_readings_temperature_finite_check
    check (temperature_c is null or (temperature_c > -273.15 and temperature_c < 'Infinity'::numeric)) not valid,
  add constraint vital_readings_glucose_finite_check
    check (glucose_mg_dl is null or (glucose_mg_dl >= 0 and glucose_mg_dl < 'Infinity'::numeric)) not valid,
  add constraint vital_readings_weight_finite_check
    check (weight_kg is null or weight_kg < 'Infinity'::numeric) not valid,
  add constraint vital_readings_recorded_at_finite_check
    check (isfinite(recorded_at)) not valid;

-- Validate clean historical columns; leave only anomalous columns NOT VALID.
-- Report counts without exposing patient data. Resolve anomalies separately.
do $$
declare
  rule record;
  invalid_count bigint;
begin
  for rule in select * from (values
    ('vital_readings_temperature_finite_check', 'temperature_c is not null and not (temperature_c > -273.15 and temperature_c < ''Infinity''::numeric)'),
    ('vital_readings_glucose_finite_check', 'glucose_mg_dl is not null and not (glucose_mg_dl >= 0 and glucose_mg_dl < ''Infinity''::numeric)'),
    ('vital_readings_weight_finite_check', 'weight_kg is not null and not (weight_kg < ''Infinity''::numeric)'),
    ('vital_readings_recorded_at_finite_check', 'not isfinite(recorded_at)')
  ) as rules(constraint_name, invalid_predicate)
  loop
    execute format('select count(*) from public.vital_readings where %s', rule.invalid_predicate) into invalid_count;
    if invalid_count = 0 then
      execute format('alter table public.vital_readings validate constraint %I', rule.constraint_name);
    else
      raise notice '% left NOT VALID: % historical rows require review; no data changed', rule.constraint_name, invalid_count;
    end if;
  end loop;
end
$$;

-- Already provided by the original clinical migration:
-- vital_readings_patient_recorded_idx (patient_id, recorded_at DESC).
-- Reuse it for latest/history queries; do not add a duplicate index.
-- patient_devices does not exist in the migration chain: defer device_id.

-- Keep vitals_read and vitals_assigned_create unchanged. Explicit privileges
-- make them usable even where Supabase table defaults do not supply grants.
-- RLS still controls patient/authorized-clinician reads and clinician inserts.
alter table public.vital_readings enable row level security;
grant select on table public.vital_readings to authenticated;
grant insert (
  patient_id, encounter_id, recorded_by_profile_id, source,
  systolic_bp, diastolic_bp, heart_rate, spo2, temperature_c, glucose_mg_dl,
  weight_kg, recorded_at, notes, measurement_context
) on table public.vital_readings to authenticated;

commit;
