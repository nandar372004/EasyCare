begin;

alter table public.appointments
  add column if not exists provider_availability_id uuid references public.provider_availability(id) on delete restrict,
  add column if not exists consultation_channel text,
  add column if not exists booking_code text;

update public.appointments
set consultation_channel = case appointment_type
  when 'home_visit' then 'home_visit'
  else 'video'
end
where consultation_channel is null;

update public.appointments
set booking_code = 'ECA-' || upper(substr(replace(id::text, '-', ''), 1, 10))
where booking_code is null;

alter table public.appointments
  alter column consultation_channel set not null,
  alter column booking_code set not null;

alter table public.appointments
  drop constraint if exists appointments_consultation_channel_check;
alter table public.appointments
  add constraint appointments_consultation_channel_check check (
    (appointment_type = 'teleconsultation' and consultation_channel in ('video', 'voice'))
    or (appointment_type = 'home_visit' and consultation_channel = 'home_visit')
  );

create unique index if not exists appointments_booking_code_key
  on public.appointments (booking_code);
create unique index if not exists appointments_active_availability_key
  on public.appointments (provider_availability_id)
  where provider_availability_id is not null
    and status in ('pending', 'confirmed', 'rescheduled');

drop policy if exists appointments_read on public.appointments;
drop policy if exists appointments_create on public.appointments;
drop policy if exists appointments_create_patient on public.appointments;
drop policy if exists appointments_update on public.appointments;

create policy appointments_patient_read on public.appointments
  for select to authenticated
  using (
    exists (
      select 1 from public.patients patient
      where patient.id = appointments.patient_id
        and patient.auth_user_id = auth.uid()
    )
  );

create policy appointments_patient_create on public.appointments
  for insert to authenticated
  with check (
    status = 'pending'
    and cancelled_at is null
    and booked_by_profile_id is null
    and exists (
      select 1 from public.patients patient
      where patient.id = appointments.patient_id
        and patient.auth_user_id = auth.uid()
        and patient.status = 'active'
    )
    and exists (
      select 1
      from public.providers provider
      where provider.id = appointments.provider_id
        and provider.provider_type = 'doctor'
        and provider.verification_status = 'verified'
    )
    and exists (
      select 1
      from public.provider_availability availability
      where availability.id = appointments.provider_availability_id
        and availability.provider_id = appointments.provider_id
        and availability.status = 'available'
        and availability.start_at = appointments.scheduled_start
        and availability.end_at = appointments.scheduled_end
        and availability.service_type = appointments.appointment_type
    )
  );

create or replace function public.mark_booked_provider_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.provider_availability
  set status = 'booked'
  where id = new.provider_availability_id
    and status = 'available';

  if not found then
    raise exception 'Selected appointment time is no longer available'
      using errcode = '23P01';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_mark_availability_booked on public.appointments;
create trigger appointments_mark_availability_booked
  after insert on public.appointments
  for each row
  when (new.provider_availability_id is not null)
  execute function public.mark_booked_provider_availability();

revoke all on table public.appointments from anon, authenticated;
grant select (
  id, patient_id, provider_id, provider_availability_id, appointment_type,
  consultation_channel, scheduled_start, scheduled_end, status,
  reason_symptoms, fee_amount, currency, booking_code, created_at
) on table public.appointments to authenticated;
grant insert (
  patient_id, provider_id, provider_availability_id, booked_by_profile_id,
  appointment_type, consultation_channel, scheduled_start, scheduled_end,
  reason_symptoms, status, fee_amount, currency, booking_code
) on table public.appointments to authenticated;

revoke all on function public.mark_booked_provider_availability() from public;

commit;
