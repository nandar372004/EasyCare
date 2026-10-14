begin;

-- Patient reads remain bounded by the existing can_access_patient RLS policies.
-- Grant only columns selected or used to scope the patient dashboard queries.
grant select (id, patient_id, condition_name, status)
  on table public.patient_conditions to authenticated;

grant select (id, patient_id, allergen, reaction, severity, status)
  on table public.patient_allergies to authenticated;

grant select (id, patient_id, category, title, occurred_on, details)
  on table public.medical_history_items to authenticated;

commit;
