-- Restore the existing patient-facing prescription read contract using
-- column-level privileges. RLS continues to enforce patient/clinical access.
begin;

grant select (
  id,
  patient_id,
  doctor_provider_id,
  status,
  instructions,
  issued_at
) on table public.prescriptions to authenticated;

grant select (
  id,
  -- Required by the nested PostgREST relationship join; not displayed.
  prescription_id,
  medication_name,
  strength,
  dose,
  route,
  frequency,
  duration_days,
  instructions
) on table public.prescription_items to authenticated;

-- providers.display_name is already included in the patient directory's
-- authenticated column grant; no additional provider privilege is needed.

commit;
