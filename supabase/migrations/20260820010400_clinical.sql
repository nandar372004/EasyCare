begin;
create table public.care_encounters (
 id uuid primary key default gen_random_uuid(), appointment_id uuid not null unique references public.appointments(id) on delete restrict,
 patient_id uuid not null references public.patients(id) on delete restrict, provider_id uuid not null references public.providers(id) on delete restrict,
 encounter_type public.encounter_type not null, started_at timestamptz, ended_at timestamptz, chief_complaint text,
 assessment_summary text, care_plan text, status public.encounter_status not null default 'open',
 created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(), check(ended_at is null or started_at is null or ended_at>=started_at)
);
create trigger care_encounters_updated_at before update on public.care_encounters for each row execute function public.set_updated_at();
create table public.clinical_notes (id uuid primary key default gen_random_uuid(), encounter_id uuid not null references public.care_encounters(id) on delete restrict, author_profile_id uuid not null references public.profiles(id) on delete restrict, note_type public.clinical_note_type not null, content text not null, created_at timestamptz not null default statement_timestamp(), amended_at timestamptz);
create table public.patient_conditions (id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete restrict, condition_name text not null, status public.condition_status not null, diagnosed_at date, recorded_by uuid references public.profiles(id) on delete restrict, notes text);
create table public.patient_allergies (id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete restrict, allergen text not null, reaction text, severity public.allergy_severity, status public.active_status not null default 'active', recorded_by uuid references public.profiles(id) on delete restrict);
create table public.medical_history_items (id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete restrict, category public.history_category not null, title text not null, occurred_on date, details text, document_url text);
create table public.vital_readings (
 id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete restrict,
 encounter_id uuid references public.care_encounters(id) on delete restrict, recorded_by_profile_id uuid references public.profiles(id) on delete restrict,
 source public.vital_source not null, systolic_bp integer, diastolic_bp integer, heart_rate integer, spo2 numeric(5,2), temperature_c numeric(4,1), glucose_mg_dl numeric, weight_kg numeric(6,2),
 recorded_at timestamptz not null, notes text,
 check(systolic_bp is null or systolic_bp>0), check(diastolic_bp is null or diastolic_bp>0), check(heart_rate is null or heart_rate>0), check(spo2 is null or spo2 between 0 and 100), check(weight_kg is null or weight_kg>0)
);
create index vital_readings_patient_recorded_idx on public.vital_readings(patient_id,recorded_at desc);
commit;
