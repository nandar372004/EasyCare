begin;

-- Shared implementation for the authenticated RPC and trusted source triggers.
-- Keep the 4B.1 matching rules in one server-side function.
create function public.reconcile_care_plan_patient_internal(p_patient uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare source record; occurrence uuid; n integer:=0;
begin
  perform 1 from public.patients where id=p_patient for update;
  if not found then return 0; end if;

  for source in select e.id,e.schedule_id,e.scheduled_at,e.confirmed_by_profile_id
    from public.medication_events e join public.medication_schedules s on s.id=e.schedule_id
    join public.patient_medications m on m.id=s.patient_medication_id
    where e.patient_id=p_patient and m.patient_id=p_patient and e.status='taken'
      and not exists(select 1 from public.care_plan_task_occurrences x where x.medication_event_id=e.id)
    order by e.scheduled_at,e.id for update of e loop
    select o.id into occurrence from public.care_plan_task_occurrences o
      join public.care_plan_tasks t on t.id=o.task_id join public.care_plans p on p.id=o.plan_id
      where o.patient_id=p_patient and o.status='pending' and o.medication_event_id is null and o.vital_reading_id is null
        and o.appointment_id is null and o.follow_up_id is null and o.scheduled_at=source.scheduled_at
        and t.task_type='medication' and t.medication_schedule_id=source.schedule_id
        and p.status='active' and p.current_version_id=o.version_id
      order by o.scheduled_at,p.id,t.id,o.id limit 1 for update of o skip locked;
    if occurrence is not null and public.attach_care_plan_source(occurrence,'medication_event',source.id,source.confirmed_by_profile_id) then n:=n+1; end if;
    occurrence:=null;
  end loop;

  for source in select v.id,v.recorded_at,v.recorded_by_profile_id,v.systolic_bp,v.diastolic_bp,v.heart_rate,v.spo2,v.temperature_c,v.glucose_mg_dl,v.weight_kg
    from public.vital_readings v where v.patient_id=p_patient
      and (v.systolic_bp is not null or v.diastolic_bp is not null or v.heart_rate is not null or v.spo2 is not null or v.temperature_c is not null or v.glucose_mg_dl is not null or v.weight_kg is not null)
      and not exists(select 1 from public.care_plan_task_occurrences x where x.vital_reading_id=v.id)
    order by v.recorded_at,v.id for update of v loop
    select o.id into occurrence from public.care_plan_task_occurrences o
      join public.care_plan_tasks t on t.id=o.task_id join public.care_plans p on p.id=o.plan_id
      where o.patient_id=p_patient and o.status='pending' and o.medication_event_id is null and o.vital_reading_id is null
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

  for source in select a.id,a.provider_id from public.appointments a where a.patient_id=p_patient and a.status='completed'
    and not exists(select 1 from public.care_plan_task_occurrences x where x.appointment_id=a.id) order by a.id for update of a loop
    select o.id into occurrence from public.care_plan_task_occurrences o join public.care_plan_tasks t on t.id=o.task_id
      join public.care_plans p on p.id=o.plan_id where o.patient_id=p_patient and o.status='pending' and t.task_type='appointment'
      and t.appointment_id=source.id and p.status='active' and p.current_version_id=o.version_id
      order by p.id,t.id,o.id limit 1 for update of o skip locked;
    if occurrence is not null and public.attach_care_plan_source(occurrence,'appointment',source.id,(select profile_id from public.providers where id=source.provider_id)) then n:=n+1; end if;
    occurrence:=null;
  end loop;

  for source in select f.id,f.assigned_to_profile_id from public.follow_ups f where f.patient_id=p_patient and f.status='completed'
    and not exists(select 1 from public.care_plan_task_occurrences x where x.follow_up_id=f.id) order by f.id for update of f loop
    select o.id into occurrence from public.care_plan_task_occurrences o join public.care_plan_tasks t on t.id=o.task_id
      join public.care_plans p on p.id=o.plan_id where o.patient_id=p_patient and o.status='pending' and t.task_type='follow_up'
      and t.follow_up_id=source.id and p.status='active' and p.current_version_id=o.version_id
      order by p.id,t.id,o.id limit 1 for update of o skip locked;
    if occurrence is not null and public.attach_care_plan_source(occurrence,'follow_up',source.id,source.assigned_to_profile_id) then n:=n+1; end if;
    occurrence:=null;
  end loop;
  return n;
end $$;
revoke all on function public.reconcile_care_plan_patient_internal(uuid) from public,anon,authenticated;

create or replace function public.reconcile_care_plan_occurrences(p_plan uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare target public.care_plans;
begin
  select * into target from public.care_plans where id=p_plan;
  if not found then raise exception 'Care plan unavailable' using errcode='42501'; end if;
  if not exists(select 1 from public.patients pt where pt.id=target.patient_id and pt.auth_user_id=auth.uid()) then
    perform public.assert_care_plan_doctor(target.patient_id,target.responsible_provider_id);
    if target.responsible_provider_id is distinct from (select pr.id from public.providers pr where pr.profile_id=auth.uid() and pr.provider_type='doctor' and pr.verification_status='verified') then
      raise exception 'Care plan unavailable' using errcode='42501';
    end if;
  end if;
  return public.reconcile_care_plan_patient_internal(target.patient_id);
end $$;

create function public.reconcile_care_plan_after_source_write() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='medication_events' then
    if new.status='taken' then perform public.reconcile_care_plan_patient_internal(new.patient_id); end if;
  elsif tg_table_name='vital_readings' then
    if new.systolic_bp is not null or new.diastolic_bp is not null or new.heart_rate is not null or new.spo2 is not null
      or new.temperature_c is not null or new.glucose_mg_dl is not null or new.weight_kg is not null then
      perform public.reconcile_care_plan_patient_internal(new.patient_id);
    end if;
  elsif tg_table_name='appointments' then
    if new.status='completed' then perform public.reconcile_care_plan_patient_internal(new.patient_id); end if;
  elsif tg_table_name='follow_ups' then
    if new.status='completed' then perform public.reconcile_care_plan_patient_internal(new.patient_id); end if;
  end if;
  return new;
end $$;
revoke all on function public.reconcile_care_plan_after_source_write() from public,anon,authenticated;

create trigger medication_events_care_plan_reconcile
  after insert or update of status on public.medication_events
  for each row when (new.status='taken') execute function public.reconcile_care_plan_after_source_write();
create trigger vital_readings_care_plan_reconcile
  after insert or update of patient_id,recorded_at,systolic_bp,diastolic_bp,heart_rate,spo2,temperature_c,glucose_mg_dl,weight_kg on public.vital_readings
  for each row execute function public.reconcile_care_plan_after_source_write();
create trigger appointments_care_plan_reconcile
  after insert or update of status on public.appointments
  for each row when (new.status='completed') execute function public.reconcile_care_plan_after_source_write();
create trigger follow_ups_care_plan_reconcile
  after insert or update of status on public.follow_ups
  for each row when (new.status='completed') execute function public.reconcile_care_plan_after_source_write();

-- Plan activation and resume atomically materialize the existing capped horizon.
create or replace function public.transition_care_plan(p_plan uuid,p_intent text,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare p public.care_plans; next_status public.care_plan_status; event text;
begin
  select * into p from public.care_plans where id=p_plan for update;
  if not found then raise exception 'Plan unavailable' using errcode='42501'; end if;
  perform public.assert_care_plan_doctor(p.patient_id,p.responsible_provider_id);
  next_status:=case p_intent when 'activate' then 'active'::public.care_plan_status when 'resume' then 'active'::public.care_plan_status
    when 'pause' then 'paused'::public.care_plan_status when 'complete' then 'completed'::public.care_plan_status
    when 'discontinue' then 'discontinued'::public.care_plan_status when 'cancel' then 'cancelled'::public.care_plan_status else null end;
  if next_status is null or not ((p.status='draft' and p_intent in ('activate','cancel') and (p_intent='cancel' or p.current_version_id is not null))
    or (p.status='active' and p_intent in ('pause','complete','discontinue')) or (p.status='paused' and p_intent in ('resume','complete','discontinue'))) then
    raise exception 'Invalid care plan transition' using errcode='22023';
  end if;
  event:=case p_intent when 'activate' then 'plan_activated' when 'resume' then 'plan_resumed' when 'pause' then 'plan_paused'
    when 'complete' then 'plan_completed' when 'discontinue' then 'plan_discontinued' else 'plan_cancelled' end;
  update public.care_plans set status=next_status,updated_at=statement_timestamp() where id=p.id;
  if p_intent in ('activate','resume') then
    perform public.extend_care_plan_occurrences(p.id,null);
    perform public.reconcile_care_plan_patient_internal(p.patient_id);
  end if;
  insert into public.care_plan_events(plan_id,patient_id,version_id,event_type,actor_profile_id,provider_id,previous_status,new_status,reason)
    values(p.id,p.patient_id,p.current_version_id,event,auth.uid(),p.responsible_provider_id,p.status::text,next_status::text,p_reason);
end $$;

commit;
