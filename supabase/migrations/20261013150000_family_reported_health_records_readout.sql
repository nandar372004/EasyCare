begin;

-- Read-only family projection of the exact patient-reported intake used by
-- get_my_reported_health_intake(). Callers identify an accepted membership,
-- never a patient UUID; current records permission is rechecked in SQL.
create function public.get_family_reported_health_records(p_group_id uuid, p_member_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_patient uuid;
  target_patient uuid;
  result jsonb;
begin
  viewer_patient := public.require_family_patient();
  if not public.clinical_identity_is_current()
    or not exists(select 1 from public.patients v where v.id=viewer_patient and v.date_of_birth<=(current_date-interval '18 years')::date)
    or not public.is_family_group_member(p_group_id) then
    raise exception 'Family Health Records unavailable' using errcode='42501';
  end if;

  select p.id into target_patient
  from public.family_group_members m
  join public.patients p on p.id=m.patient_id
  join public.profiles pr on pr.id=p.profile_id
  where m.id=p_member_id and m.family_group_id=p_group_id and m.status='active'
    and m.patient_id<>viewer_patient and p.status='active' and pr.status='active' and pr.role='patient'
    and p.date_of_birth<=(current_date-interval '18 years')::date;
  if target_patient is null or not public.can_access_patient(target_patient,'records') then
    raise exception 'Family Health Records unavailable' using errcode='42501';
  end if;

  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'itemType',i.item_type,'entryKind',i.entry_kind,'name',i.item_name,
    'details',i.details,'source',i.source,'verificationStatus',i.verification_status,
    'createdAt',i.created_at,'updatedAt',i.updated_at
  ) order by i.created_at,i.id),'[]'::jsonb))
  into result
  from public.patient_reported_health_items i
  where i.patient_id=target_patient and i.record_status='active'
    and i.item_type in ('allergy','condition','vaccination');
  return result;
end;
$$;

revoke all on function public.get_family_reported_health_records(uuid,uuid) from public,anon;
grant execute on function public.get_family_reported_health_records(uuid,uuid) to authenticated;
comment on function public.get_family_reported_health_records(uuid,uuid) is
  'Read-only selected-member patient-reported Health Records, gated by active family records permission.';

commit;
