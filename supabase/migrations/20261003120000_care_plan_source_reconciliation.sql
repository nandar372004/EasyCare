begin;

-- One authoritative source row can be attributed to at most one occurrence.
-- These partial unique indexes also close concurrent reconciliation races.
create unique index care_plan_occurrence_medication_event_once
  on public.care_plan_task_occurrences(medication_event_id) where medication_event_id is not null;
create unique index care_plan_occurrence_vital_reading_once
  on public.care_plan_task_occurrences(vital_reading_id) where vital_reading_id is not null;
create unique index care_plan_occurrence_appointment_once
  on public.care_plan_task_occurrences(appointment_id) where appointment_id is not null;
create unique index care_plan_occurrence_followup_once
  on public.care_plan_task_occurrences(follow_up_id) where follow_up_id is not null;

alter table public.care_plan_tasks
  drop constraint care_plan_tasks_check8,
  add constraint care_plan_tasks_schedule_source_valid check(recurrence<>'source_schedule' or (task_type='medication' and medication_schedule_id is not null)),
  add constraint care_plan_vital_type_supported check(vital_type is null or vital_type in ('blood_pressure','heart_rate','spo2','temperature','glucose','weight')),
  add constraint care_plan_source_tasks_one_time check(task_type not in ('appointment','follow_up') or recurrence='one_time'),
  add constraint care_plan_source_schedule_is_medication check(recurrence<>'source_schedule' or task_type='medication'),
  add constraint care_plan_vital_window_bounded check(grace_minutes<=120);
alter table public.care_plan_tasks alter column grace_minutes set default 60;

-- The original generator's weekday guard accidentally skipped source_schedule
-- tasks entirely. Recreate it here so the forward migration repairs existing
-- deployments without rewriting the Phase 4B migration.
create or replace function public.extend_care_plan_occurrences(p_plan uuid,p_through date default null) returns integer
language plpgsql security definer set search_path='' as $$
declare p public.care_plans; t record; d date; tm time; limit_date date; inserted_count integer:=0; due timestamp; n integer;
begin
  select * into p from public.care_plans where id=p_plan for update;
  if not found then raise exception 'Plan unavailable' using errcode='42501'; end if;
  perform public.assert_care_plan_doctor(p.patient_id,p.responsible_provider_id);
  if p.status<>'active' then raise exception 'Only active plans can generate occurrences' using errcode='22023'; end if;
  limit_date:=least(coalesce(p_through,(statement_timestamp() at time zone p.timezone)::date+30),(statement_timestamp() at time zone p.timezone)::date+30);
  if limit_date<(statement_timestamp() at time zone p.timezone)::date then raise exception 'Occurrence horizon unavailable' using errcode='22023'; end if;
  for t in select * from public.care_plan_tasks where plan_id=p.id and version_id=p.current_version_id and patient_id=p.patient_id loop
    if (select count(*) from public.care_plan_tasks where plan_id=p.id and version_id=p.current_version_id)>100 then raise exception 'Task limit exceeded' using errcode='22023'; end if;
    d:=greatest(t.starts_on,(statement_timestamp() at time zone t.timezone)::date);
    while d<=limit_date and (t.ends_on is null or d<=t.ends_on) loop
      if t.recurrence='one_time' and d<>t.starts_on then exit; end if;
      if t.recurrence not in ('selected_weekdays','source_schedule') or (t.recurrence='selected_weekdays' and extract(dow from d)::smallint=any(t.weekdays)) or t.recurrence='source_schedule' then
        foreach tm in array case when t.recurrence='source_schedule'
          then (select coalesce(array_agg(ms.time_of_day order by ms.time_of_day),array[]::time[]) from public.medication_schedules ms where ms.id=t.medication_schedule_id and ms.patient_medication_id=t.medication_id and (ms.valid_from is null or d>=ms.valid_from) and (ms.valid_until is null or d<=ms.valid_until) and (ms.days_of_week is null or extract(dow from d)::smallint=any(ms.days_of_week)))
          else t.local_times end loop
          due:=d+tm;
          insert into public.care_plan_task_occurrences(task_id,plan_id,version_id,patient_id,occurrence_key,scheduled_at,local_due_date,local_due_time,timezone,required,appointment_id,follow_up_id)
            values(t.id,p.id,t.version_id,p.patient_id,d::text||'T'||tm::text,due at time zone t.timezone,d,tm,t.timezone,t.required,t.appointment_id,t.follow_up_id)
            on conflict(task_id,occurrence_key) do nothing;
          get diagnostics n=row_count; inserted_count:=inserted_count+n;
        end loop;
      end if;
      if t.recurrence='one_time' then exit; end if;
      d:=d+1;
    end loop;
  end loop;
  return inserted_count;
