begin;

-- Appointment operational projections are scoped to the server-resolved provider.
-- Patient clinical fields remain subject to the existing clinical relationship.
create function public.list_my_provider_appointments()
returns table(id uuid, patient_display_name text, scheduled_start timestamptz,
  scheduled_end timestamptz, consultation_channel text, reason_symptoms text,
  fee_amount numeric, currency text, booking_code text, status public.appointment_status)
language sql stable security definer set search_path = '' as $$
  select a.id,
    case when public.can_access_patient(a.patient_id,'clinical') then p.full_name else 'Patient' end,
    a.scheduled_start,a.scheduled_end,a.consultation_channel,
    case when public.can_access_patient(a.patient_id,'clinical') then a.reason_symptoms else null end,
    a.fee_amount,a.currency::text,a.booking_code,a.status
  from public.get_my_provider_identity() identity
  join public.appointments a on a.provider_id=identity.provider_id
  join public.patients p on p.id=a.patient_id
  where identity.provider_type='doctor'
  order by a.scheduled_start desc,a.id;
$$;

create function public.transition_my_provider_appointment(p_appointment_id uuid, p_status public.appointment_status)
returns public.appointment_status
language plpgsql security definer set search_path = '' as $$
declare v_provider_id uuid; previous public.appointment_status;
begin
  -- Locks prevent identity suspension or reassignment racing the transition.
  perform 1 from public.profiles where id=auth.uid() for share;
  select identity.provider_id into v_provider_id from public.get_my_provider_identity() identity
    where identity.provider_type='doctor';
  if v_provider_id is null then raise exception 'Appointment action not authorized' using errcode='42501'; end if;
  perform 1 from public.providers where id=v_provider_id for share;
  if not exists(select 1 from public.get_my_provider_identity() identity where identity.provider_id=v_provider_id and identity.provider_type='doctor') then
    raise exception 'Appointment action not authorized' using errcode='42501';
  end if;
  select a.status into previous from public.appointments a
    where a.id=p_appointment_id and a.provider_id=v_provider_id for update;
  if not found then raise exception 'Appointment action not authorized' using errcode='42501'; end if;
  if p_status is null or not (
    (previous='pending' and p_status='confirmed') or
    (previous='confirmed' and p_status in ('completed','no_show'))
  ) then raise exception 'Invalid appointment status transition' using errcode='22023'; end if;
  update public.appointments set status=p_status where id=p_appointment_id and public.appointments.provider_id=v_provider_id;
  -- No availability update: booked slots remain reserved for all three transitions.
  return p_status;
end;
$$;

revoke all on function public.list_my_provider_appointments() from public, anon;
revoke all on function public.transition_my_provider_appointment(uuid,public.appointment_status) from public, anon;
grant execute on function public.list_my_provider_appointments() to authenticated;
grant execute on function public.transition_my_provider_appointment(uuid,public.appointment_status) to authenticated;
-- No changes to existing RLS policies or direct table write privileges.
commit;
