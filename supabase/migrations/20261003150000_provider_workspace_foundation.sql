begin;

-- Provider identity and patient selection are resolved entirely from auth.uid().
-- A provider account does not receive a patient row or patient permissions.
create function public.get_my_provider_identity()
returns table(provider_id uuid, provider_type public.provider_type, display_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.provider_type, coalesce(nullif(btrim(p.display_name), ''), profile.full_name)
  from public.profiles profile
  join public.providers p on p.profile_id = profile.id
  where profile.id = auth.uid()
    and profile.status = 'active'
    and ((profile.role = 'doctor' and p.provider_type = 'doctor')
      or (profile.role = 'nurse' and p.provider_type in ('nurse','nurse_aide'))
      or (profile.role = 'caregiver' and p.provider_type = 'caregiver'))
    and p.verification_status = 'verified'
    and public.clinical_identity_is_current()
$$;

create function public.list_my_clinical_patients()
returns table(patient_id uuid, display_name text, relationship_context text)
language plpgsql stable security definer set search_path = '' as $$
declare current_provider uuid;
begin
  select identity.provider_id into current_provider
  from public.get_my_provider_identity() identity;
  if current_provider is null then return; end if;

  return query
  select patient.id, patient.full_name,
    case when exists (
      select 1 from public.appointments appointment
      where appointment.patient_id = patient.id
        and appointment.provider_id = current_provider
    ) then 'appointment' else 'care_assignment' end
  from public.patients patient
  where patient.status = 'active'
    and (
      exists (select 1 from public.appointments appointment
        where appointment.patient_id = patient.id and appointment.provider_id = current_provider)
      or exists (select 1 from public.care_assignments assignment
        join public.care_requests request on request.id = assignment.care_request_id
        where request.patient_id = patient.id and assignment.provider_id = current_provider
          and assignment.status in ('assigned','accepted'))
    )
    and public.can_access_patient(patient.id, 'clinical')
  order by patient.full_name, patient.id;
end $$;

revoke all on function public.get_my_provider_identity() from public, anon;
revoke all on function public.list_my_clinical_patients() from public, anon;
grant execute on function public.get_my_provider_identity() to authenticated;
grant execute on function public.list_my_clinical_patients() to authenticated;

commit;
