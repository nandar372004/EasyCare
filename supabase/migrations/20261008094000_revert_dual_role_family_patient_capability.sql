begin;

-- Restore only the exact pre-20261008093000 family function definitions.
-- Sources were retrieved from Staging supabase_migrations.schema_migrations.
-- No grants, RLS policies, tables, identities or clinical data are changed.

-- Historical source: 20261008090000_phase_j_staging_read_contract_repair.sql
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

-- Historical source: 20261003110000_clinical_smart_care_plans.sql
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

-- Historical source: 20261003090000_family_foundation.sql
create or replace function public.require_family_patient() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare result uuid;
begin
  select p.id into result from public.patients p join public.profiles pr on pr.id=p.profile_id
    where p.auth_user_id=auth.uid() and p.status='active' and pr.status='active' and pr.role='patient'
      and p.date_of_birth <= (current_date-interval '18 years')::date;
  if result is null then raise exception 'An active adult patient account is required' using errcode='42501'; end if;
  return result;
end $$;

commit;