end $$;

alter table public.care_plan_events
  add column source_type text check(source_type is null or source_type in ('medication_event','vital_reading','appointment','follow_up')),
  add column source_id uuid,
  add constraint care_plan_event_source_pair check((source_type is null)=(source_id is null));

-- Appointments and follow-ups have their own authoritative due time. The
-- trigger aligns materialized one-time rows with those source timestamps.
create function public.set_care_plan_source_occurrence_time() returns trigger
language plpgsql security definer set search_path='' as $$
declare t public.care_plan_tasks; a public.appointments; f public.follow_ups; due timestamptz;
begin
  select * into t from public.care_plan_tasks where id=new.task_id and plan_id=new.plan_id and version_id=new.version_id and patient_id=new.patient_id;
  if t.task_type='appointment' then
    select * into a from public.appointments where id=t.appointment_id and patient_id=t.patient_id;
    due:=a.scheduled_start;
    -- Task owns the source relationship before completion; this column is
    -- reserved for persistent completion attribution.
    new.appointment_id:=null;
    new.occurrence_key:='source_appointment';
  elsif t.task_type='follow_up' then
    select * into f from public.follow_ups where id=t.follow_up_id and patient_id=t.patient_id;
    due:=f.due_at;
    new.follow_up_id:=null;
    new.occurrence_key:='source_follow_up';
  else
    return new;
  end if;
  if due is null then raise exception 'Linked source has no scheduled time' using errcode='22023'; end if;
  new.timezone:=t.timezone;
  new.scheduled_at:=due;
  new.local_due_date:=(due at time zone t.timezone)::date;
  new.local_due_time:=(due at time zone t.timezone)::time;
  return new;
end $$;
create trigger care_plan_source_occurrence_time before insert on public.care_plan_task_occurrences
  for each row execute function public.set_care_plan_source_occurrence_time();

