-- Read-only current-price comparison, NOT proof of historical fraud.
-- There is no historical rate/version or appointment entitlement linkage.
select a.id as appointment_id,a.patient_id,a.provider_id,a.provider_availability_id,
       a.fee_amount,a.currency,p.consultation_fee_mmk as current_provider_fee_mmk,
       array_remove(array[
         case when p.consultation_fee_mmk>0 and a.fee_amount=0 then 'paid_provider_zero_fee' end,
         case when a.fee_amount<p.consultation_fee_mmk then 'below_current_price' end,
         case when p.consultation_fee_mmk is null or a.fee_amount is distinct from p.consultation_fee_mmk::numeric then 'current_price_not_reproduced' end,
         case when a.currency is distinct from 'MMK'::bpchar then 'currency_mismatch' end,
         case when p.provider_type is distinct from 'doctor'::public.provider_type then 'unsupported_pricing_provider' end,
         case when s.id is null or s.provider_id is distinct from a.provider_id
           or s.service_type is distinct from a.appointment_type
           or s.start_at is distinct from a.scheduled_start or s.end_at is distinct from a.scheduled_end
           then 'availability_relationship_mismatch' end
       ],null) as review_reasons
from public.appointments a left join public.providers p on p.id=a.provider_id
left join public.provider_availability s on s.id=a.provider_availability_id
where p.consultation_fee_mmk is null or a.fee_amount is distinct from p.consultation_fee_mmk::numeric
   or a.currency is distinct from 'MMK'::bpchar or p.provider_type is distinct from 'doctor'::public.provider_type
   or s.id is null or s.provider_id is distinct from a.provider_id
   or s.service_type is distinct from a.appointment_type
   or s.start_at is distinct from a.scheduled_start or s.end_at is distinct from a.scheduled_end;
