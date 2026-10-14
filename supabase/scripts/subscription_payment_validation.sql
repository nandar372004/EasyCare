-- Read-only administrator preflight; no modification or inference of financial data.
-- Run as a trusted operator so RLS cannot hide inconsistent rows.

select
  payment.id as payment_id,
  payment.patient_id as payment_patient_id,
  payment.subscription_id,
  subscription.patient_id as subscription_patient_id,
  payment.payer_profile_id,
  payment.appointment_id,
  (subscription.id is null or payment.patient_id is distinct from subscription.patient_id) as structural_blocker,
  payment.amount,
  care_package.price as package_price,
  payment.currency,
  array_remove(array[
    case when subscription.id is null then 'missing_subscription' end,
    case when subscription.id is not null and payment.patient_id is distinct from subscription.patient_id then 'patient_mismatch' end,
    case when subscription.id is not null and care_package.id is null then 'missing_care_package' end,
    case when subscription.id is not null and care_package.price is not null and payment.amount is distinct from care_package.price then 'amount_review' end
  ], null) as review_reasons
from public.payments as payment
left join public.subscriptions as subscription on subscription.id = payment.subscription_id
left join public.care_packages as care_package on care_package.id = subscription.package_id
where payment.subscription_id is not null and (
  subscription.id is null
  or payment.patient_id is distinct from subscription.patient_id
  or (care_package.price is not null and payment.amount is distinct from care_package.price)
)
order by payment.id;
