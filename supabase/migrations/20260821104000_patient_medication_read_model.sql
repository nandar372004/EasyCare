begin;

-- Patient-only accounts no longer require a legacy profiles row. Medication
-- records may still reference their origin when one exists.
alter table public.patient_medications
  alter column created_by_profile_id drop not null,
  add column if not exists instructions text;

drop policy if exists patient_medications_read on public.patient_medications;
create policy patient_medications_read_own on public.patient_medications
  for select to authenticated
  using (
    exists (
      select 1 from public.patients patient
      where patient.id = patient_medications.patient_id
        and patient.auth_user_id = auth.uid()
    )
  );

drop policy if exists medication_schedules_read on public.medication_schedules;
create policy medication_schedules_read_own on public.medication_schedules
  for select to authenticated
  using (
    exists (
      select 1
      from public.patient_medications medication
      join public.patients patient on patient.id = medication.patient_id
      where medication.id = medication_schedules.patient_medication_id
        and patient.auth_user_id = auth.uid()
    )
  );

revoke all on table public.patient_medications from anon, authenticated;
grant select (
  id, patient_id, medication_name, dose, frequency, instructions,
  start_date, end_date, status
) on table public.patient_medications to authenticated;

revoke all on table public.medication_schedules from anon, authenticated;
grant select (
  id, patient_medication_id, time_of_day, days_of_week,
  timezone, valid_from, valid_until
) on table public.medication_schedules to authenticated;

commit;
