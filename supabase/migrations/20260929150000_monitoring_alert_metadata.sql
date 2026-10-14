begin;
set local lock_timeout = '10s';

alter table public.monitoring_alerts
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists title text,
  add column if not exists rule_code text,
  add column if not exists detected_at timestamptz;

-- Infer only provenance already recorded by an explicit FK. Unclassified
-- historical alerts remain NULL rather than being labelled manual or AI.
update public.monitoring_alerts
set source_type = 'vital', source_id = vital_reading_id
where vital_reading_id is not null and source_type is null and source_id is null;
update public.monitoring_alerts set detected_at = created_at
where detected_at is null and isfinite(created_at);
alter table public.monitoring_alerts alter column detected_at set default statement_timestamp();

alter table public.monitoring_alerts
  add constraint monitoring_alerts_source_type_check check (
    source_type is null or source_type in ('vital','lab','medication','appointment','ai','manual')),
  add constraint monitoring_alerts_source_id_check check (source_id is null or source_type is not null),
  add constraint monitoring_alerts_vital_source_check check (
    vital_reading_id is null or source_type is null or
    (source_type = 'vital' and (source_id is null or source_id = vital_reading_id))),
  add constraint monitoring_alerts_title_check check (title is null or length(btrim(title)) between 1 and 200),
  add constraint monitoring_alerts_rule_code_check check (rule_code is null or length(btrim(rule_code)) between 1 and 100),
  add constraint monitoring_alerts_detected_at_check check (detected_at is null or isfinite(detected_at));

comment on column public.monitoring_alerts.source_id is
  'Optional polymorphic provenance UUID, qualified by source_type. Not a generic FK; producer must validate source existence and patient ownership. Existing vital_reading_id FK is preserved.';
comment on column public.monitoring_alerts.detected_at is
  'Condition detection time. Legacy finite created_at values are used as the best available historical time.';
comment on column public.monitoring_alerts.rule_code is
  'Optional producer rule identifier; metadata only, does not execute a rule or imply medical approval.';
create index monitoring_alerts_source_idx on public.monitoring_alerts(source_type, source_id)
  where source_id is not null;

-- Existing read/insert policies and notification policies remain unchanged.
-- Check the NEW patient too: the old update policy checked only reviewer ID,
-- allowing a reviewer to move an accessible alert to an unauthorized patient.
alter policy alerts_reviewer_update on public.monitoring_alerts
with check (
  public.current_profile_role() in ('doctor','nurse','coordinator','main_admin')
  and public.can_access_patient(patient_id,'alerts')
  and (reviewed_by_profile_id = auth.uid() or public.is_main_admin())
);

commit;
