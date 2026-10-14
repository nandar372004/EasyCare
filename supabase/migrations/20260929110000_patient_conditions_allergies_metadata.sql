begin;

set local lock_timeout = '10s';

-- Nullable additions preserve legacy records without inferring clinical facts,
-- coding systems, onset/resolution dates, severity, or verification history.
alter table public.patient_conditions
  add column code_system text,
  add column condition_code text,
  add column severity text,
  add column onset_date date,
  add column resolved_date date,
  add constraint patient_conditions_code_pair_check
    check ((code_system is null) = (condition_code is null)),
  add constraint patient_conditions_code_system_check
    check (code_system is null or length(btrim(code_system)) between 1 and 100),
  add constraint patient_conditions_condition_code_check
    check (condition_code is null or length(btrim(condition_code)) between 1 and 100),
  add constraint patient_conditions_severity_check
    check (severity is null or severity in ('mild', 'moderate', 'severe', 'unknown')),
  add constraint patient_conditions_onset_date_check
    check (onset_date is null or isfinite(onset_date)),
  add constraint patient_conditions_resolved_date_check
    check (resolved_date is null or (isfinite(resolved_date) and status in ('resolved', 'historical'))),
  add constraint patient_conditions_date_order_check
    check (onset_date is null or resolved_date is null or resolved_date >= onset_date);

comment on column public.patient_conditions.code_system is
  'Optional terminology system/version supplied with condition_code. Existing free-text names remain valid.';
comment on column public.patient_conditions.resolved_date is
  'Optional known resolution date for resolved/historical conditions. Legacy resolved records may have no known date.';

alter table public.patient_allergies
  add column allergen_type text,
  add column onset_date date,
  add column verified_by_profile_id uuid references public.profiles(id) on delete restrict,
  add column verified_at timestamptz,
  add constraint patient_allergies_allergen_type_check
    check (allergen_type is null or allergen_type in ('medication', 'food', 'environmental', 'insect', 'latex', 'other', 'unknown')),
  add constraint patient_allergies_onset_date_check
    check (onset_date is null or isfinite(onset_date)),
  add constraint patient_allergies_verification_pair_check
    check ((verified_by_profile_id is null) = (verified_at is null)),
  add constraint patient_allergies_verified_at_check
    check (verified_at is null or isfinite(verified_at));

comment on column public.patient_allergies.verified_by_profile_id is
  'Verifier identity, separate from recorded_by. Null means no verification recorded; legacy records are not auto-verified.';

create index patient_conditions_patient_idx on public.patient_conditions(patient_id);
create index patient_allergies_patient_idx on public.patient_allergies(patient_id);

-- Preserve the existing clinical-read boundaries and role restrictions.
-- Adding verification fields must not let an authenticated author impersonate
-- another verifier, including installations with table-level INSERT grants.
alter policy allergies_provider_create on public.patient_allergies
  with check (
    recorded_by = auth.uid()
    and public.current_profile_role() in ('doctor', 'nurse')
    and public.can_access_patient(patient_id, 'clinical')
    and (verified_by_profile_id is null or verified_by_profile_id = auth.uid())
  );

alter table public.patient_conditions enable row level security;
alter table public.patient_allergies enable row level security;
grant select on table public.patient_conditions, public.patient_allergies to authenticated;
grant insert (
  patient_id, condition_name, status, diagnosed_at, recorded_by, notes,
  code_system, condition_code, severity, onset_date, resolved_date
) on table public.patient_conditions to authenticated;
grant insert (
  patient_id, allergen, reaction, severity, status, recorded_by,
  allergen_type, onset_date, verified_by_profile_id, verified_at
) on table public.patient_allergies to authenticated;

-- No new browser UPDATE/DELETE policies or grants; no changes to other tables.
commit;
