begin;

create function public.list_my_provider_care_plans()
returns table(plan_id uuid, patient_id uuid, patient_name text, status text, timezone text,
  starts_at timestamptz, target_end_at timestamptz, updated_at timestamptz,
  version_id uuid, version_no integer, title text, summary text, instructions text)
language plpgsql stable security definer set search_path='' as $$
declare current_provider uuid; current_type public.provider_type;
begin
  select identity.provider_id, identity.provider_type into current_provider, current_type
  from public.get_my_provider_identity() identity;
  if current_provider is null or current_type<>'doctor' then return; end if;
  return query select p.id,p.patient_id,pt.full_name,p.status::text,p.timezone,p.starts_at,p.target_end_at,p.updated_at,
    v.id,v.version_no,v.title,v.summary,v.instructions
  from public.care_plans p join public.patients pt on pt.id=p.patient_id
  left join public.care_plan_versions v on v.id=coalesce(p.current_version_id,
    (select draft.id from public.care_plan_versions draft where draft.plan_id=p.id and draft.patient_id=p.patient_id and draft.status='draft' order by draft.version_no desc limit 1))
    and v.plan_id=p.id and v.patient_id=p.patient_id
  where p.responsible_provider_id=current_provider and public.can_access_patient(p.patient_id,'clinical')
  order by p.updated_at desc,p.id;
end $$;

create function public.get_my_provider_care_plan(p_plan uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare current_provider uuid; result jsonb;
begin
  select identity.provider_id into current_provider from public.get_my_provider_identity() identity
    where identity.provider_type='doctor';
  if current_provider is null then return null; end if;
  if not exists(select 1 from public.care_plans p where p.id=p_plan
    and p.responsible_provider_id=current_provider and public.can_access_patient(p.patient_id,'clinical')) then return null; end if;
  result:=public.get_care_plan_detail(p_plan);
  select result || jsonb_build_object('patient',jsonb_build_object('id',pt.id,'full_name',pt.full_name))
    into result from public.care_plans p join public.patients pt on pt.id=p.patient_id where p.id=p_plan;
  return result;
end $$;

-- Publishing a replacement version on an active plan also materializes the
-- new version's bounded horizon and reconciles source events transactionally.
create function public.approve_provider_care_plan_version(p_plan uuid,p_change_reason text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare target public.care_plans; version uuid;
begin
  select * into target from public.care_plans where id=p_plan for update;
  if not found then raise exception 'Plan unavailable' using errcode='42501'; end if;
  perform public.assert_care_plan_doctor(target.patient_id,target.responsible_provider_id);
  version:=public.approve_care_plan_version(p_plan,p_change_reason);
  if target.status='active' then
    perform public.extend_care_plan_occurrences(p_plan,null);
    perform public.reconcile_care_plan_patient_internal(target.patient_id);
  end if;
  return version;
end $$;

create function public.list_provider_care_plan_sources(p_patient uuid,p_kind text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare current_provider uuid; current_type public.provider_type; result jsonb;
begin
  select identity.provider_id,identity.provider_type into current_provider,current_type from public.get_my_provider_identity() identity;
  if current_provider is null or current_type<>'doctor' or not public.can_access_patient(p_patient,'clinical') then
    raise exception 'Authorized clinical provider required' using errcode='42501'; end if;
  if p_kind='medication' then
    select coalesce(jsonb_agg(jsonb_build_object('medication_id',m.id,'name',m.medication_name,'dose',m.dose,
      'schedule_id',s.id,'time_of_day',s.time_of_day,'days_of_week',s.days_of_week,'timezone',s.timezone,
      'valid_from',s.valid_from,'valid_until',s.valid_until) order by m.medication_name,s.time_of_day),'[]'::jsonb) into result
    from public.patient_medications m join public.medication_schedules s on s.patient_medication_id=m.id
    where m.patient_id=p_patient and m.status='active'
      and (m.end_date is null or m.end_date>=current_date)
      and (s.valid_from is null or s.valid_from<=current_date)
      and (s.valid_until is null or s.valid_until>=current_date);
  elsif p_kind='appointment' then
    select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'appointment_type',a.appointment_type,
      'scheduled_start',a.scheduled_start,'status',a.status) order by a.scheduled_start),'[]'::jsonb) into result
    from public.appointments a where a.patient_id=p_patient and a.scheduled_start is not null
      and a.status in ('pending','confirmed','rescheduled');
  elsif p_kind='follow_up' then
    select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'follow_up_type',f.follow_up_type,
      'due_at',f.due_at,'status',f.status) order by f.due_at),'[]'::jsonb) into result
    from public.follow_ups f where f.patient_id=p_patient and f.status='pending' and f.due_at is not null;
  else raise exception 'Unsupported source type' using errcode='22023'; end if;
  return result;
end $$;

revoke all on function public.list_my_provider_care_plans(),public.get_my_provider_care_plan(uuid),
  public.list_provider_care_plan_sources(uuid,text),public.approve_provider_care_plan_version(uuid,text) from public,anon;
grant execute on function public.list_my_provider_care_plans(),public.get_my_provider_care_plan(uuid),
  public.list_provider_care_plan_sources(uuid,text),public.approve_provider_care_plan_version(uuid,text) to authenticated;

commit;
