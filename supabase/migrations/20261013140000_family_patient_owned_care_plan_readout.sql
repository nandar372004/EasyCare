begin;

-- Read-only projection for the patient-owned modules shown in My Care Plan.
-- The caller supplies a family membership ID, never a patient ID. The RPC
-- resolves that member and rechecks the active care_plans grant before reading.
create function public.get_family_patient_care_plan_readout(p_group_id uuid, p_member_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_patient uuid;
  target_patient uuid;
  result jsonb;
  today date := (statement_timestamp() at time zone 'Asia/Yangon')::date;
  can_read_medications boolean;
  can_read_appointments boolean;
  can_read_records boolean;
begin
  viewer_patient := public.require_family_patient();
  if not public.clinical_identity_is_current()
    or not exists(select 1 from public.patients v where v.id=viewer_patient and v.date_of_birth<=(current_date-interval '18 years')::date)
    or not public.is_family_group_member(p_group_id) then
    raise exception 'Family Care Plan unavailable' using errcode='42501';
  end if;

  select p.id into target_patient
  from public.family_group_members m
  join public.patients p on p.id=m.patient_id
  join public.profiles pr on pr.id=p.profile_id
  where m.id=p_member_id and m.family_group_id=p_group_id and m.status='active'
    and m.patient_id<>viewer_patient and p.status='active' and pr.status='active' and pr.role='patient'
    and p.date_of_birth<=(current_date-interval '18 years')::date;
  if target_patient is null or not public.can_access_patient(target_patient,'care_plans') then
    raise exception 'Family Care Plan unavailable' using errcode='42501';
  end if;

  can_read_medications := public.can_access_patient(target_patient,'medications');
  can_read_appointments := public.can_access_patient(target_patient,'appointments');
  can_read_records := public.can_access_patient(target_patient,'records');

  select jsonb_build_object(
    'as_of_date',today,
    'access',jsonb_build_object(
      'medications',can_read_medications,
      'appointments',can_read_appointments,
      'records',can_read_records
    ),
    'health_goals',coalesce((
      select jsonb_agg(jsonb_build_object('id',g.id,'title',g.title,'is_completed',g.is_completed,'created_at',g.created_at)
        order by g.created_at,g.id)
      from public.patient_health_goals g where g.patient_id=target_patient
    ),'[]'::jsonb),
    'medications',case when can_read_medications then coalesce((
      select jsonb_agg(medication order by medication->>'medication_name', medication->>'id') from (
        select jsonb_build_object(
          'id',m.id,'medication_name',m.medication_name,'dose',m.dose,'frequency',m.frequency,
          'instructions',m.instructions,'status',m.status,'start_date',m.start_date,'end_date',m.end_date,
          'source','clinical',
          'medication_schedules',coalesce((
            select jsonb_agg(jsonb_build_object(
              'id',s.id,'time_of_day',s.time_of_day,'days_of_week',s.days_of_week,'timezone',s.timezone,
              'valid_from',s.valid_from,'valid_until',s.valid_until,
              'events',coalesce((
                select jsonb_agg(jsonb_build_object('id',e.id,'scheduled_at',e.scheduled_at,'status',e.status,'confirmed_at',e.confirmed_at)
                  order by e.scheduled_at,e.id)
                from public.medication_events e
                where e.schedule_id=s.id and e.patient_id=target_patient
                  and (e.scheduled_at at time zone coalesce(nullif(s.timezone,''),'Asia/Yangon'))::date =
                      (statement_timestamp() at time zone coalesce(nullif(s.timezone,''),'Asia/Yangon'))::date
              ),'[]'::jsonb)
            ) order by s.time_of_day,s.id)
            from public.medication_schedules s where s.patient_medication_id=m.id
          ),'[]'::jsonb),
          'today_check_ins',coalesce((
            select jsonb_agg(jsonb_build_object('id',c.id,'local_date',c.local_date,'occurrence_index',c.occurrence_index,
              'is_prn',c.is_prn,'status',c.status,'completed_at',c.completed_at) order by c.occurrence_index,c.id)
            from public.patient_medication_check_ins c
            where c.patient_medication_id=m.id and c.patient_id=target_patient and c.local_date=today
          ),'[]'::jsonb)
        ) as medication
        from public.patient_medications m
        where m.patient_id=target_patient and m.status='active'
          and (m.start_date is null or m.start_date<=today) and (m.end_date is null or m.end_date>=today)
        union all
        select jsonb_build_object(
          'id',i.id,'medication_name',i.item_name,'dose',i.details->>'dose',
          'frequency',i.details->>'frequency','instructions',i.details->>'reason',
          'status','active','source','patient_reported','medication_schedules','[]'::jsonb,'today_check_ins','[]'::jsonb
        ) as medication
        from public.patient_reported_health_items i
        where i.patient_id=target_patient and i.item_type='medication' and i.entry_kind='item'
          and i.record_status='active'
      ) medication_rows
    ),'[]'::jsonb) else '[]'::jsonb end,
    'monitoring_plans',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',mp.id,'title',mp.title,'related_context',mp.related_context,
        'recurrence_type',mp.recurrence_type,'days_of_week',mp.days_of_week,
        'start_date',mp.start_date,'end_date',mp.end_date,'is_active',mp.is_active,
        'measurement_type',mp.measurement_type,'measurement_unit',mp.measurement_unit,
        'times',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'time_of_day',t.time_of_day) order by t.time_of_day,t.id)
          from public.patient_monitoring_plan_times t where t.monitoring_plan_id=mp.id),'[]'::jsonb)
      ) order by mp.created_at,mp.id)
      from public.patient_monitoring_plans mp where mp.patient_id=target_patient
    ),'[]'::jsonb),
    'monitoring_check_ins',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',ci.id,'monitoring_plan_id',ci.monitoring_plan_id,'local_date',ci.local_date,
        'occurrence_key',ci.occurrence_key,'occurrence_label',ci.occurrence_label,
        'status',ci.status,'completed_at',ci.completed_at,
        'measurement_value',case when can_read_records then ci.measurement_value else null end,
        'measurement_unit',case when can_read_records then ci.measurement_unit else null end,
        'systolic_value',case when can_read_records then ci.systolic_value else null end,
        'diastolic_value',case when can_read_records then ci.diastolic_value else null end
      ) order by ci.local_date desc,ci.completed_at desc nulls last,ci.id)
      from public.patient_monitoring_check_ins ci
      where ci.patient_id=target_patient and ci.local_date between today-6 and today
    ),'[]'::jsonb),
    'monitoring_latest',case when can_read_records then coalesce((
      select jsonb_agg(jsonb_build_object('monitoring_plan_id',latest.monitoring_plan_id,
        'local_date',latest.local_date,'completed_at',latest.completed_at,
        'measurement_value',latest.measurement_value,'measurement_unit',latest.measurement_unit,
        'systolic_value',latest.systolic_value,'diastolic_value',latest.diastolic_value)
        order by latest.monitoring_plan_id)
      from (select distinct on (ci.monitoring_plan_id) ci.monitoring_plan_id,ci.local_date,ci.completed_at,
        ci.measurement_value,ci.measurement_unit,ci.systolic_value,ci.diastolic_value
        from public.patient_monitoring_check_ins ci
        where ci.patient_id=target_patient and ci.status='done'
          and (ci.measurement_value is not null or ci.systolic_value is not null)
        order by ci.monitoring_plan_id,ci.local_date desc,ci.completed_at desc nulls last,ci.id desc) latest
    ),'[]'::jsonb) else '[]'::jsonb end,
    'lifestyle_plans',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',lp.id,'title',lp.title,'description',lp.description,'category',lp.category,'is_active',lp.is_active,
        'resources',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'url',r.url,'resource_type',r.resource_type)
          order by r.created_at,r.id) from public.patient_lifestyle_resources r
          where r.lifestyle_plan_id=lp.id and r.patient_id=target_patient),'[]'::jsonb)
      ) order by lp.created_at,lp.id)
      from public.patient_lifestyle_plans lp where lp.patient_id=target_patient and lp.is_active
    ),'[]'::jsonb),
    'appointments',case when can_read_appointments then coalesce((
      select jsonb_agg(jsonb_build_object('id',a.id,'provider_id',a.provider_id,
        'appointment_type',a.appointment_type,'consultation_channel',a.consultation_channel,
        'scheduled_start',a.scheduled_start,'scheduled_end',a.scheduled_end,'status',a.status)
        order by a.scheduled_start,a.id)
      from public.appointments a where a.patient_id=target_patient and a.status in ('pending','confirmed','rescheduled')
        and a.scheduled_start>=statement_timestamp()
    ),'[]'::jsonb) else '[]'::jsonb end
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_family_patient_care_plan_readout(uuid,uuid) from public,anon;
grant execute on function public.get_family_patient_care_plan_readout(uuid,uuid) to authenticated;
comment on function public.get_family_patient_care_plan_readout(uuid,uuid) is
  'Read-only patient-owned My Care Plan projection for an accepted adult family member. Requires active care_plans permission; medication, appointment, and measurement detail is masked unless its independent family scope is active.';

notify pgrst, 'reload schema';
commit;
