begin;
set local lock_timeout = '10s';

-- Stabilize the preflight and validation against concurrent clinical writes.
-- No alert, vital, patient, encounter, or other clinical row is modified,
-- inferred, reassigned, or deleted.
lock table public.monitoring_alerts, public.vital_readings in share row exclusive mode;

do $$
declare inconsistent_count bigint;
begin
  select count(*) into inconsistent_count
  from public.monitoring_alerts as alert_row
  left join public.vital_readings as vital on vital.id = alert_row.vital_reading_id
  where alert_row.vital_reading_id is not null
    and (vital.id is null or alert_row.patient_id is distinct from vital.patient_id);

  if inconsistent_count > 0 then
    raise exception 'Monitoring alert relationship repair stopped: % inconsistent alert/vital patient relationships', inconsistent_count
      using errcode = '23514',
            hint = 'Run supabase/scripts/monitoring_alert_vital_validation.sql as a trusted operator. Review the reported IDs; do not automatically rewrite clinical data.';
  end if;
end;
$$;

-- vital_readings already stores patient_id as NOT NULL, so ownership is
-- directly available on the parent. Declare the composite key the new foreign
-- key references. This is redundant with the existing primary key on id alone
-- (no existing row can be removed or duplicated) and changes no data.
alter table public.vital_readings
  add constraint vital_readings_id_patient_key unique (id, patient_id);

-- Declarative relational integrity. MATCH SIMPLE means a NULL vital_reading_id
-- is not checked, so standalone alerts that carry no vital reading remain
-- valid and are preserved. When vital_reading_id IS NOT NULL, the referenced
-- vital's patient must equal the alert's patient.
--
-- This constraint is enforced for INSERT, UPDATE, service_role writes, and
-- direct SQL regardless of RLS, and it also blocks re-pointing a referenced
-- vital_reading at a different patient while an alert references it.
-- The existing single-column vital_reading_id foreign key is retained.
alter table public.monitoring_alerts
  add constraint monitoring_alerts_vital_patient_fk
  foreign key (vital_reading_id, patient_id)
  references public.vital_readings(id, patient_id)
  match simple
  on update restrict on delete restrict;

-- Supports the foreign key and the alert-to-vital lookup used by the dashboard.
create index monitoring_alerts_vital_patient_idx
  on public.monitoring_alerts(vital_reading_id, patient_id)
  where vital_reading_id is not null;

-- No authorization change. alerts_read, alerts_provider_create and the
-- already-widened alerts_reviewer_update keep the existing access model, and
-- Repair 3's restrictive clinical_identity_required policy is untouched. The
-- reviewer policy already checks the NEW patient_id, so no policy is broadened.
-- This repair adds no privilege, no policy, and no trigger.
commit;
