begin;

-- One bounded generator is shared by the responsible-provider RPC and the
-- trusted maintenance batch. The plan row lock serializes lifecycle changes
-- and competing generation; the occurrence unique key remains the final guard.
create or replace function public.care_plan_extend_occurrences_internal(p_plan uuid,p_through date default null)
returns integer language plpgsql security definer set search_path='' as $$
declare p public.care_plans; t record; d date; tm time; limit_date date; inserted_count integer:=0; due timestamptz; n integer; plan_today date;
begin
  select * into p from public.care_plans where id=p_plan for update;
  if not found or p.status<>'active' or p.current_version_id is null then return 0; end if;
  plan_today:=(statement_timestamp() at time zone p.timezone)::date;
  limit_date:=least(coalesce(p_through,plan_today+30),plan_today+30);
  if p.target_end_at is not null then limit_date:=least(limit_date,(p.target_end_at at time zone p.timezone)::date); end if;
  if limit_date<plan_today then return 0; end if;
  for t in select * from public.care_plan_tasks where plan_id=p.id and version_id=p.current_version_id and patient_id=p.patient_id loop
    if (select count(*) from public.care_plan_tasks where plan_id=p.id and version_id=p.current_version_id)>100 then raise exception 'Task limit exceeded' using errcode='22023'; end if;
    d:=greatest(t.starts_on,plan_today,(p.starts_at at time zone t.timezone)::date);
    while d<=limit_date and (t.ends_on is null or d<=t.ends_on) loop
      if t.recurrence='one_time' and d<>t.starts_on then exit; end if;
      if t.recurrence not in ('selected_weekdays','source_schedule') or (t.recurrence='selected_weekdays' and extract(dow from d)::smallint=any(t.weekdays)) or t.recurrence='source_schedule' then
        foreach tm in array case when t.recurrence='source_schedule'
          then (select coalesce(array_agg(ms.time_of_day order by ms.time_of_day),array[]::time[]) from public.medication_schedules ms where ms.id=t.medication_schedule_id and ms.patient_medication_id=t.medication_id and (ms.valid_from is null or d>=ms.valid_from) and (ms.valid_until is null or d<=ms.valid_until) and (ms.days_of_week is null or extract(dow from d)::smallint=any(ms.days_of_week)))
          else t.local_times end loop
          due:=(d+tm) at time zone t.timezone;
          if p.target_end_at is null or due<=p.target_end_at then
            insert into public.care_plan_task_occurrences(task_id,plan_id,version_id,patient_id,occurrence_key,scheduled_at,local_due_date,local_due_time,timezone,required,appointment_id,follow_up_id)
              values(t.id,p.id,t.version_id,p.patient_id,d::text||'T'||tm::text,due,d,tm,t.timezone,t.required,t.appointment_id,t.follow_up_id)
              on conflict(task_id,occurrence_key) do nothing;
            get diagnostics n=row_count; inserted_count:=inserted_count+n;
          end if;
        end loop;
      end if;
      if t.recurrence='one_time' then exit; end if;
      d:=d+1;
    end loop;
  end loop;
  return inserted_count;
end $$;
revoke all on function public.care_plan_extend_occurrences_internal(uuid,date) from public,anon,authenticated;

create or replace function public.extend_care_plan_occurrences(p_plan uuid,p_through date default null)
returns integer language plpgsql security definer set search_path='' as $$
declare p public.care_plans;
begin
  select * into p from public.care_plans where id=p_plan;
  if not found then raise exception 'Plan unavailable' using errcode='42501'; end if;
  perform public.assert_care_plan_doctor(p.patient_id,p.responsible_provider_id);
  if p.status<>'active' then raise exception 'Only active plans can generate occurrences' using errcode='22023'; end if;
  return public.care_plan_extend_occurrences_internal(p_plan,p_through);
end $$;

