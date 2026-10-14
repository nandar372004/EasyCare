begin;
-- Appointment booking currently uses the doctor's single MMK consultation fee.
-- No catalog/rule/package entitlement is linked to an appointment in this schema.
create function public.enforce_appointment_pricing() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  provider public.providers%rowtype;
  slot public.provider_availability%rowtype;
begin
  if tg_op = 'UPDATE' then
    -- Preserve the booked price snapshot even if the provider later changes rates.
    -- Changing its pricing/slot identity requires a new booking, not a cheap-price swap.
    if new.fee_amount is distinct from old.fee_amount
      or new.currency is distinct from old.currency
      or new.provider_id is distinct from old.provider_id
      or new.appointment_type is distinct from old.appointment_type
      or new.provider_availability_id is distinct from old.provider_availability_id
      or new.scheduled_start is distinct from old.scheduled_start
      or new.scheduled_end is distinct from old.scheduled_end then
      raise exception 'Appointment price and booking identity are immutable; create a new booking'
        using errcode='23514';
    end if;
    return new;
  end if;

  -- Lock the authoritative source against concurrent fee changes until commit.
  select * into provider from public.providers where id=new.provider_id for share;
  if not found or provider.provider_type <> 'doctor'
    or provider.verification_status <> 'verified'
    or provider.consultation_fee_mmk is null then
    raise exception 'No authoritative appointment price is configured' using errcode='23514';
  end if;
  select * into slot from public.provider_availability where id=new.provider_availability_id for update;
  if not found or slot.provider_id is distinct from new.provider_id
    or slot.service_type is distinct from new.appointment_type
    or slot.start_at is distinct from new.scheduled_start
    or slot.end_at is distinct from new.scheduled_end then
    raise exception 'Appointment does not match its provider availability' using errcode='23514';
  end if;
  if slot.status <> 'available' then
    raise exception 'Selected appointment time is no longer available' using errcode='23P01';
  end if;
  new.fee_amount := provider.consultation_fee_mmk;
  new.currency := 'MMK';
  return new;
end;
$$;
revoke all on function public.enforce_appointment_pricing() from public, anon, authenticated;
create trigger appointments_enforce_pricing
before insert or update on public.appointments
for each row execute function public.enforce_appointment_pricing();
comment on function public.enforce_appointment_pricing() is
  'Doctor appointment price snapshot from providers.consultation_fee_mmk, including explicit zero. Applies to service-role writes as well as clients. Historical rows are not repriced.';
commit;