-- Internal-only attribution operation. It rechecks task type, patient, plan
-- version and unresolved status before persisting a source link and event.
create function public.attach_care_plan_source(p_occurrence uuid,p_source_type text,p_source_id uuid,p_actor uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare o public.care_plan_task_occurrences; t public.care_plan_tasks; p public.care_plans;
begin
  select * into o from public.care_plan_task_occurrences where id=p_occurrence for update;
  if not found then return false; end if;
  select * into t from public.care_plan_tasks where id=o.task_id;
  select * into p from public.care_plans where id=o.plan_id;
  if o.status<>'pending' or o.medication_event_id is not null or o.vital_reading_id is not null
    or (o.appointment_id is not null and not (p_source_type='appointment' and o.appointment_id=p_source_id))
    or (o.follow_up_id is not null and not (p_source_type='follow_up' and o.follow_up_id=p_source_id))
    or p.status<>'active' or p.current_version_id<>o.version_id then return false; end if;
  if (p_source_type='medication_event' and (t.task_type<>'medication' or not exists(
      select 1 from public.medication_events e join public.medication_schedules s on s.id=e.schedule_id
      join public.patient_medications m on m.id=s.patient_medication_id
      where e.id=p_source_id and e.patient_id=o.patient_id and e.status='taken' and e.scheduled_at=o.scheduled_at
        and s.id=t.medication_schedule_id and m.id=t.medication_id)))
    or (p_source_type='vital_reading' and t.task_type<>'vital_check')
    or (p_source_type='appointment' and (t.task_type<>'appointment' or t.appointment_id<>p_source_id or not exists(select 1 from public.appointments a where a.id=p_source_id and a.patient_id=o.patient_id and a.status='completed')))
    or (p_source_type='follow_up' and (t.task_type<>'follow_up' or t.follow_up_id<>p_source_id or not exists(select 1 from public.follow_ups f where f.id=p_source_id and f.patient_id=o.patient_id and f.status='completed'))) then
    return false;
  end if;
  update public.care_plan_task_occurrences set
    medication_event_id=case when p_source_type='medication_event' then p_source_id else null end,
    vital_reading_id=case when p_source_type='vital_reading' then p_source_id else null end,
    appointment_id=case when p_source_type='appointment' then p_source_id else appointment_id end,
    follow_up_id=case when p_source_type='follow_up' then p_source_id else follow_up_id end,
    status='completed',completed_at=statement_timestamp(),completed_by_profile_id=coalesce(p_actor,p.created_by_profile_id)
    where id=o.id and status='pending';
  if not found then return false; end if;
  insert into public.care_plan_events(plan_id,patient_id,version_id,task_id,occurrence_id,event_type,actor_profile_id,provider_id,new_status,source_type,source_id)
    values(o.plan_id,o.patient_id,o.version_id,o.task_id,o.id,'occurrence_completed',coalesce(p_actor,p.created_by_profile_id),p.responsible_provider_id,'completed',p_source_type,p_source_id);
  return true;
end $$;

-- Reconciliation takes no source identifier from the client. A patient can
-- reconcile their own plans; a verified responsible doctor may reconcile a
-- plan they own. The patient row serializes all patient plans so measurement
-- matching and source consumption have stable outcomes across concurrent calls.
create function public.reconcile_care_plan_occurrences(p_plan uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare target public.care_plans; source record; occurrence uuid; n integer:=0;
begin
  select * into target from public.care_plans where id=p_plan;
  if not found then raise exception 'Care plan unavailable' using errcode='42501'; end if;
  if not exists(select 1 from public.patients pt where pt.id=target.patient_id and pt.auth_user_id=auth.uid()) then
    perform public.assert_care_plan_doctor(target.patient_id,target.responsible_provider_id);
    if target.responsible_provider_id is distinct from (select pr.id from public.providers pr where pr.profile_id=auth.uid() and pr.provider_type='doctor' and pr.verification_status='verified') then
      raise exception 'Care plan unavailable' using errcode='42501';
    end if;
  end if;
  perform 1 from public.patients where id=target.patient_id for update;

  -- Medication events match exact patient, medication, schedule and scheduled
  -- instant. Non-taken events are never considered.
  for source in select e.id,e.schedule_id,e.scheduled_at,e.confirmed_by_profile_id
    from public.medication_events e join public.medication_schedules s on s.id=e.schedule_id
    join public.patient_medications m on m.id=s.patient_medication_id
    where e.patient_id=target.patient_id and m.patient_id=target.patient_id and e.status='taken'
      and not exists(select 1 from public.care_plan_task_occurrences x where x.medication_event_id=e.id)
    order by e.scheduled_at,e.id for update of e loop
    select o.id into occurrence from public.care_plan_task_occurrences o
      join public.care_plan_tasks t on t.id=o.task_id join public.care_plans p on p.id=o.plan_id
      where o.patient_id=target.patient_id and o.status='pending' and o.medication_event_id is null and o.vital_reading_id is null
        and o.appointment_id is null and o.follow_up_id is null and o.scheduled_at=source.scheduled_at
        and t.task_type='medication' and t.medication_schedule_id=source.schedule_id
        and p.status='active' and p.current_version_id=o.version_id
      order by o.scheduled_at,p.id,t.id,o.id limit 1 for update of o skip locked;
    if occurrence is not null and public.attach_care_plan_source(occurrence,'medication_event',source.id,source.confirmed_by_profile_id) then n:=n+1; end if;
    occurrence:=null;
  end loop;

  -- A single vital reading is assigned to the closest eligible occurrence,
  -- then ties break on due instant and stable plan/task/occurrence UUID order.
  for source in select v.id,v.recorded_at,v.recorded_by_profile_id,v.systolic_bp,v.diastolic_bp,v.heart_rate,v.spo2,v.temperature_c,v.glucose_mg_dl,v.weight_kg
    from public.vital_readings v where v.patient_id=target.patient_id
      and (v.systolic_bp is not null or v.diastolic_bp is not null or v.heart_rate is not null or v.spo2 is not null or v.temperature_c is not null or v.glucose_mg_dl is not null or v.weight_kg is not null)
      and not exists(select 1 from public.care_plan_task_occurrences x where x.vital_reading_id=v.id)
    order by v.recorded_at,v.id for update of v loop
    select o.id into occurrence from public.care_plan_task_occurrences o
      join public.care_plan_tasks t on t.id=o.task_id join public.care_plans p on p.id=o.plan_id
      where o.patient_id=target.patient_id and o.status='pending' and o.medication_event_id is null and o.vital_reading_id is null
        and o.appointment_id is null and o.follow_up_id is null and t.task_type='vital_check'
        and p.status='active' and p.current_version_id=o.version_id
        and source.recorded_at>=o.scheduled_at-make_interval(mins=>t.grace_minutes)
        and source.recorded_at<=o.scheduled_at+make_interval(mins=>t.grace_minutes)
        and case t.vital_type
          when 'blood_pressure' then source.systolic_bp is not null and source.diastolic_bp is not null
          when 'heart_rate' then source.heart_rate is not null when 'spo2' then source.spo2 is not null
          when 'temperature' then source.temperature_c is not null when 'glucose' then source.glucose_mg_dl is not null
          when 'weight' then source.weight_kg is not null else false end
      order by abs(extract(epoch from (source.recorded_at-o.scheduled_at))),o.scheduled_at,p.id,t.id,o.id
      limit 1 for update of o skip locked;
    if occurrence is not null and public.attach_care_plan_source(occurrence,'vital_reading',source.id,source.recorded_by_profile_id) then n:=n+1; end if;
    occurrence:=null;
  end loop;

  for source in select a.id,a.provider_id from public.appointments a where a.patient_id=target.patient_id and a.status='completed'
    and not exists(select 1 from public.care_plan_task_occurrences x where x.appointment_id=a.id) order by a.id for update of a loop
    select o.id into occurrence from public.care_plan_task_occurrences o join public.care_plan_tasks t on t.id=o.task_id
      join public.care_plans p on p.id=o.plan_id where o.patient_id=target.patient_id and o.status='pending' and t.task_type='appointment'
      and t.appointment_id=source.id and p.status='active' and p.current_version_id=o.version_id
      order by p.id,t.id,o.id limit 1 for update of o skip locked;
    if occurrence is not null and public.attach_care_plan_source(occurrence,'appointment',source.id,(select profile_id from public.providers where id=source.provider_id)) then n:=n+1; end if;
    occurrence:=null;
  end loop;

  for source in select f.id,f.assigned_to_profile_id from public.follow_ups f where f.patient_id=target.patient_id and f.status='completed'
    and not exists(select 1 from public.care_plan_task_occurrences x where x.follow_up_id=f.id) order by f.id for update of f loop
    select o.id into occurrence from public.care_plan_task_occurrences o join public.care_plan_tasks t on t.id=o.task_id
      join public.care_plans p on p.id=o.plan_id where o.patient_id=target.patient_id and o.status='pending' and t.task_type='follow_up'
      and t.follow_up_id=source.id and p.status='active' and p.current_version_id=o.version_id
      order by p.id,t.id,o.id limit 1 for update of o skip locked;
    if occurrence is not null and public.attach_care_plan_source(occurrence,'follow_up',source.id,source.assigned_to_profile_id) then n:=n+1; end if;
    occurrence:=null;
  end loop;
  return n;
end $$;

-- Completion now requires a persisted link and a still-valid authoritative
-- source. If a source is corrected later, progress fails closed; immutable
-- history and attribution are retained and are never silently rewritten.
create or replace function public.care_plan_occurrence_is_complete(p_occurrence uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(case t.task_type
    when 'medication' then o.status='completed' and exists(select 1 from public.medication_events e
      join public.medication_schedules s on s.id=e.schedule_id join public.patient_medications m on m.id=s.patient_medication_id
      where e.id=o.medication_event_id and e.patient_id=o.patient_id and e.status='taken' and e.scheduled_at=o.scheduled_at
        and s.id=t.medication_schedule_id and m.id=t.medication_id)
    when 'vital_check' then o.status='completed' and exists(select 1 from public.vital_readings v where v.id=o.vital_reading_id and v.patient_id=o.patient_id
      and v.recorded_at>=o.scheduled_at-make_interval(mins=>t.grace_minutes) and v.recorded_at<=o.scheduled_at+make_interval(mins=>t.grace_minutes)
      and case t.vital_type when 'blood_pressure' then v.systolic_bp is not null and v.diastolic_bp is not null when 'heart_rate' then v.heart_rate is not null
        when 'spo2' then v.spo2 is not null when 'temperature' then v.temperature_c is not null when 'glucose' then v.glucose_mg_dl is not null
        when 'weight' then v.weight_kg is not null else false end)
    when 'appointment' then o.status='completed' and o.appointment_id=t.appointment_id and exists(select 1 from public.appointments a where a.id=o.appointment_id and a.patient_id=o.patient_id and a.status='completed')
    when 'follow_up' then o.status='completed' and o.follow_up_id=t.follow_up_id and exists(select 1 from public.follow_ups f where f.id=o.follow_up_id and f.patient_id=o.patient_id and f.status='completed')
    else o.status='completed' end,false)
  from public.care_plan_task_occurrences o join public.care_plan_tasks t on t.id=o.task_id where o.id=p_occurrence
$$;

-- Progress is a plan projection. Source validation runs under the function
-- owner so a family care_plans grant can see derived task counts without
-- gaining access to medication, appointment or measurement detail.
create or replace function public.get_care_plan_progress(p_plan uuid,p_as_of timestamptz default statement_timestamp()) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tz text; patient uuid; today date; td integer; tc integer; all_due integer; all_done integer;
begin
  p_as_of:=coalesce(p_as_of,statement_timestamp());
  select timezone,patient_id into tz,patient from public.care_plans where id=p_plan;
  if tz is null or not public.clinical_identity_is_current() or not (exists(select 1 from public.patients pt where pt.id=patient and pt.auth_user_id=auth.uid())
     or (public.current_profile_role()='patient' and public.can_access_patient(patient,'care_plans'))
     or (public.current_profile_role() in ('doctor','nurse','caregiver') and public.can_access_patient(patient,'clinical'))) then return null; end if;
  today:=(p_as_of at time zone tz)::date;
  select count(*) filter(where o.required and o.status<>'cancelled'),count(*) filter(where o.required and public.care_plan_occurrence_is_complete(o.id)) into td,tc
    from public.care_plan_task_occurrences o where o.plan_id=p_plan and o.local_due_date=today and o.scheduled_at<=p_as_of;
  select count(*) filter(where o.required and o.status<>'cancelled'),count(*) filter(where o.required and public.care_plan_occurrence_is_complete(o.id)) into all_due,all_done
    from public.care_plan_task_occurrences o where o.plan_id=p_plan and o.scheduled_at<=p_as_of;
  return jsonb_build_object('today',jsonb_build_object('state',case when td=0 then 'no_tasks_due' else 'tasks_due' end,'completed',tc,'total',td,'percent',case when td=0 then null else round(100.0*tc/td) end),
    'plan_to_date',jsonb_build_object('state',case when all_due=0 then 'no_tasks_due' else 'tasks_due' end,'completed',all_done,'total',all_due,'percent',case when all_due=0 then null else round(100.0*all_done/all_due) end));
end $$;

create or replace function public.get_care_plan_detail(p_plan uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.care_plans; result jsonb;
begin
  select * into p from public.care_plans where id=p_plan;
  if not found or not public.clinical_identity_is_current() or not (exists(select 1 from public.patients pt where pt.id=p.patient_id and pt.auth_user_id=auth.uid())
     or (public.current_profile_role()='patient' and public.can_access_patient(p.patient_id,'care_plans'))
     or (public.current_profile_role() in ('doctor','nurse','caregiver') and public.can_access_patient(p.patient_id,'clinical'))) then return null; end if;
  select jsonb_build_object('plan',(to_jsonb(p)-'source_encounter_id') || jsonb_build_object('source_encounter_id',case when public.can_access_patient(p.patient_id,'records') then p.source_encounter_id else null end),
    'versions',coalesce((select jsonb_agg((to_jsonb(v)-'source_encounter_id') || jsonb_build_object('source_encounter_id',case when public.can_access_patient(p.patient_id,'records') then v.source_encounter_id else null end) order by v.version_no) from public.care_plan_versions v where v.plan_id=p.id),'[]'::jsonb),
    'goals',coalesce((select jsonb_agg(to_jsonb(g) order by g.sort_order,g.id) from public.care_plan_goals g where g.plan_id=p.id),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg((to_jsonb(t)-'medication_id'-'medication_schedule_id'-'appointment_id'-'follow_up_id') || jsonb_build_object(
      'medication',case when public.can_access_patient(p.patient_id,'medications') then to_jsonb(m) else null end,
      'appointment',case when public.can_access_patient(p.patient_id,'appointments') then to_jsonb(a) else null end,
      'follow_up',case when public.can_access_patient(p.patient_id,'records') then to_jsonb(f) else null end))
      from public.care_plan_tasks t left join public.patient_medications m on m.id=t.medication_id and m.patient_id=t.patient_id
      left join public.appointments a on a.id=t.appointment_id and a.patient_id=t.patient_id
      left join public.follow_ups f on f.id=t.follow_up_id and f.patient_id=t.patient_id where t.plan_id=p.id),'[]'::jsonb),
    'progress',public.get_care_plan_progress(p.id)) into result;
  return result;
end $$;

create function public.get_care_plan_occurrences(p_plan uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.care_plans; result jsonb;
begin
  select * into p from public.care_plans where id=p_plan;
  if not found or not public.clinical_identity_is_current() or not (exists(select 1 from public.patients pt where pt.id=p.patient_id and pt.auth_user_id=auth.uid())
     or (public.current_profile_role()='patient' and public.can_access_patient(p.patient_id,'care_plans'))
     or (public.current_profile_role() in ('doctor','nurse','caregiver') and public.can_access_patient(p.patient_id,'clinical'))) then return null; end if;
  select coalesce(jsonb_agg((to_jsonb(o)-'medication_event_id'-'vital_reading_id'-'appointment_id'-'follow_up_id') || jsonb_build_object(
    'completed',public.care_plan_occurrence_is_complete(o.id),
    'source',case when o.medication_event_id is not null and public.can_access_patient(p.patient_id,'medications') then jsonb_build_object('type','medication_event','id',o.medication_event_id)
      when o.vital_reading_id is not null and public.can_access_patient(p.patient_id,'records') then jsonb_build_object('type','vital_reading','id',o.vital_reading_id,'reading',(select to_jsonb(v) from public.vital_readings v where v.id=o.vital_reading_id and v.patient_id=p.patient_id))
      when o.appointment_id is not null and public.can_access_patient(p.patient_id,'appointments') then jsonb_build_object('type','appointment','id',o.appointment_id)
      when o.follow_up_id is not null and public.can_access_patient(p.patient_id,'records') then jsonb_build_object('type','follow_up','id',o.follow_up_id)
      else null end) order by o.scheduled_at,o.id)) into result
    from public.care_plan_task_occurrences o where o.plan_id=p.id and o.patient_id=p.patient_id;
  return coalesce(result,'[]'::jsonb);
end $$;

create function public.get_care_plan_events(p_plan uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.care_plans; result jsonb;
begin
  select * into p from public.care_plans where id=p_plan;
  if not found or not public.clinical_identity_is_current() or not (exists(select 1 from public.patients pt where pt.id=p.patient_id and pt.auth_user_id=auth.uid())
     or (public.current_profile_role()='patient' and public.can_access_patient(p.patient_id,'care_plans'))
     or (public.current_profile_role() in ('doctor','nurse','caregiver') and public.can_access_patient(p.patient_id,'clinical'))) then return null; end if;
  select coalesce(jsonb_agg((to_jsonb(e)-'source_id'-'source_type') || jsonb_build_object('source',case
    when e.source_type='medication_event' and public.can_access_patient(p.patient_id,'medications') then jsonb_build_object('type',e.source_type,'id',e.source_id)
    when e.source_type='vital_reading' and public.can_access_patient(p.patient_id,'records') then jsonb_build_object('type',e.source_type,'id',e.source_id)
    when e.source_type='appointment' and public.can_access_patient(p.patient_id,'appointments') then jsonb_build_object('type',e.source_type,'id',e.source_id)
    when e.source_type='follow_up' and public.can_access_patient(p.patient_id,'records') then jsonb_build_object('type',e.source_type,'id',e.source_id)
    else null end) order by e.occurred_at,e.id)) into result from public.care_plan_events e where e.plan_id=p.id;
  return coalesce(result,'[]'::jsonb);
end $$;

create function public.list_my_care_plan_summaries() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.clinical_identity_is_current() then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'patient_id',p.patient_id,'status',p.status,'timezone',p.timezone,
      'starts_at',p.starts_at,'target_end_at',p.target_end_at,'created_at',p.created_at,
      'source_encounter_id',case when public.can_access_patient(p.patient_id,'records') then p.source_encounter_id else null end,
      'current_version',case when v.id is null then null else jsonb_build_object('id',v.id,'version_no',v.version_no,'title',v.title,'summary',v.summary,'instructions',v.instructions) end,
      'progress',public.get_care_plan_progress(p.id)) order by p.starts_at desc,p.id),'[]'::jsonb) into result
  from public.care_plans p left join public.care_plan_versions v on v.id=p.current_version_id and v.plan_id=p.id and v.patient_id=p.patient_id
  where exists(select 1 from public.patients pt where pt.id=p.patient_id and pt.auth_user_id=auth.uid())
    or (public.current_profile_role()='patient' and public.can_access_patient(p.patient_id,'care_plans'))
    or (public.current_profile_role() in ('doctor','nurse','caregiver') and public.can_access_patient(p.patient_id,'clinical'));
  return result;
end $$;

drop policy care_plans_read on public.care_plans;
create policy care_plans_read on public.care_plans for select to authenticated using (
  public.clinical_identity_is_current() and (
    exists(select 1 from public.patients p where p.id=care_plans.patient_id and p.auth_user_id=auth.uid())
    or (public.current_profile_role()='patient' and public.can_access_patient(care_plans.patient_id,'care_plans'))
    or (public.current_profile_role() in ('doctor','nurse','caregiver') and public.can_access_patient(care_plans.patient_id,'clinical'))
  )
);

-- Hide raw link-bearing rows from browser SELECT. Secure projection RPCs above
-- return only fields authorized by the independent source scope.
revoke select on public.care_plans,public.care_plan_versions,public.care_plan_goals,public.care_plan_tasks,public.care_plan_task_occurrences,public.care_plan_events from authenticated;
revoke all on function public.attach_care_plan_source(uuid,text,uuid,uuid),public.set_care_plan_source_occurrence_time(),public.care_plan_occurrence_is_complete(uuid) from public,anon,authenticated;
revoke all on function public.reconcile_care_plan_occurrences(uuid),public.get_care_plan_occurrences(uuid),public.get_care_plan_events(uuid),public.list_my_care_plan_summaries() from public,anon;
grant execute on function public.reconcile_care_plan_occurrences(uuid),public.get_care_plan_occurrences(uuid),public.get_care_plan_events(uuid),public.list_my_care_plan_summaries() to authenticated;
revoke all on function public.get_care_plan_detail(uuid),public.get_care_plan_progress(uuid,timestamptz) from public,anon;
grant execute on function public.get_care_plan_detail(uuid),public.get_care_plan_progress(uuid,timestamptz) to authenticated;
revoke all on function public.list_my_care_plans() from public,anon,authenticated;

commit;
