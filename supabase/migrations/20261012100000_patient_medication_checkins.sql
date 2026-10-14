begin;
set local lock_timeout = '10s';

create table public.patient_medication_check_ins (
  id uuid primary key default gen_random_uuid(),
  patient_medication_id uuid not null,
  patient_id uuid not null,
  local_date date not null,
  occurrence_index smallint not null check (occurrence_index > 0),
  is_prn boolean not null default false,
  status text not null default 'taken' check (status = 'taken'),
  completed_at timestamptz not null default statement_timestamp(),
  request_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint patient_medication_check_ins_med_patient_fk
    foreign key (patient_medication_id, patient_id)
    references public.patient_medications(id, patient_id) on delete restrict,
  constraint patient_medication_check_ins_request_unique
    unique (patient_medication_id, request_id)
);

create unique index patient_medication_check_ins_scheduled_occurrence_unique
  on public.patient_medication_check_ins(patient_medication_id, local_date, occurrence_index)
  where not is_prn;
create unique index patient_medication_check_ins_prn_occurrence_unique
  on public.patient_medication_check_ins(patient_medication_id, local_date, occurrence_index)
  where is_prn;

create index patient_medication_check_ins_patient_date_idx
  on public.patient_medication_check_ins(patient_id, local_date, patient_medication_id);

alter table public.patient_medication_check_ins enable row level security;
revoke all on public.patient_medication_check_ins from public, anon, authenticated;
grant select on public.patient_medication_check_ins to authenticated;
create policy patient_medication_check_ins_read_own
  on public.patient_medication_check_ins for select to authenticated
  using (exists (
    select 1 from public.patients p
    where p.id = patient_medication_check_ins.patient_id
      and p.auth_user_id = (select auth.uid())
  ));

create function public.record_patient_medication_check_in(
  target_medication_id uuid,
  target_occurrence_index smallint,
  target_request_id uuid
) returns public.patient_medication_check_ins
language plpgsql security definer set search_path = '' as $$
declare
  owner_patient_id uuid;
  medication_frequency text;
  today_local date := (statement_timestamp() at time zone 'Asia/Yangon')::date;
  expected_occurrences smallint;
  resolved_occurrence smallint;
  result public.patient_medication_check_ins;
begin
  if auth.uid() is null or target_medication_id is null or target_request_id is null then
    raise exception 'Authenticated patient medication check-in required' using errcode = '42501';
  end if;

  select p.id, m.frequency into owner_patient_id, medication_frequency
  from public.patients p
  join public.patient_medications m on m.patient_id = p.id
  where p.auth_user_id = auth.uid() and p.status = 'active'
    and m.id = target_medication_id and m.status = 'active'
    and (m.start_date is null or m.start_date <= today_local)
    and (m.end_date is null or m.end_date >= today_local)
  for share of p, m;

  if not found then
    raise exception 'Medication unavailable to authenticated patient' using errcode = '42501';
  end if;

  if lower(coalesce(medication_frequency, '')) ~ '(as[[:space:]]+needed|\mprn\M)' then
    if target_occurrence_index is not null then
      raise exception 'As-needed medication check-ins must not use a scheduled occurrence number' using errcode = '22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_medication_id::text || ':' || today_local::text, 0));
    select coalesce(max(c.occurrence_index), 0) + 1 into resolved_occurrence
    from public.patient_medication_check_ins c
    where c.patient_medication_id = target_medication_id and c.local_date = today_local and c.is_prn;
  else
    if lower(btrim(coalesce(medication_frequency, ''))) ~ '(once[[:space:]]+(daily|a[[:space:]]+day)|^daily$)' then
      expected_occurrences := 1;
    elsif lower(coalesce(medication_frequency, '')) ~ '(twice[[:space:]]+daily|2[[:space:]]*times[[:space:]]+daily|2x[[:space:]]*daily)' then
      expected_occurrences := 2;
    elsif lower(coalesce(medication_frequency, '')) ~ '(three[[:space:]]+times[[:space:]]+daily|3[[:space:]]*times[[:space:]]+daily|3x[[:space:]]*daily)' then
      expected_occurrences := 3;
    else
      raise exception 'Medication frequency does not define a supported daily occurrence count' using errcode = '22023';
    end if;
    if target_occurrence_index is null or target_occurrence_index < 1
       or target_occurrence_index > expected_occurrences then
      raise exception 'Medication occurrence is outside the prescribed daily frequency' using errcode = '22023';
    end if;
    resolved_occurrence := target_occurrence_index;
  end if;

  insert into public.patient_medication_check_ins
    (patient_medication_id, patient_id, local_date, occurrence_index, is_prn, status, request_id)
  values (target_medication_id, owner_patient_id, today_local, resolved_occurrence,
    lower(coalesce(medication_frequency, '')) ~ '(as[[:space:]]+needed|\mprn\M)', 'taken', target_request_id)
  on conflict do nothing
  returning * into result;

  if not found then
    select c.* into result from public.patient_medication_check_ins c
    where c.patient_medication_id = target_medication_id and c.local_date = today_local
      and ((c.occurrence_index = resolved_occurrence and c.is_prn =
        (lower(coalesce(medication_frequency, '')) ~ '(as[[:space:]]+needed|\mprn\M)'))
        or (c.request_id = target_request_id and c.is_prn =
          (lower(coalesce(medication_frequency, '')) ~ '(as[[:space:]]+needed|\mprn\M)')))
    order by (c.request_id = target_request_id) desc
    limit 1;
  end if;
  if result.id is null then
    raise exception 'Medication check-in could not be confirmed' using errcode = '40001';
  end if;
  return result;
end;
$$;

revoke all on function public.record_patient_medication_check_in(uuid, smallint, uuid) from public, anon;
grant execute on function public.record_patient_medication_check_in(uuid, smallint, uuid) to authenticated;
comment on table public.patient_medication_check_ins is
  'Patient self-reported medication completion for a local calendar date and occurrence number; does not invent clock times or modify medication definitions.';
comment on function public.record_patient_medication_check_in(uuid, smallint, uuid) is
  'Records an authenticated patient medication check-in for Asia/Yangon today. Ownership is resolved from auth.uid(); separate PRN and scheduled occurrence uniqueness prevents duplicate completions and cross-kind collisions.';

commit;
