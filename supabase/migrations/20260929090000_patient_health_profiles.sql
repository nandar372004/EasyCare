begin;

-- Phase 2: optional baseline health information, separate from login identity.
-- patients.blood_type remains canonical: registration and settings already
-- read/write it. Do not copy it or patients.care_preferences into this table.
-- No empty profiles are inferred/backfilled; trusted server code can create
-- a row when baseline information is available.
create table public.patient_health_profiles (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null unique references public.patients(id) on delete restrict,
  height_cm numeric(5,2),
  baseline_weight_kg numeric(6,2),
  smoking_status text not null default 'unknown',
  alcohol_use text not null default 'unknown',
  pregnancy_status text not null default 'unknown',
  primary_physician_id uuid references public.providers(id) on delete restrict,
  preferred_clinic_id uuid references public.partner_clinics(id) on delete restrict,
  last_health_review_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint patient_health_profiles_height_check
    check (height_cm > 0 and height_cm < 'Infinity'::numeric),
  constraint patient_health_profiles_weight_check
    check (baseline_weight_kg > 0 and baseline_weight_kg < 'Infinity'::numeric),
  constraint patient_health_profiles_smoking_status_check
    check (smoking_status in ('never', 'former', 'current', 'unknown')),
  constraint patient_health_profiles_alcohol_use_check
    check (alcohol_use in ('none', 'former', 'current', 'unknown')),
  constraint patient_health_profiles_pregnancy_status_check
    check (pregnancy_status in ('pregnant', 'not_pregnant', 'not_applicable', 'unknown')),
  constraint patient_health_profiles_review_time_check
    check (last_health_review_at is null or isfinite(last_health_review_at))
);

comment on table public.patient_health_profiles is
  'Optional patient baseline health data. Canonical blood type remains patients.blood_type. Browser access is read-only.';
comment on column public.patient_health_profiles.smoking_status is
  'Reported tobacco use: never, former, current, or unknown; unknown is not a negative finding.';
comment on column public.patient_health_profiles.alcohol_use is
  'Reported alcohol use: none, former, current, or unknown; no amount or risk level is inferred.';
comment on column public.patient_health_profiles.pregnancy_status is
  'Recorded status, not inferred from demographic fields; unknown is not a negative finding.';

-- The PK and patient_id UNIQUE constraint already index profile lookup.
-- Partial FK indexes support provider/clinic lookups and reference checks
-- without indexing the potentially numerous unassigned (NULL) relationships.
create index patient_health_profiles_physician_idx
  on public.patient_health_profiles(primary_physician_id)
  where primary_physician_id is not null;
create index patient_health_profiles_clinic_idx
  on public.patient_health_profiles(preferred_clinic_id)
  where preferred_clinic_id is not null;

create trigger patient_health_profiles_updated_at
before update on public.patient_health_profiles
for each row execute function public.set_updated_at();

alter table public.patient_health_profiles enable row level security;

-- Same clinical-read boundary as conditions, allergies, and vital readings:
-- owner, explicitly authorized family, assigned verified providers, main admin.
-- The helper does not grant 'clinical' access to coordinators/clinic admins
-- merely because of their role. No role-wide patient-data access is added.
create policy patient_health_profiles_read_authorized
on public.patient_health_profiles for select to authenticated
using (public.can_access_patient(patient_id, 'clinical'));

-- Explicit grants prevent inherited/default grants exposing browser writes.
revoke all on table public.patient_health_profiles from public, anon, authenticated;
grant select on table public.patient_health_profiles to authenticated;
grant select, insert, update on table public.patient_health_profiles to service_role;

commit;
