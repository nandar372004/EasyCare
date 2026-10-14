begin;

-- Family callers identify the selected member through the accepted family
-- membership row. They never supply a patient UUID, and the existing
-- Phase 4B.1 projections remain responsible for source masking.
create function public.get_family_care_plan_readout(p_group_id uuid,p_member_id uuid) returns jsonb
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

commit;
