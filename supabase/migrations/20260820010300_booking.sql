begin;
create table public.care_requests (
 id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete restrict,
 requested_by_profile_id uuid not null references public.profiles(id) on delete restrict, service_type public.care_request_type not null,
 reason_symptoms text not null, urgency_level public.care_urgency not null default 'unassessed', preferred_date date, preferred_time time,
 address_snapshot jsonb, coordinator_id uuid, status public.care_request_status not null default 'new',
 created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp()
);
create trigger care_requests_updated_at before update on public.care_requests for each row execute function public.set_updated_at();
create index care_requests_queue_idx on public.care_requests(status,urgency_level,created_at);
create table public.appointments (
 id uuid primary key default gen_random_uuid(), care_request_id uuid references public.care_requests(id) on delete restrict,
 patient_id uuid not null references public.patients(id) on delete restrict, provider_id uuid not null references public.providers(id) on delete restrict,
 booked_by_profile_id uuid not null references public.profiles(id) on delete restrict, appointment_type public.service_mode not null,
 scheduled_start timestamptz not null, scheduled_end timestamptz not null, reason_symptoms text,
 status public.appointment_status not null default 'pending', fee_amount numeric(12,2) not null default 0 check(fee_amount>=0),
 currency char(3) not null default 'MMK', cancelled_at timestamptz,
 created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
 check(scheduled_end>scheduled_start), check((status='cancelled')=(cancelled_at is not null))
);
alter table public.appointments add constraint appointments_provider_no_overlap exclude using gist (provider_id with =, tstzrange(scheduled_start,scheduled_end,'[)') with &&) where (status in ('pending','confirmed','rescheduled'));
create index appointments_provider_start_idx on public.appointments(provider_id,scheduled_start);
create index appointments_patient_start_idx on public.appointments(patient_id,scheduled_start);
create index appointments_status_idx on public.appointments(status);
create trigger appointments_updated_at before update on public.appointments for each row execute function public.set_updated_at();
create table public.care_assignments (
 id uuid primary key default gen_random_uuid(), care_request_id uuid not null references public.care_requests(id) on delete restrict,
 appointment_id uuid references public.appointments(id) on delete restrict, provider_id uuid not null references public.providers(id) on delete restrict,
 assigned_by_profile_id uuid not null references public.profiles(id) on delete restrict, match_score numeric, match_reason jsonb,
 status public.assignment_status not null, assigned_at timestamptz, responded_at timestamptz
);
create table public.visit_status_events (
 id uuid primary key default gen_random_uuid(), appointment_id uuid not null references public.appointments(id) on delete restrict,
 status public.visit_status not null, actor_profile_id uuid references public.profiles(id) on delete restrict,
 latitude numeric(9,6), longitude numeric(9,6), notes text, created_at timestamptz not null default statement_timestamp()
);
create index visit_status_events_appointment_idx on public.visit_status_events(appointment_id,created_at);
commit;
