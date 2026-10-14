begin;

-- Phase 4B is additive. The commercial /care-plan wizard and historical
-- care_encounters.care_plan text are intentionally left untouched.
alter table public.family_authorizations
  add column can_view_care_plans boolean not null default false;

create or replace function public.grant_family_authorization(p_viewer_member_id uuid,p_permissions jsonb,p_expires_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare patient uuid; viewer public.family_group_members; viewer_profile uuid; group_id uuid; consent uuid; authorization uuid;
begin
  patient:=public.require_family_patient();
  select family_group_id into group_id from public.family_group_members where id=p_viewer_member_id;
  perform 1 from public.family_groups where id=group_id for update;
  if not public.is_family_group_member(group_id) then raise exception 'Family operation unavailable' using errcode='42501'; end if;
  select * into viewer from public.family_group_members where id=p_viewer_member_id and status='active' and patient_id<>patient;
  if not found then raise exception 'Family operation unavailable' using errcode='42501'; end if;
  select p.profile_id into viewer_profile from public.patients p join public.profiles pr on pr.id=p.profile_id
    where p.id=viewer.patient_id and p.status='active' and pr.status='active';
  if viewer_profile is null then raise exception 'Family operation unavailable' using errcode='42501'; end if;
  if p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=statement_timestamp() or p_expires_at>statement_timestamp()+interval '1 year'
    or p_permissions is null or jsonb_typeof(p_permissions)<>'object'
    or p_permissions-ARRAY['records','appointments','medications','payments','alerts','care_plans'] <> '{}'::jsonb
    or exists(select 1 from jsonb_each(p_permissions) where jsonb_typeof(value)<>'boolean')
    or not (coalesce((p_permissions->>'records')::boolean,false) or coalesce((p_permissions->>'appointments')::boolean,false)
      or coalesce((p_permissions->>'medications')::boolean,false) or coalesce((p_permissions->>'payments')::boolean,false)
      or coalesce((p_permissions->>'alerts')::boolean,false) or coalesce((p_permissions->>'care_plans')::boolean,false)) then
    raise exception 'Select explicit permissions and a future expiry within one year' using errcode='22023'; end if;
  update public.consents set status='withdrawn',withdrawn_at=statement_timestamp() where id in
    (select consent_id from public.family_authorizations where patient_id=patient and family_profile_id=viewer_profile) and status='granted';
  insert into public.consents(patient_id,granted_by_profile_id,consent_type,version,status)
    values(patient,auth.uid(),'family_access','family-foundation-v1','granted') returning id into consent;
  insert into public.family_authorizations(patient_id,family_profile_id,relationship,status,authorized_at,expires_at,
    can_view_records,can_manage_appointments,can_manage_medications,can_make_payments,can_receive_alerts,can_view_care_plans,source_family_group_id,consent_id)
    values(patient,viewer_profile,viewer.relationship,'active',statement_timestamp(),p_expires_at,
      coalesce((p_permissions->>'records')::boolean,false),coalesce((p_permissions->>'appointments')::boolean,false),
      coalesce((p_permissions->>'medications')::boolean,false),coalesce((p_permissions->>'payments')::boolean,false),coalesce((p_permissions->>'alerts')::boolean,false),coalesce((p_permissions->>'care_plans')::boolean,false),group_id,consent)
    on conflict(patient_id,family_profile_id) do update set relationship=excluded.relationship,status='active',authorized_at=excluded.authorized_at,
      expires_at=excluded.expires_at,revoked_at=null,revoked_by=null,can_view_records=excluded.can_view_records,
      can_manage_appointments=excluded.can_manage_appointments,can_manage_medications=excluded.can_manage_medications,
      can_make_payments=excluded.can_make_payments,can_receive_alerts=excluded.can_receive_alerts,
      can_view_care_plans=excluded.can_view_care_plans,source_family_group_id=group_id,consent_id=consent
    returning id into authorization;
  return authorization;
end $$;

create or replace function public.get_family_members(p_group_id uuid) returns table(id uuid,display_name text,relationship text,role text,is_self boolean,authorization jsonb)
language plpgsql stable security definer set search_path='' as $$
declare patient uuid;
begin
  patient:=public.require_family_patient();
  if not public.is_family_group_member(p_group_id) then raise exception 'Family operation unavailable' using errcode='42501'; end if;
  return query select m.id,p.full_name,m.relationship,m.role,p.id=patient,
    (select jsonb_build_object('id',fa.id,'status',case when fa.status='active' and fa.expires_at<=statement_timestamp() then 'expired'
      when fa.status='active' and fa.consent_id is not null and not exists(select 1 from public.consents c where c.id=fa.consent_id and c.status='granted') then 'inactive' else fa.status::text end,
      'expires_at',fa.expires_at,'records',fa.can_view_records,'appointments',fa.can_manage_appointments,'medications',fa.can_manage_medications,'payments',fa.can_make_payments,'alerts',fa.can_receive_alerts,'care_plans',fa.can_view_care_plans)
      from public.family_authorizations fa where fa.patient_id=patient and fa.family_profile_id=p.profile_id)
    from public.family_group_members m join public.patients p on p.id=m.patient_id
    where m.family_group_id=p_group_id and m.status='active' order by (m.role='owner') desc,m.joined_at,m.id limit 50;
end $$;

create or replace function public.get_family_health_members(p_group_id uuid)
returns table(member_id uuid, patient_id uuid, display_name text, relationship text, role text, is_self boolean, authorization jsonb)
language plpgsql stable security definer set search_path='' as $$
declare current_patient uuid;
begin
  current_patient := public.require_family_patient();
  if not public.is_family_group_member(p_group_id) then raise exception 'Family operation unavailable' using errcode='42501'; end if;
  return query select m.id,p.id,p.full_name,m.relationship,m.role,p.id=current_patient,
      (select jsonb_build_object('id',fa.id,'status',case when fa.status='active' and fa.expires_at<=statement_timestamp() then 'expired'
        when fa.status='active' and fa.consent_id is not null and not exists(select 1 from public.consents c where c.id=fa.consent_id and c.patient_id=fa.patient_id and c.status='granted') then 'inactive' else fa.status::text end,
        'expires_at',fa.expires_at,'records',fa.can_view_records,'appointments',fa.can_manage_appointments,'medications',fa.can_manage_medications,
        'payments',fa.can_make_payments,'alerts',fa.can_receive_alerts,'care_plans',fa.can_view_care_plans)
        from public.family_authorizations fa where fa.patient_id=p.id and fa.family_profile_id=auth.uid())
    from public.family_group_members m join public.patients p on p.id=m.patient_id join public.profiles pr on pr.id=p.profile_id
    where m.family_group_id=p_group_id and m.status='active' and p.status='active' and pr.status='active' and pr.role='patient'
      and p.date_of_birth <= (current_date-interval '18 years')::date
    order by (m.role='owner') desc,m.joined_at,m.id limit 50;
end $$;

create or replace function public.can_access_patient(target_patient_id uuid, permission_name text default 'view')
returns boolean language sql stable security definer set search_path='' as $$
  select permission_name in ('view','clinical','records','appointments','medications','payments','alerts','care_plans')
    and public.clinical_identity_is_current() and (
    exists (select 1 from public.patients patient where patient.id=target_patient_id and patient.auth_user_id=auth.uid())
    or public.is_main_admin()
    or exists (
      select 1 from public.family_authorizations fa
      where fa.patient_id=target_patient_id and fa.family_profile_id=auth.uid() and fa.status='active' and fa.revoked_at is null
        and (fa.expires_at is null or fa.expires_at>statement_timestamp())
        and (fa.consent_id is null or exists(select 1 from public.consents c where c.id=fa.consent_id and c.patient_id=fa.patient_id and c.status='granted'))
        and (fa.source_family_group_id is null or (
          exists(select 1 from public.family_group_members owner_member where owner_member.family_group_id=fa.source_family_group_id and owner_member.patient_id=fa.patient_id and owner_member.status='active')
          and exists(select 1 from public.family_group_members viewer_member join public.patients viewer_patient on viewer_patient.profile_id=fa.family_profile_id
            where viewer_member.family_group_id=fa.source_family_group_id and viewer_member.patient_id=viewer_patient.id and viewer_member.status='active')
        ))
        and case permission_name
          when 'appointments' then fa.can_manage_appointments
          when 'medications' then fa.can_manage_medications
          when 'payments' then fa.can_make_payments
          when 'alerts' then fa.can_receive_alerts
          when 'care_plans' then fa.can_view_care_plans
          when 'view' then fa.can_view_records
          when 'clinical' then fa.can_view_records
          when 'records' then fa.can_view_records
          else false end
    )
    or exists (
      select 1 from public.providers provider
      where public.current_profile_role() in ('doctor','nurse','caregiver') and provider.profile_id = auth.uid() and provider.verification_status = 'verified'
        and (
          exists (select 1 from public.appointments appointment where appointment.patient_id = target_patient_id and appointment.provider_id = provider.id)
          or exists (
            select 1 from public.care_assignments assignment
            join public.care_requests request on request.id = assignment.care_request_id
            where request.patient_id = target_patient_id
              and assignment.provider_id = provider.id
              and assignment.status in ('assigned', 'accepted')
          )
        )
    )
    or (permission_name in ('view', 'appointments', 'alerts') and exists (
      select 1 from public.care_coordinators coordinator
      where public.current_profile_role() = 'coordinator' and coordinator.profile_id = auth.uid()
        and (
          exists (select 1 from public.patients patient where patient.id = target_patient_id and patient.primary_coordinator_id = coordinator.id)
          or exists (select 1 from public.care_requests request where request.patient_id = target_patient_id and request.coordinator_id = coordinator.id)
        )
    ))
    or (permission_name in ('appointments', 'alerts') and exists (
      select 1
      from public.clinic_staff admin_staff
      join public.clinic_staff provider_staff
        on provider_staff.clinic_id = admin_staff.clinic_id and provider_staff.status = 'active'
      join public.appointments appointment on appointment.provider_id = provider_staff.provider_id
      where public.current_profile_role() = 'clinic_admin' and admin_staff.profile_id = auth.uid()
        and admin_staff.clinic_role = 'sub_admin'
        and admin_staff.status = 'active'
        and appointment.patient_id = target_patient_id
    ))
  )
$$;
revoke all on function public.can_access_patient(uuid,text) from public,anon;
grant execute on function public.can_access_patient(uuid,text) to authenticated;

create type public.care_plan_status as enum ('draft','active','paused','completed','discontinued','cancelled');
create type public.care_plan_task_type as enum ('medication','vital_check','appointment','follow_up','activity','instruction','custom');
create type public.care_plan_recurrence as enum ('one_time','daily','selected_weekdays','multiple_daily_slots','source_schedule');
create type public.care_plan_occurrence_status as enum ('pending','completed','cancelled');
create type public.care_plan_version_status as enum ('draft','published');

-- Composite targets let plan children prove source ownership in the database.
create unique index patient_medications_id_patient_key on public.patient_medications(id,patient_id);
create unique index medication_schedules_id_medication_key on public.medication_schedules(id,patient_medication_id);
create unique index medication_events_id_patient_key on public.medication_events(id,patient_id);
create unique index follow_ups_id_patient_key on public.follow_ups(id,patient_id);

create table public.care_plans (
  id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete restrict,
  responsible_provider_id uuid not null references public.providers(id) on delete restrict,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  source_encounter_id uuid, origin text not null default 'provider_authored' check(origin='provider_authored'),
  status public.care_plan_status not null default 'draft', timezone text not null default 'Asia/Yangon',
  starts_at timestamptz not null default statement_timestamp(), target_end_at timestamptz,
  current_version_id uuid, created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
  unique(id,patient_id), check(target_end_at is null or target_end_at>=starts_at),
  foreign key(source_encounter_id,patient_id) references public.care_encounters(id,patient_id) on delete restrict
);
create table public.care_plan_versions (
  id uuid primary key default gen_random_uuid(), plan_id uuid not null, patient_id uuid not null, version_no integer not null check(version_no>0),
  title text not null check(length(btrim(title)) between 1 and 160), summary text, instructions text,
  source_encounter_id uuid, author_profile_id uuid not null references public.profiles(id) on delete restrict,
  author_provider_id uuid not null references public.providers(id) on delete restrict, change_reason text,
  status public.care_plan_version_status not null default 'draft', approved_by_profile_id uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz, created_at timestamptz not null default statement_timestamp(), unique(id,plan_id,patient_id), unique(plan_id,version_no),
  foreign key(plan_id,patient_id) references public.care_plans(id,patient_id) on delete restrict,
  foreign key(source_encounter_id,patient_id) references public.care_encounters(id,patient_id) on delete restrict,
  check((status='published')=(approved_at is not null and approved_by_profile_id is not null))
);
alter table public.care_plans add constraint care_plans_current_version_fk
  foreign key(current_version_id,id,patient_id) references public.care_plan_versions(id,plan_id,patient_id) on delete restrict;

create table public.care_plan_goals (
  id uuid primary key default gen_random_uuid(), plan_id uuid not null, version_id uuid not null, patient_id uuid not null,
  title text not null check(length(btrim(title)) between 1 and 180), description text, target_text text, review_at timestamptz,
  sort_order integer not null default 0, created_at timestamptz not null default statement_timestamp(),
  unique(id,plan_id,version_id,patient_id),
  foreign key(version_id,plan_id,patient_id) references public.care_plan_versions(id,plan_id,patient_id) on delete restrict
);

create table public.care_plan_tasks (
  id uuid primary key default gen_random_uuid(), plan_id uuid not null, version_id uuid not null, patient_id uuid not null,
  goal_id uuid, task_type public.care_plan_task_type not null, title text not null check(length(btrim(title)) between 1 and 180),
  instructions text, required boolean not null default true, manual_acknowledgement boolean not null default false,
  recurrence public.care_plan_recurrence not null default 'one_time', starts_on date not null, ends_on date,
  weekdays smallint[], local_times time[] not null default array['09:00'::time], timezone text not null default 'Asia/Yangon',
  grace_minutes integer not null default 240 check(grace_minutes between 0 and 10080), vital_type text,
  medication_id uuid, medication_schedule_id uuid, appointment_id uuid, follow_up_id uuid,
  created_at timestamptz not null default statement_timestamp(), unique(id,plan_id,version_id,patient_id),
  foreign key(version_id,plan_id,patient_id) references public.care_plan_versions(id,plan_id,patient_id) on delete restrict,
  foreign key(goal_id,plan_id,version_id,patient_id) references public.care_plan_goals(id,plan_id,version_id,patient_id) on delete restrict,
  foreign key(medication_id,patient_id) references public.patient_medications(id,patient_id) on delete restrict,
  foreign key(appointment_id,patient_id) references public.appointments(id,patient_id) on delete restrict,
  foreign key(follow_up_id,patient_id) references public.follow_ups(id,patient_id) on delete restrict,
  check(ends_on is null or ends_on>=starts_on), check(weekdays is null or weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  check(cardinality(local_times) between 1 and 8),
  check((recurrence='selected_weekdays')=(weekdays is not null)),
  check((recurrence='multiple_daily_slots') or cardinality(local_times)=1),
  check((task_type in ('activity','instruction','custom')) or not manual_acknowledgement),
  check((task_type='medication')=(medication_id is not null)),
  check((task_type='appointment')=(appointment_id is not null)),
  check((task_type='follow_up')=(follow_up_id is not null)),
  check((task_type='vital_check')=(vital_type is not null)),
  check((task_type='medication')=(medication_schedule_id is not null or recurrence<>'source_schedule'))
);
create table public.care_plan_task_occurrences (
  id uuid primary key default gen_random_uuid(), task_id uuid not null, plan_id uuid not null, version_id uuid not null, patient_id uuid not null,
  occurrence_key text not null, scheduled_at timestamptz not null, local_due_date date not null, local_due_time time not null,
  timezone text not null, status public.care_plan_occurrence_status not null default 'pending', required boolean not null,
  completed_at timestamptz, completed_by_profile_id uuid references public.profiles(id) on delete restrict, completion_note text,
  medication_event_id uuid, vital_reading_id uuid, created_at timestamptz not null default statement_timestamp(),
  unique(task_id,occurrence_key), unique(id,plan_id,version_id,patient_id),
  foreign key(task_id,plan_id,version_id,patient_id) references public.care_plan_tasks(id,plan_id,version_id,patient_id) on delete restrict,
  foreign key(medication_event_id,patient_id) references public.medication_events(id,patient_id) on delete restrict,
  foreign key(vital_reading_id,patient_id) references public.vital_readings(id,patient_id) on delete restrict,
  check((status='completed')=(completed_at is not null and completed_by_profile_id is not null)),
  check(medication_event_id is null or vital_reading_id is null)
);
create table public.care_plan_events (
  id uuid primary key default gen_random_uuid(), plan_id uuid not null, patient_id uuid not null, version_id uuid,
  task_id uuid, occurrence_id uuid, event_type text not null check(event_type in ('plan_created','version_created','version_approved','plan_activated','plan_paused','plan_resumed','plan_completed','plan_discontinued','plan_cancelled','occurrence_completed')),
  actor_profile_id uuid not null references public.profiles(id) on delete restrict, provider_id uuid references public.providers(id) on delete restrict,
  previous_status text, new_status text, reason text, occurred_at timestamptz not null default statement_timestamp(),
  foreign key(plan_id,patient_id) references public.care_plans(id,patient_id) on delete restrict,
  foreign key(version_id,plan_id,patient_id) references public.care_plan_versions(id,plan_id,patient_id) on delete restrict,
  foreign key(task_id,plan_id,version_id,patient_id) references public.care_plan_tasks(id,plan_id,version_id,patient_id) on delete restrict,
  foreign key(occurrence_id,plan_id,version_id,patient_id) references public.care_plan_task_occurrences(id,plan_id,version_id,patient_id) on delete restrict
);

alter table public.care_plan_tasks add constraint care_plan_tasks_schedule_medication_fk
  foreign key(medication_schedule_id,medication_id) references public.medication_schedules(id,patient_medication_id) on delete restrict;
alter table public.care_plan_task_occurrences add column appointment_id uuid;
alter table public.care_plan_task_occurrences add column follow_up_id uuid;
alter table public.care_plan_task_occurrences add constraint care_plan_occurrence_appointment_fk
  foreign key(appointment_id,patient_id) references public.appointments(id,patient_id) on delete restrict;
alter table public.care_plan_task_occurrences add constraint care_plan_occurrence_followup_fk
  foreign key(follow_up_id,patient_id) references public.follow_ups(id,patient_id) on delete restrict;
create index care_plans_patient_status_idx on public.care_plans(patient_id,status,starts_at desc);
create index care_plan_tasks_version_idx on public.care_plan_tasks(version_id,patient_id);
create index care_plan_occurrences_patient_due_idx on public.care_plan_task_occurrences(patient_id,scheduled_at,status);
create index care_plan_events_plan_time_idx on public.care_plan_events(plan_id,occurred_at desc);

alter table public.care_plans enable row level security;
alter table public.care_plan_versions enable row level security;
alter table public.care_plan_goals enable row level security;
alter table public.care_plan_tasks enable row level security;
alter table public.care_plan_task_occurrences enable row level security;
alter table public.care_plan_events enable row level security;
do $$ declare table_name text; begin
  foreach table_name in array array['care_plans','care_plan_versions','care_plan_goals','care_plan_tasks','care_plan_task_occurrences','care_plan_events'] loop
    execute format('revoke insert,update,delete,truncate,references,trigger on public.%I from public,anon,authenticated',table_name);
    execute format('grant select on public.%I to authenticated',table_name);
  end loop;
end $$;
create policy care_plans_read on public.care_plans for select to authenticated using (
  patient_id in (select p.id from public.patients p where p.auth_user_id=auth.uid())
  or (public.current_profile_role()='patient' and public.can_access_patient(patient_id,'care_plans'))
  or (public.current_profile_role() in ('doctor','nurse','caregiver') and public.can_access_patient(patient_id,'clinical'))
);
create policy care_plan_versions_read on public.care_plan_versions for select to authenticated using (exists(select 1 from public.care_plans p where p.id=care_plan_versions.plan_id and p.patient_id=care_plan_versions.patient_id));
create policy care_plan_goals_read on public.care_plan_goals for select to authenticated using (exists(select 1 from public.care_plans p where p.id=care_plan_goals.plan_id and p.patient_id=care_plan_goals.patient_id));
create policy care_plan_tasks_read on public.care_plan_tasks for select to authenticated using (exists(select 1 from public.care_plans p where p.id=care_plan_tasks.plan_id and p.patient_id=care_plan_tasks.patient_id));
create policy care_plan_occurrences_read on public.care_plan_task_occurrences for select to authenticated using (exists(select 1 from public.care_plans p where p.id=care_plan_task_occurrences.plan_id and p.patient_id=care_plan_task_occurrences.patient_id));
create policy care_plan_events_read on public.care_plan_events for select to authenticated using (exists(select 1 from public.care_plans p where p.id=care_plan_events.plan_id and p.patient_id=care_plan_events.patient_id));

create function public.guard_care_plan_event_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Care plan events are append-only' using errcode='42501'; end $$;
create trigger care_plan_events_immutable before update or delete on public.care_plan_events for each row execute function public.guard_care_plan_event_immutable();
create function public.guard_care_plan_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  if new.patient_id<>old.patient_id then raise exception 'Care plan patient ownership is immutable' using errcode='23514'; end if;
  if tg_table_name='care_plan_versions' then
    if old.status='published' and new is distinct from old then raise exception 'Published care plan versions are immutable' using errcode='23514'; end if;
  elsif tg_table_name in ('care_plan_goals','care_plan_tasks') then
    if exists(select 1 from public.care_plan_versions v where v.id=old.version_id and v.status='published') then raise exception 'Published care plan content is immutable' using errcode='23514'; end if;
  end if;
  return new;
end $$;
create trigger care_plans_ownership_immutable before update on public.care_plans for each row execute function public.guard_care_plan_immutable();
create trigger care_plan_versions_immutable before update on public.care_plan_versions for each row execute function public.guard_care_plan_immutable();
create trigger care_plan_goals_immutable before update on public.care_plan_goals for each row execute function public.guard_care_plan_immutable();
create trigger care_plan_tasks_immutable before update on public.care_plan_tasks for each row execute function public.guard_care_plan_immutable();

create function public.assert_care_plan_doctor(p_patient uuid,p_provider uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or public.current_profile_role()<>'doctor' or not public.clinical_identity_is_current()
    or not exists(select 1 from public.providers p where p.id=p_provider and p.profile_id=auth.uid() and p.provider_type='doctor' and p.verification_status='verified')
    or not public.can_access_patient(p_patient,'clinical') then raise exception 'Authorized clinical provider required' using errcode='42501'; end if;
end $$;

create function public.create_care_plan_draft(p_patient uuid,p_source_encounter uuid,p_title text,p_summary text,p_instructions text,p_timezone text,p_starts_at timestamptz,p_target_end_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare provider uuid; plan uuid; version uuid;
begin
  select id into provider from public.providers where profile_id=auth.uid() and provider_type='doctor' and verification_status='verified';
  perform public.assert_care_plan_doctor(p_patient,provider);
  if p_source_encounter is not null and not exists(select 1 from public.care_encounters where id=p_source_encounter and patient_id=p_patient and provider_id=provider) then raise exception 'Source encounter unavailable' using errcode='23503'; end if;
  if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid timezone' using errcode='22023'; end if;
  insert into public.care_plans(patient_id,responsible_provider_id,created_by_profile_id,source_encounter_id,timezone,starts_at,target_end_at)
   values(p_patient,provider,auth.uid(),p_source_encounter,p_timezone,coalesce(p_starts_at,statement_timestamp()),p_target_end_at) returning id into plan;
  insert into public.care_plan_versions(plan_id,patient_id,version_no,title,summary,instructions,source_encounter_id,author_profile_id,author_provider_id)
   values(plan,p_patient,1,p_title,p_summary,p_instructions,p_source_encounter,auth.uid(),provider) returning id into version;
  insert into public.care_plan_events(plan_id,patient_id,version_id,event_type,actor_profile_id,provider_id,new_status) values
   (plan,p_patient,version,'plan_created',auth.uid(),provider,'draft'),(plan,p_patient,version,'version_created',auth.uid(),provider,'draft');
  return plan;
end $$;

create function public.add_care_plan_goal(p_plan uuid,p_title text,p_description text,p_target text,p_review_at timestamptz,p_sort integer default 0)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.care_plans; version uuid; result uuid;
begin
  select * into p from public.care_plans where id=p_plan for update; if not found then raise exception 'Plan unavailable' using errcode='42501'; end if;
  perform public.assert_care_plan_doctor(p.patient_id,p.responsible_provider_id);
  if p.status not in ('draft','active','paused') then raise exception 'Goals require an editable plan version' using errcode='22023'; end if;
  select id into version from public.care_plan_versions where plan_id=p.id and patient_id=p.patient_id and status='draft';
  insert into public.care_plan_goals(plan_id,version_id,patient_id,title,description,target_text,review_at,sort_order) values(p.id,version,p.patient_id,p_title,p_description,p_target,p_review_at,p_sort) returning id into result;
  return result;
end $$;

create function public.add_care_plan_task(p_plan uuid,p_type public.care_plan_task_type,p_title text,p_instructions text,p_required boolean,p_manual_ack boolean,p_recurrence public.care_plan_recurrence,p_starts_on date,p_ends_on date,p_weekdays smallint[],p_local_times time[],p_timezone text,p_vital_type text,p_medication uuid,p_schedule uuid,p_appointment uuid,p_follow_up uuid,p_goal uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.care_plans; version uuid; result uuid;
begin
  select * into p from public.care_plans where id=p_plan for update; if not found then raise exception 'Plan unavailable' using errcode='42501'; end if;
  perform public.assert_care_plan_doctor(p.patient_id,p.responsible_provider_id);
  if p.status not in ('draft','active','paused') then raise exception 'Tasks require an editable plan version' using errcode='22023'; end if;
  if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid timezone' using errcode='22023'; end if;
  select id into version from public.care_plan_versions where plan_id=p.id and patient_id=p.patient_id and status='draft';
  insert into public.care_plan_tasks(plan_id,version_id,patient_id,goal_id,task_type,title,instructions,required,manual_acknowledgement,recurrence,starts_on,ends_on,weekdays,local_times,timezone,vital_type,medication_id,medication_schedule_id,appointment_id,follow_up_id)
  values(p.id,version,p.patient_id,p_goal,p_type,p_title,p_instructions,p_required,p_manual_ack,p_recurrence,p_starts_on,p_ends_on,p_weekdays,p_local_times,p_timezone,p_vital_type,p_medication,p_schedule,p_appointment,p_follow_up) returning id into result;
  return result;
end $$;

create function public.approve_care_plan_version(p_plan uuid,p_change_reason text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.care_plans; version uuid;
begin
  select * into p from public.care_plans where id=p_plan for update; if not found then raise exception 'Plan unavailable' using errcode='42501'; end if;
  perform public.assert_care_plan_doctor(p.patient_id,p.responsible_provider_id);
  if p.status not in ('draft','active','paused') then raise exception 'Plan cannot be approved' using errcode='22023'; end if;
  select id into version from public.care_plan_versions where plan_id=p.id and patient_id=p.patient_id and status='draft' for update;
  if version is null then raise exception 'Draft version unavailable' using errcode='22023'; end if;
  update public.care_plan_versions set status='published',approved_by_profile_id=auth.uid(),approved_at=statement_timestamp(),change_reason=coalesce(p_change_reason,change_reason) where id=version;
  update public.care_plans set current_version_id=version,updated_at=statement_timestamp() where id=p.id;
  insert into public.care_plan_events(plan_id,patient_id,version_id,event_type,actor_profile_id,provider_id,new_status) values(p.id,p.patient_id,version,'version_approved',auth.uid(),p.responsible_provider_id,'published');
  return version;
end $$;

create function public.create_care_plan_version(p_plan uuid,p_title text,p_summary text,p_instructions text,p_change_reason text,p_source_encounter uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.care_plans; v uuid; next_no integer;
begin
  select * into p from public.care_plans where id=p_plan for update; if not found then raise exception 'Plan unavailable' using errcode='42501'; end if;
  perform public.assert_care_plan_doctor(p.patient_id,p.responsible_provider_id);
  if p.status not in ('draft','active','paused') or exists(select 1 from public.care_plan_versions where plan_id=p.id and status='draft') then
    raise exception 'Plan cannot accept another version' using errcode='22023'; end if;
  if p_source_encounter is not null and not exists(select 1 from public.care_encounters where id=p_source_encounter and patient_id=p.patient_id and provider_id=p.responsible_provider_id) then
    raise exception 'Source encounter unavailable' using errcode='23503'; end if;
  select coalesce(max(version_no),0)+1 into next_no from public.care_plan_versions where plan_id=p.id;
  insert into public.care_plan_versions(plan_id,patient_id,version_no,title,summary,instructions,source_encounter_id,author_profile_id,author_provider_id,change_reason)
   values(p.id,p.patient_id,next_no,p_title,p_summary,p_instructions,p_source_encounter,auth.uid(),p.responsible_provider_id,p_change_reason) returning id into v;
  insert into public.care_plan_events(plan_id,patient_id,version_id,event_type,actor_profile_id,provider_id,new_status,reason)
   values(p.id,p.patient_id,v,'version_created',auth.uid(),p.responsible_provider_id,'draft',p_change_reason);
  return v;
end $$;

create function public.transition_care_plan(p_plan uuid,p_intent text,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare p public.care_plans; next_status public.care_plan_status; event text;
begin
  select * into p from public.care_plans where id=p_plan for update; if not found then raise exception 'Plan unavailable' using errcode='42501'; end if;
  perform public.assert_care_plan_doctor(p.patient_id,p.responsible_provider_id);
  next_status:=case p_intent when 'activate' then 'active'::public.care_plan_status when 'resume' then 'active'::public.care_plan_status when 'pause' then 'paused'::public.care_plan_status when 'complete' then 'completed'::public.care_plan_status when 'discontinue' then 'discontinued'::public.care_plan_status when 'cancel' then 'cancelled'::public.care_plan_status else null end;
  if next_status is null or not ((p.status='draft' and p_intent in ('activate','cancel') and (p_intent='cancel' or p.current_version_id is not null))
     or (p.status='active' and p_intent in ('pause','complete','discontinue')) or (p.status='paused' and p_intent in ('resume','complete','discontinue'))) then
    raise exception 'Invalid care plan transition' using errcode='22023'; end if;
  event:=case p_intent when 'activate' then 'plan_activated' when 'resume' then 'plan_resumed' when 'pause' then 'plan_paused' when 'complete' then 'plan_completed' when 'discontinue' then 'plan_discontinued' else 'plan_cancelled' end;
  update public.care_plans set status=next_status,updated_at=statement_timestamp() where id=p.id;
  insert into public.care_plan_events(plan_id,patient_id,version_id,event_type,actor_profile_id,provider_id,previous_status,new_status,reason)
   values(p.id,p.patient_id,p.current_version_id,event,auth.uid(),p.responsible_provider_id,p.status::text,next_status::text,p_reason);
end $$;

create function public.acknowledge_care_plan_occurrence(p_occurrence uuid,p_note text default null) returns void
language plpgsql security definer set search_path='' as $$
declare o public.care_plan_task_occurrences; t public.care_plan_tasks; p public.care_plans;
begin
  select * into o from public.care_plan_task_occurrences where id=p_occurrence for update; if not found then raise exception 'Occurrence unavailable' using errcode='42501'; end if;
  select * into t from public.care_plan_tasks where id=o.task_id; select * into p from public.care_plans where id=o.plan_id;
  if not exists(select 1 from public.patients where id=o.patient_id and auth_user_id=auth.uid()) or p.status<>'active' or o.status<>'pending'
    or t.task_type not in ('activity','instruction','custom') or not t.manual_acknowledgement or o.scheduled_at>statement_timestamp() then
    raise exception 'Manual acknowledgement unavailable' using errcode='42501'; end if;
  update public.care_plan_task_occurrences set status='completed',completed_at=statement_timestamp(),completed_by_profile_id=auth.uid(),completion_note=p_note where id=o.id;
  insert into public.care_plan_events(plan_id,patient_id,version_id,task_id,occurrence_id,event_type,actor_profile_id,new_status)
   values(o.plan_id,o.patient_id,o.version_id,o.task_id,o.id,'occurrence_completed',auth.uid(),'completed');
end $$;

create function public.extend_care_plan_occurrences(p_plan uuid,p_through date default null) returns integer
language plpgsql security definer set search_path='' as $$
declare p public.care_plans; t record; d date; tm time; limit_date date; inserted_count integer:=0; due timestamp; n integer;
begin
  select * into p from public.care_plans where id=p_plan for update; if not found then raise exception 'Plan unavailable' using errcode='42501'; end if;
  perform public.assert_care_plan_doctor(p.patient_id,p.responsible_provider_id);
  if p.status<>'active' then raise exception 'Only active plans can generate occurrences' using errcode='22023'; end if;
  limit_date:=least(coalesce(p_through,(statement_timestamp() at time zone p.timezone)::date+30),(statement_timestamp() at time zone p.timezone)::date+30);
  if limit_date<(statement_timestamp() at time zone p.timezone)::date then raise exception 'Occurrence horizon unavailable' using errcode='22023'; end if;
  for t in select * from public.care_plan_tasks where plan_id=p.id and version_id=p.current_version_id and patient_id=p.patient_id loop
    if (select count(*) from public.care_plan_tasks where plan_id=p.id and version_id=p.current_version_id)>100 then raise exception 'Task limit exceeded' using errcode='22023'; end if;
    d:=greatest(t.starts_on,(statement_timestamp() at time zone t.timezone)::date);
    while d<=limit_date and (t.ends_on is null or d<=t.ends_on) loop
      if t.recurrence='one_time' and d<>t.starts_on then exit; end if;
      if t.recurrence not in ('selected_weekdays','source_schedule') or (t.recurrence='selected_weekdays' and extract(dow from d)::smallint=any(t.weekdays)) then
        foreach tm in array case when t.recurrence='source_schedule'
          then (select coalesce(array_agg(ms.time_of_day order by ms.time_of_day),array[]::time[]) from public.medication_schedules ms where ms.patient_medication_id=t.medication_id and (ms.valid_from is null or d>=ms.valid_from) and (ms.valid_until is null or d<=ms.valid_until) and (ms.days_of_week is null or extract(dow from d)::smallint=any(ms.days_of_week)))
          else t.local_times end loop
          if true then
            due:=d+tm;
            insert into public.care_plan_task_occurrences(task_id,plan_id,version_id,patient_id,occurrence_key,scheduled_at,local_due_date,local_due_time,timezone,required,appointment_id,follow_up_id)
             values(t.id,p.id,t.version_id,p.patient_id,d::text||'T'||tm::text,due at time zone t.timezone,d,tm,t.timezone,t.required,t.appointment_id,t.follow_up_id) on conflict(task_id,occurrence_key) do nothing;
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

create function public.care_plan_occurrence_is_complete(p_occurrence uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select coalesce(case t.task_type
    when 'medication' then exists(select 1 from public.medication_events e where e.schedule_id=t.medication_schedule_id and e.patient_id=o.patient_id and e.scheduled_at=o.scheduled_at and e.status='taken')
    when 'vital_check' then exists(select 1 from public.vital_readings v where v.patient_id=o.patient_id and v.recorded_at between o.scheduled_at-make_interval(mins=>t.grace_minutes) and o.scheduled_at+make_interval(mins=>t.grace_minutes)
      and case t.vital_type when 'blood_pressure' then v.systolic_bp is not null and v.diastolic_bp is not null when 'heart_rate' then v.heart_rate is not null when 'spo2' then v.spo2 is not null when 'temperature' then v.temperature_c is not null when 'glucose' then v.glucose_mg_dl is not null when 'weight' then v.weight_kg is not null else false end)
    when 'appointment' then exists(select 1 from public.appointments a where a.id=t.appointment_id and a.patient_id=o.patient_id and a.status='completed')
    when 'follow_up' then exists(select 1 from public.follow_ups f where f.id=t.follow_up_id and f.patient_id=o.patient_id and f.status='completed')
    else o.status='completed' end,false)
  from public.care_plan_task_occurrences o join public.care_plan_tasks t on t.id=o.task_id where o.id=p_occurrence
$$;

create function public.get_care_plan_progress(p_plan uuid,p_as_of timestamptz default statement_timestamp()) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare tz text; today date; td integer; tc integer; all_due integer; all_done integer;
begin
  select timezone into tz from public.care_plans where id=p_plan;
  if tz is null then return null; end if;
  today:=(p_as_of at time zone tz)::date;
  select count(*) filter(where o.required and o.status<>'cancelled'),count(*) filter(where o.required and public.care_plan_occurrence_is_complete(o.id)) into td,tc
    from public.care_plan_task_occurrences o where o.plan_id=p_plan and o.local_due_date=today and o.scheduled_at<=p_as_of;
  select count(*) filter(where o.required and o.status<>'cancelled'),count(*) filter(where o.required and public.care_plan_occurrence_is_complete(o.id)) into all_due,all_done
    from public.care_plan_task_occurrences o where o.plan_id=p_plan and o.scheduled_at<=p_as_of;
  return jsonb_build_object('today',jsonb_build_object('state',case when td=0 then 'no_tasks_due' else 'tasks_due' end,'completed',tc,'total',td,'percent',case when td=0 then null else round(100.0*tc/td) end),
    'plan_to_date',jsonb_build_object('state',case when all_due=0 then 'no_tasks_due' else 'tasks_due' end,'completed',all_done,'total',all_due,'percent',case when all_due=0 then null else round(100.0*all_done/all_due) end));
end $$;

create function public.list_my_care_plans() returns setof public.care_plans
language sql stable security invoker set search_path='' as $$ select * from public.care_plans order by starts_at desc,id $$;
create function public.get_care_plan_detail(p_plan uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('plan',to_jsonb(p),'versions',coalesce((select jsonb_agg(to_jsonb(v) order by v.version_no) from public.care_plan_versions v where v.plan_id=p.id), '[]'::jsonb),
  'goals',coalesce((select jsonb_agg(to_jsonb(g) order by g.sort_order,g.id) from public.care_plan_goals g where g.plan_id=p.id), '[]'::jsonb),
  'tasks',coalesce((select jsonb_agg((to_jsonb(t)-'medication_id'-'medication_schedule_id'-'appointment_id'-'follow_up_id') || jsonb_build_object(
    'medication',case when public.can_access_patient(p.patient_id,'medications') then to_jsonb(m) else null end,
    'appointment',case when public.can_access_patient(p.patient_id,'appointments') then to_jsonb(a) else null end,
    'follow_up',case when public.can_access_patient(p.patient_id,'clinical') then to_jsonb(f) else null end)) from public.care_plan_tasks t
      left join public.patient_medications m on m.id=t.medication_id and m.patient_id=t.patient_id
      left join public.appointments a on a.id=t.appointment_id and a.patient_id=t.patient_id
      left join public.follow_ups f on f.id=t.follow_up_id and f.patient_id=t.patient_id where t.plan_id=p.id),'[]'::jsonb),
  'progress',public.get_care_plan_progress(p.id)) from public.care_plans p where p.id=p_plan
$$;

revoke all on function public.assert_care_plan_doctor(uuid,uuid),public.create_care_plan_draft(uuid,uuid,text,text,text,text,timestamptz,timestamptz),
 public.add_care_plan_goal(uuid,text,text,text,timestamptz,integer),
 public.add_care_plan_task(uuid,public.care_plan_task_type,text,text,boolean,boolean,public.care_plan_recurrence,date,date,smallint[],time[],text,text,uuid,uuid,uuid,uuid,uuid),
 public.approve_care_plan_version(uuid,text),public.create_care_plan_version(uuid,text,text,text,text,uuid),public.transition_care_plan(uuid,text,text),public.acknowledge_care_plan_occurrence(uuid,text),
 public.extend_care_plan_occurrences(uuid,date),public.get_care_plan_progress(uuid,timestamptz),public.list_my_care_plans(),public.get_care_plan_detail(uuid) from public,anon;
grant execute on function public.create_care_plan_draft(uuid,uuid,text,text,text,text,timestamptz,timestamptz),
 public.add_care_plan_goal(uuid,text,text,text,timestamptz,integer),
 public.add_care_plan_task(uuid,public.care_plan_task_type,text,text,boolean,boolean,public.care_plan_recurrence,date,date,smallint[],time[],text,text,uuid,uuid,uuid,uuid,uuid),
 public.approve_care_plan_version(uuid,text),public.create_care_plan_version(uuid,text,text,text,text,uuid),public.transition_care_plan(uuid,text,text),public.acknowledge_care_plan_occurrence(uuid,text),
 public.extend_care_plan_occurrences(uuid,date),public.get_care_plan_progress(uuid,timestamptz),public.list_my_care_plans(),public.get_care_plan_detail(uuid) to authenticated;

commit;
