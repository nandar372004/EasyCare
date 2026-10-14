begin;

-- Resolve clinical UUIDs only for accepted adult members of a family the
-- authenticated caller belongs to. This metadata RPC does not read clinical
-- data; clinical rows continue through the caller's ordinary RLS policies.
create function public.get_family_health_members(p_group_id uuid)
returns table(member_id uuid, patient_id uuid, display_name text, relationship text, role text, is_self boolean, authorization jsonb)
language plpgsql stable security definer set search_path='' as $$
declare current_patient uuid;
begin
  current_patient := public.require_family_patient();
  if not public.is_family_group_member(p_group_id) then
    raise exception 'Family operation unavailable' using errcode='42501';
  end if;
  return query
    select m.id, p.id, p.full_name, m.relationship, m.role, p.id=current_patient,
      (select jsonb_build_object(
        'id', fa.id,
        'status', case
          when fa.status='active' and fa.expires_at<=statement_timestamp() then 'expired'
          when fa.status='active' and fa.consent_id is not null and not exists (
            select 1 from public.consents c where c.id=fa.consent_id and c.patient_id=fa.patient_id and c.status='granted'
          ) then 'inactive'
          else fa.status::text
        end,
        'expires_at', fa.expires_at,
        'records', fa.can_view_records,
        'appointments', fa.can_manage_appointments,
        'medications', fa.can_manage_medications,
        'payments', fa.can_make_payments,
        'alerts', fa.can_receive_alerts
      ) from public.family_authorizations fa
        where fa.patient_id=p.id and fa.family_profile_id=auth.uid())
    from public.family_group_members m
    join public.patients p on p.id=m.patient_id
    join public.profiles pr on pr.id=p.profile_id
    where m.family_group_id=p_group_id and m.status='active'
      and p.status='active' and pr.status='active' and pr.role='patient'
      and p.date_of_birth <= (current_date-interval '18 years')::date
    order by (m.role='owner') desc,m.joined_at,m.id
    limit 50;
end $$;

revoke all on function public.get_family_health_members(uuid) from public, anon;
grant execute on function public.get_family_health_members(uuid) to authenticated;

-- Phase 2 scopes already authorize these reads through can_access_patient().
-- The previous patient-only policies prevented the adult family viewer from
-- exercising those existing grants. These SELECT-only additions are limited
-- to patient accounts; the independent RLS helper still checks each scope,
-- consent, revocation, and expiry. No family write policy/privilege is added.
create policy appointments_family_read on public.appointments
  for select to authenticated
  using (public.current_profile_role()='patient' and public.can_access_patient(patient_id,'appointments'));

create policy patient_medications_family_read on public.patient_medications
  for select to authenticated
  using (public.current_profile_role()='patient' and public.can_access_patient(patient_id,'medications'));

create policy medication_schedules_family_read on public.medication_schedules
  for select to authenticated
  using (public.current_profile_role()='patient' and exists (
    select 1 from public.patient_medications medication
    where medication.id=medication_schedules.patient_medication_id
      and public.can_access_patient(medication.patient_id,'medications')
  ));

commit;
