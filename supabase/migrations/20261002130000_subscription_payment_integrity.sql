begin;
set local lock_timeout = '10s';

-- Lock tables in share row exclusive mode to prevent concurrent writes during preflight and constraint creation.
lock table public.subscriptions, public.payments in share row exclusive mode;

do $$
declare inconsistent_count bigint;
begin
  select count(*) into inconsistent_count
  from public.payments as payment
  left join public.subscriptions as subscription on subscription.id = payment.subscription_id
  where payment.subscription_id is not null
    and (subscription.id is null or payment.patient_id is distinct from subscription.patient_id);
  if inconsistent_count > 0 then
    raise exception 'Subscription payment repair stopped: % inconsistent subscription/patient relationships', inconsistent_count
      using errcode = '23514',
            hint = 'Run supabase/scripts/subscription_payment_validation.sql as a trusted operator. Review financial records; do not automatically rewrite them.';
  end if;
end;
$$;

-- Add unique constraint on subscriptions(id, patient_id) to serve as target for composite foreign key.
alter table public.subscriptions
  add constraint subscriptions_id_patient_key unique (id, patient_id);

-- Add composite foreign key from payments(subscription_id, patient_id) to subscriptions(id, patient_id).
-- MATCH SIMPLE preserves appointment-only payments where subscription_id is NULL.
-- ON UPDATE RESTRICT ON DELETE RESTRICT protects parent subscription mutations.
alter table public.payments
  add constraint payments_subscription_patient_fk
  foreign key (subscription_id, patient_id)
  references public.subscriptions(id, patient_id)
  match simple
  on update restrict on delete restrict;

-- Partial index to support composite foreign key lookups without indexing appointment-only payments.
create index payments_subscription_patient_idx
  on public.payments(subscription_id, patient_id)
  where subscription_id is not null;

commit;
