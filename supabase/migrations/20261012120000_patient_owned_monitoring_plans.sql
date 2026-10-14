begin;
set local lock_timeout = '10s';

create table public.patient_monitoring_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  related_context text check (related_context is null or char_length(btrim(related_context)) <= 200),
  notes text check (notes is null or char_length(btrim(notes)) <= 1000),
  recurrence_type text not null check (recurrence_type in ('daily', 'selected_days', 'once')),
  days_of_week smallint[] not null default '{}',
  start_date date not null,
  end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint patient_monitoring_plans_date_range check (end_date is null or end_date >= start_date),
  constraint patient_monitoring_plans_days check (
    array_position(days_of_week, null) is null
    and days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]
    and cardinality(days_of_week) <= 7
    and ((recurrence_type = 'selected_days' and cardinality(days_of_week) between 1 and 7)
      or (recurrence_type in ('daily','once') and cardinality(days_of_week) = 0))
  ),
  constraint patient_monitoring_plans_id_patient_unique unique (id, patient_id)
);

create table public.patient_monitoring_plan_times (
  id uuid primary key default gen_random_uuid(),
  monitoring_plan_id uuid not null references public.patient_monitoring_plans(id) on delete restrict,
  time_of_day time not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint patient_monitoring_plan_times_plan_time_unique unique (monitoring_plan_id, time_of_day),
  constraint patient_monitoring_plan_times_id_plan_unique unique (id, monitoring_plan_id)
);

create table public.patient_monitoring_check_ins (
  id uuid primary key default gen_random_uuid(),
  monitoring_plan_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  local_date date not null,
  occurrence_key text not null,
  occurrence_label text not null,
  status text not null default 'open' check (status in ('open','done')),
  completed_at timestamptz,
  measurement_value text check (measurement_value is null or char_length(btrim(measurement_value)) <= 100),
  measurement_unit text check (measurement_unit is null or char_length(btrim(measurement_unit)) <= 40),
  notes text check (notes is null or char_length(btrim(notes)) <= 1000),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint patient_monitoring_check_ins_plan_owner_fk
    foreign key (monitoring_plan_id, patient_id)
    references public.patient_monitoring_plans(id, patient_id) on delete restrict,
  constraint patient_monitoring_check_ins_completion_consistent
    check ((status = 'done') = (completed_at is not null)),
  constraint patient_monitoring_check_ins_occurrence_unique
    unique (monitoring_plan_id, local_date, occurrence_key)
);

create index patient_monitoring_plans_owner_active_idx
  on public.patient_monitoring_plans(patient_id, is_active, created_at, id);
create index patient_monitoring_check_ins_owner_day_idx
  on public.patient_monitoring_check_ins(patient_id, local_date desc, monitoring_plan_id);

alter table public.patient_monitoring_plans enable row level security;
alter table public.patient_monitoring_plan_times enable row level security;
alter table public.patient_monitoring_check_ins enable row level security;

revoke all on public.patient_monitoring_plans, public.patient_monitoring_plan_times,
  public.patient_monitoring_check_ins from public, anon, authenticated;
grant select on public.patient_monitoring_plans, public.patient_monitoring_plan_times,
  public.patient_monitoring_check_ins to authenticated;

create policy patient_monitoring_plans_read_own on public.patient_monitoring_plans
  for select to authenticated using (exists (
    select 1 from public.patients p where p.id = patient_monitoring_plans.patient_id
      and p.auth_user_id = (select auth.uid())
  ));
create policy patient_monitoring_plan_times_read_own on public.patient_monitoring_plan_times
  for select to authenticated using (exists (
    select 1 from public.patient_monitoring_plans mp join public.patients p on p.id = mp.patient_id
    where mp.id = patient_monitoring_plan_times.monitoring_plan_id
      and p.auth_user_id = (select auth.uid())
  ));
create policy patient_monitoring_check_ins_read_own on public.patient_monitoring_check_ins
  for select to authenticated using (exists (
    select 1 from public.patients p where p.id = patient_monitoring_check_ins.patient_id
      and p.auth_user_id = (select auth.uid())
  ));

create function public.save_my_patient_monitoring_plan(
  p_plan_id uuid,
  p_title text,
  p_related_context text,
  p_notes text,
  p_recurrence_type text,
  p_days_of_week smallint[],
  p_start_date date,
  p_end_date date,
  p_times time[]
) returns public.patient_monitoring_plans
language plpgsql security definer set search_path = '' as $$
declare
  owner_patient_id uuid;
  result public.patient_monitoring_plans;
  normalized_title text;
  normalized_context text;
  normalized_notes text;
  normalized_days smallint[];
  normalized_times time[];
