begin;

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  submitted_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  comments text,
  created_at timestamptz not null default statement_timestamp(),
  unique (appointment_id, submitted_by_profile_id)
);

create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete restrict,
  submitted_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  subject text not null check (length(btrim(subject)) between 1 and 200),
  description text not null check (length(btrim(description)) > 0),
  status public.complaint_status not null default 'open',
  assigned_to_profile_id uuid references public.profiles(id) on delete restrict,
  resolution text,
  created_at timestamptz not null default statement_timestamp(),
  resolved_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  check ((status in ('resolved','closed')) = (resolved_at is not null))
);
create index complaints_status_created_idx on public.complaints(status, created_at);
create trigger complaints_updated_at before update on public.complaints for each row execute function public.set_updated_at();

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  patient_id uuid references public.patients(id) on delete set null,
  action text not null,
  entity_table text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default statement_timestamp()
);
create index audit_logs_entity_idx on public.audit_logs(entity_table, entity_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs(actor_profile_id, created_at desc);
create index audit_logs_patient_idx on public.audit_logs(patient_id, created_at desc) where patient_id is not null;

create function public.reject_immutable_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% records are append-only', tg_table_name using errcode = '55000';
end $$;

create trigger visit_status_events_immutable before update or delete on public.visit_status_events
for each row execute function public.reject_immutable_change();
create trigger audit_logs_immutable before update or delete on public.audit_logs
for each row execute function public.reject_immutable_change();

create function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_row jsonb;
  new_row jsonb;
  row_data jsonb;
begin
  old_row := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  new_row := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  row_data := coalesce(new_row, old_row);

  insert into public.audit_logs(actor_profile_id, patient_id, action, entity_table, entity_id, before_data, after_data)
  values (
    case when exists (select 1 from public.profiles p where p.id = auth.uid()) then auth.uid() else null end,
    case when row_data ? 'patient_id' and nullif(row_data->>'patient_id','') is not null
      then (row_data->>'patient_id')::uuid else null end,
    lower(tg_op), tg_table_name, coalesce(row_data->>'id', row_data->>'profile_id'), old_row, new_row
  );
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger profiles_audit after insert or update or delete on public.profiles for each row execute function public.audit_row_change();
create trigger provider_credentials_audit after insert or update or delete on public.provider_credentials for each row execute function public.audit_row_change();
create trigger family_authorizations_audit after insert or update or delete on public.family_authorizations for each row execute function public.audit_row_change();
create trigger care_requests_audit after insert or update or delete on public.care_requests for each row execute function public.audit_row_change();
create trigger appointments_audit after insert or update or delete on public.appointments for each row execute function public.audit_row_change();
create trigger complaints_audit after insert or update or delete on public.complaints for each row execute function public.audit_row_change();
create trigger payments_audit after insert or update or delete on public.payments for each row execute function public.audit_row_change();

commit;
