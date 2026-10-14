begin;
set local lock_timeout = '10s';
lock table public.appointments, public.payments in share row exclusive mode;
do $$
declare mismatches bigint;
begin
  select count(*) into mismatches
  from public.payments p left join public.appointments a on a.id=p.appointment_id
  where p.appointment_id is not null
    and (a.id is null or p.patient_id is distinct from a.patient_id);
  if mismatches > 0 then
    raise exception 'Payment repair stopped: % inconsistent appointment/patient relationships', mismatches
      using errcode='23514',hint='Run supabase/scripts/payment_appointment_validation.sql. Review financial records; do not automatically rewrite them.';
  end if;
end;
$$;
-- Reuse Repair 5's appointments_id_patient_key; preserve subscription-only rows.
alter table public.payments add constraint payments_appointment_patient_fk
  foreign key (appointment_id,patient_id) references public.appointments(id,patient_id)
  on update restrict on delete restrict;
create index payments_appointment_patient_idx on public.payments(appointment_id,patient_id)
  where appointment_id is not null;

-- Family payers can be authorized without SELECT access to appointment rows.
-- Return only a caller-authorized Boolean; do not expand appointment visibility.
create function public.can_create_payment_for_appointment(target_appointment_id uuid,target_patient_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.can_access_patient(target_patient_id,'payments'),false)
    and (target_appointment_id is null or exists (
      select 1 from public.appointments a
      where a.id=target_appointment_id and a.patient_id=target_patient_id
    ))
$$;
revoke all on function public.can_create_payment_for_appointment(uuid,uuid) from public,anon;
grant execute on function public.can_create_payment_for_appointment(uuid,uuid) to authenticated;
alter policy payments_create on public.payments with check (
  payments.payer_profile_id=auth.uid()
  and payments.status='pending'
  and payments.paid_at is null and payments.refunded_at is null
  and public.can_create_payment_for_appointment(payments.appointment_id,payments.patient_id)
);
-- Preserve payments_read. No client UPDATE or DELETE policy is added.
-- Amount, currency, financial status and external references are not rewritten.
commit;
