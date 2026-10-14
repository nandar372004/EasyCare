-- Read-only administrator preflight. Only structural mismatches block deployment.
select p.id as payment_id,p.patient_id as payment_patient_id,p.appointment_id,
       a.patient_id as appointment_patient_id,p.payer_profile_id,p.subscription_id,
       (a.id is null or p.patient_id is distinct from a.patient_id) as structural_blocker,
       p.amount,a.fee_amount as appointment_fee,p.currency,a.currency as appointment_currency,
       array_remove(array[
         case when a.id is null then 'missing_appointment' end,
         case when a.id is not null and p.patient_id is distinct from a.patient_id then 'patient_mismatch' end,
         case when a.id is not null and p.currency is distinct from a.currency then 'currency_review' end,
         case when a.id is not null and p.amount is distinct from a.fee_amount then 'amount_review' end
       ],null) as review_reasons
from public.payments p left join public.appointments a on a.id=p.appointment_id
where p.appointment_id is not null and (
  a.id is null or p.patient_id is distinct from a.patient_id
  or p.currency is distinct from a.currency or p.amount is distinct from a.fee_amount
);
-- Amount differences are not proof of invalid settlement: the schema permits
-- multiple payments and does not identify installment/retry/refund semantics.
