begin;
set local lock_timeout = '10s';

-- Fail closed if appointment RLS differs from the inspected scoped contract.
-- Column privileges never bypass RLS; no table-wide SELECT or write grant.
do $$
begin
  if not (select relrowsecurity from pg_class where oid='public.appointments'::regclass)
    or (select rolbypassrls from pg_roles where rolname='authenticated')
    or (select count(*) from pg_policies where schemaname='public' and tablename='appointments'
        and permissive='PERMISSIVE' and cmd in ('SELECT','ALL') and roles && array['authenticated','public']::name[]) <> 2
    or not exists (select 1 from pg_policies where schemaname='public' and tablename='appointments'
      and policyname='appointments_family_read' and cmd='SELECT' and roles=array['authenticated']::name[]
      and regexp_replace(replace(qual,'public.',''),'\s','','g')=
        '((current_profile_role()=''patient''::profile_role)ANDcan_access_patient(patient_id,''appointments''::text))')
    or not exists (select 1 from pg_policies where schemaname='public' and tablename='appointments'
      and policyname='appointments_patient_read' and cmd='SELECT' and roles=array['authenticated']::name[]
      and regexp_replace(replace(qual,'public.',''),'\s','','g')=
        '(EXISTS(SELECT1FROMpatientspatientWHERE((patient.id=appointments.patient_id)AND(patient.auth_user_id=auth.uid()))))') then
    raise exception 'Phase J repair requires the existing scoped appointment RLS contract';
  end if;
end $$;
grant select (updated_at) on public.appointments to authenticated;

-- Both nullable fields are published in 20260929150000. Restore only fields
-- consumed by Phase J; do not replay its historical clinical-data backfills.
alter table public.monitoring_alerts
  add column if not exists title text,
  add column if not exists detected_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.monitoring_alerts'::regclass and conname='monitoring_alerts_title_check') then
    alter table public.monitoring_alerts add constraint monitoring_alerts_title_check
      check (title is null or length(btrim(title)) between 1 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.monitoring_alerts'::regclass and conname='monitoring_alerts_detected_at_check') then
    alter table public.monitoring_alerts add constraint monitoring_alerts_detected_at_check
      check (detected_at is null or isfinite(detected_at));
  end if;
end $$;

-- Restore published read projections only. Existing progress/completion
-- functions, triggers, mutations, raw-table privileges and RLS stay unchanged.
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

create or replace function public.get_care_plan_occurrences(p_plan uuid) returns jsonb
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

create or replace function public.list_my_care_plan_summaries() returns jsonb
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

revoke all on function public.get_care_plan_detail(uuid),public.get_care_plan_occurrences(uuid),public.list_my_care_plan_summaries() from public,anon;
grant execute on function public.get_care_plan_detail(uuid),public.get_care_plan_occurrences(uuid),public.list_my_care_plan_summaries() to authenticated;

-- Family callers identify the selected member through the accepted family
-- membership row. They never supply a patient UUID, and the existing
-- Phase 4B.1 projections remain responsible for source masking.
create or replace function public.get_family_care_plan_readout(p_group_id uuid,p_member_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer_patient uuid; target_patient uuid; result jsonb;
begin
  viewer_patient:=public.require_family_patient();
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'plan',projection.detail->'plan','versions',projection.detail->'versions','goals',projection.detail->'goals','tasks',projection.detail->'tasks',
    'progress',projection.detail->'progress','occurrences',public.get_care_plan_occurrences(p.id)
  ) order by p.starts_at desc,p.id),'[]'::jsonb) into result
  from public.care_plans p
  cross join lateral (select public.get_care_plan_detail(p.id) as detail) projection
  where p.patient_id=target_patient and p.status='active' and p.current_version_id is not null;
  return result;
end $$;

revoke all on function public.get_family_care_plan_readout(uuid,uuid) from public,anon;
grant execute on function public.get_family_care_plan_readout(uuid,uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