begin
  if auth.uid() is null then
    raise exception 'Authenticated patient required' using errcode = '42501';
  end if;
  select p.id into owner_patient_id from public.patients p
    where p.auth_user_id = auth.uid() and p.status = 'active' for key share;
  if not found then raise exception 'Authenticated patient required' using errcode = '42501'; end if;

  normalized_title := btrim(coalesce(p_title, ''));
  normalized_context := nullif(btrim(coalesce(p_related_context, '')), '');
  normalized_notes := nullif(btrim(coalesce(p_notes, '')), '');
  normalized_days := coalesce(p_days_of_week, '{}'::smallint[]);
  select coalesce(array_agg(distinct d order by d), '{}'::smallint[])
    into normalized_days from unnest(normalized_days) d;
  select coalesce(array_agg(distinct t order by t), '{}'::time[])
    into normalized_times from unnest(coalesce(p_times, '{}'::time[])) t;

  if char_length(normalized_title) not between 1 and 200
      or char_length(coalesce(normalized_context,'')) > 200
      or char_length(coalesce(normalized_notes,'')) > 1000 then
    raise exception 'Routine text is outside the allowed length' using errcode = '22023';
  end if;
  if p_recurrence_type not in ('daily','selected_days','once') or p_start_date is null
      or (p_end_date is not null and p_end_date < p_start_date)
      or cardinality(normalized_times) > 12
      or exists (select 1 from unnest(normalized_days) d where d < 0 or d > 6)
      or (p_recurrence_type = 'selected_days' and cardinality(normalized_days) = 0)
      or (p_recurrence_type in ('daily','once') and cardinality(normalized_days) <> 0) then
    raise exception 'Routine schedule is invalid' using errcode = '22023';
  end if;

  if p_plan_id is null then
    insert into public.patient_monitoring_plans
      (patient_id,title,related_context,notes,recurrence_type,days_of_week,start_date,end_date)
    values (owner_patient_id,normalized_title,normalized_context,normalized_notes,
      p_recurrence_type,normalized_days,p_start_date,p_end_date)
    returning * into result;
  else
    update public.patient_monitoring_plans mp set title=normalized_title,
      related_context=normalized_context, notes=normalized_notes,
      recurrence_type=p_recurrence_type, days_of_week=normalized_days,
      start_date=p_start_date,end_date=p_end_date,updated_at=statement_timestamp()
    where mp.id=p_plan_id and mp.patient_id=owner_patient_id and mp.is_active
    returning * into result;
    if not found then raise exception 'Monitoring routine is unavailable' using errcode = '42501'; end if;
    delete from public.patient_monitoring_plan_times where monitoring_plan_id=p_plan_id;
  end if;

  insert into public.patient_monitoring_plan_times(monitoring_plan_id,time_of_day)
    select result.id, t from unnest(normalized_times) t;
  return result;
end;
$$;

create function public.deactivate_my_patient_monitoring_plan(p_plan_id uuid)
returns public.patient_monitoring_plans
language plpgsql security definer set search_path = '' as $$
declare owner_patient_id uuid; result public.patient_monitoring_plans;
begin
  if auth.uid() is null or p_plan_id is null then
    raise exception 'Authenticated patient routine required' using errcode = '42501';
  end if;
  select p.id into owner_patient_id from public.patients p
    where p.auth_user_id=auth.uid() and p.status='active';
  if not found then raise exception 'Authenticated patient required' using errcode = '42501'; end if;
  update public.patient_monitoring_plans mp set is_active=false,updated_at=statement_timestamp()
    where mp.id=p_plan_id and mp.patient_id=owner_patient_id and mp.is_active returning * into result;
  if not found then raise exception 'Monitoring routine is unavailable' using errcode = '42501'; end if;
  return result;
end;
$$;

create function public.record_my_patient_monitoring_check_in(
  p_plan_id uuid, p_local_date date, p_occurrence_key text, p_is_done boolean,
  p_measurement_value text, p_measurement_unit text, p_notes text
) returns public.patient_monitoring_check_ins
language plpgsql security definer set search_path = '' as $$
declare
  owner_patient_id uuid;
  plan_row public.patient_monitoring_plans;
  result public.patient_monitoring_check_ins;
  has_times boolean;
  occurrence_time time;
  occurrence_label text;
  scheduled_day smallint;
  normalized_value text;
  normalized_unit text;
  normalized_notes text;
