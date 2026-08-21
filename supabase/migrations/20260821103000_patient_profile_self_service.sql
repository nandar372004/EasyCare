begin;

-- Limit the patient portal to the exact profile columns it displays.
revoke select on table public.patients from authenticated;
grant select (
  id, auth_user_id, full_name, date_of_birth, gender, primary_phone,
  preferred_language, address_line, township, city,
  emergency_contact_name, emergency_contact_relationship,
  emergency_contact_phone, blood_type, care_preferences, status
) on table public.patients to authenticated;

-- Remove any broad table-level update grant before allowing safe profile fields.
revoke update on table public.patients from authenticated;
grant update (
  full_name, date_of_birth, gender, preferred_language,
  address_line, township, city,
  emergency_contact_name, emergency_contact_relationship,
  emergency_contact_phone, blood_type, care_preferences
) on table public.patients to authenticated;

drop policy if exists patients_update_owner on public.patients;
drop policy if exists patients_update_own on public.patients;
create policy patients_update_own on public.patients
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

commit;