-- A single invocation processes at most 50 plans. Pass next_after_id to page
-- through the active population; restart at NULL on the next scheduled run.
-- Each plan runs inside a PL/pgSQL exception subtransaction so one invalid
-- plan is reported without rolling back successful work for its neighbors.
create or replace function public.maintain_care_plan_occurrence_horizons(p_after_id uuid default null,p_batch_size integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target record; processed integer:=0; generated integer:=0; failures jsonb:='[]'::jsonb; next_id uuid; count_generated integer; batch_size integer;
begin
  batch_size:=least(greatest(coalesce(p_batch_size,25),1),50);
  for target in
    select plan.id,plan.patient_id from public.care_plans plan
    where plan.status='active' and plan.current_version_id is not null and (p_after_id is null or plan.id>p_after_id)
      and (plan.target_end_at is null or plan.target_end_at>=statement_timestamp())
    order by plan.id limit batch_size
  loop
    next_id:=target.id;
    begin
      count_generated:=public.care_plan_extend_occurrences_internal(target.id,null);
      perform public.reconcile_care_plan_patient_internal(target.patient_id);
      generated:=generated+count_generated;
    exception when others then
      failures:=failures||jsonb_build_array(jsonb_build_object('plan_id',target.id,'sqlstate',sqlstate,'message',sqlerrm));
    end;
    processed:=processed+1;
  end loop;
  return jsonb_build_object('processed',processed,'generated',generated,'failures',failures,'next_after_id',next_id,
    'has_more',exists(select 1 from public.care_plans plan where plan.status='active' and plan.current_version_id is not null and (plan.target_end_at is null or plan.target_end_at>=statement_timestamp()) and (p_after_id is null or plan.id>coalesce(next_id,p_after_id))));
end $$;
revoke all on function public.maintain_care_plan_occurrence_horizons(uuid,integer) from public,anon,authenticated;
grant execute on function public.maintain_care_plan_occurrence_horizons(uuid,integer) to service_role;

-- Provider-controlled activation/resume keeps the same validated identity
-- check; generation itself uses the shared private, bounded implementation.
create or replace function public.transition_care_plan(p_plan uuid,p_intent text,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare p public.care_plans; next_status public.care_plan_status; event text;
begin
  select * into p from public.care_plans where id=p_plan for update;
  if not found then raise exception 'Plan unavailable' using errcode='42501'; end if;
  perform public.assert_care_plan_doctor(p.patient_id,p.responsible_provider_id);
  next_status:=case p_intent when 'activate' then 'active'::public.care_plan_status when 'resume' then 'active'::public.care_plan_status when 'pause' then 'paused'::public.care_plan_status when 'complete' then 'completed'::public.care_plan_status when 'discontinue' then 'discontinued'::public.care_plan_status when 'cancel' then 'cancelled'::public.care_plan_status else null end;
  if next_status is null or not ((p.status='draft' and p_intent in ('activate','cancel') and (p_intent='cancel' or p.current_version_id is not null)) or (p.status='active' and p_intent in ('pause','complete','discontinue')) or (p.status='paused' and p_intent in ('resume','complete','discontinue'))) then raise exception 'Invalid care plan transition' using errcode='22023'; end if;
  event:=case p_intent when 'activate' then 'plan_activated' when 'resume' then 'plan_resumed' when 'pause' then 'plan_paused' when 'complete' then 'plan_completed' when 'discontinue' then 'plan_discontinued' else 'plan_cancelled' end;
  update public.care_plans set status=next_status,updated_at=statement_timestamp() where id=p.id;
  if p_intent in ('activate','resume') then
    perform public.care_plan_extend_occurrences_internal(p.id,null);
    perform public.reconcile_care_plan_patient_internal(p.patient_id);
  end if;
  insert into public.care_plan_events(plan_id,patient_id,version_id,event_type,actor_profile_id,provider_id,previous_status,new_status,reason)
    values(p.id,p.patient_id,p.current_version_id,event,auth.uid(),p.responsible_provider_id,p.status::text,next_status::text,p_reason);
end $$;

commit;