begin
  if auth.uid() is null then raise exception 'Authenticated patient required' using errcode = '42501'; end if;
  select p.id into owner_patient_id from public.patients p
    where p.auth_user_id=auth.uid() and p.status='active';
  if not found then raise exception 'Authenticated patient required' using errcode = '42501'; end if;
  select mp.* into plan_row from public.patient_monitoring_plans mp
    where mp.id=p_plan_id and mp.patient_id=owner_patient_id and mp.is_active;
  if not found then raise exception 'Monitoring routine is unavailable' using errcode = '42501'; end if;
  if p_local_date is null or p_local_date > (statement_timestamp() at time zone 'Asia/Yangon')::date
      or p_local_date < plan_row.start_date or (plan_row.end_date is not null and p_local_date > plan_row.end_date)
      or p_is_done is null then
    raise exception 'Monitoring occurrence date is invalid' using errcode = '22023';
  end if;
  scheduled_day := extract(dow from p_local_date)::smallint;
  if (plan_row.recurrence_type='once' and p_local_date <> plan_row.start_date)
      or (plan_row.recurrence_type='selected_days' and not (scheduled_day = any(plan_row.days_of_week))) then
    raise exception 'Routine is not scheduled on this date' using errcode = '22023';
  end if;
  select exists(select 1 from public.patient_monitoring_plan_times t where t.monitoring_plan_id=p_plan_id) into has_times;
  if has_times then
    select t.time_of_day into occurrence_time from public.patient_monitoring_plan_times t
      where t.monitoring_plan_id=p_plan_id and t.id::text=p_occurrence_key;
    if p_occurrence_key is null or not found then
      raise exception 'Routine occurrence is invalid' using errcode = '22023';
    end if;
    occurrence_label := to_char(occurrence_time, 'FMHH12:MI AM');
  elsif p_occurrence_key is distinct from 'any' then
    raise exception 'Routine occurrence is invalid' using errcode = '22023';
  else
    occurrence_label := 'Any time';
  end if;
  normalized_value := nullif(btrim(coalesce(p_measurement_value,'')), '');
  normalized_unit := nullif(btrim(coalesce(p_measurement_unit,'')), '');
  normalized_notes := nullif(btrim(coalesce(p_notes,'')), '');
  if char_length(coalesce(normalized_value,'')) > 100 or char_length(coalesce(normalized_unit,'')) > 40
      or char_length(coalesce(normalized_notes,'')) > 1000 then
    raise exception 'Check-in details are outside the allowed length' using errcode = '22023';
  end if;

  insert into public.patient_monitoring_check_ins as existing
    (monitoring_plan_id,patient_id,local_date,occurrence_key,occurrence_label,status,completed_at,measurement_value,measurement_unit,notes)
  values (p_plan_id,owner_patient_id,p_local_date,p_occurrence_key,occurrence_label,
    case when p_is_done then 'done' else 'open' end,
    case when p_is_done then statement_timestamp() else null end,
    normalized_value,normalized_unit,normalized_notes)
  on conflict (monitoring_plan_id,local_date,occurrence_key) do update set
    occurrence_label=excluded.occurrence_label,status=excluded.status,completed_at=excluded.completed_at,
    measurement_value=excluded.measurement_value,measurement_unit=excluded.measurement_unit,
    notes=excluded.notes,updated_at=statement_timestamp()
  returning existing.* into result;
  return result;
end;
$$;

revoke all on function public.save_my_patient_monitoring_plan(uuid,text,text,text,text,smallint[],date,date,time[])
  from public, anon;
revoke all on function public.deactivate_my_patient_monitoring_plan(uuid) from public, anon;
revoke all on function public.record_my_patient_monitoring_check_in(uuid,date,text,boolean,text,text,text)
  from public, anon;
grant execute on function public.save_my_patient_monitoring_plan(uuid,text,text,text,text,smallint[],date,date,time[])
  to authenticated;
grant execute on function public.deactivate_my_patient_monitoring_plan(uuid) to authenticated;
grant execute on function public.record_my_patient_monitoring_check_in(uuid,date,text,boolean,text,text,text)
  to authenticated;

comment on table public.patient_monitoring_plans is
  'Patient-created personal monitoring routines; separate from clinician-authored care plans.';
comment on table public.patient_monitoring_check_ins is
  'Date-scoped patient routine occurrences; completion history is retained when a routine is deactivated.';

commit;
