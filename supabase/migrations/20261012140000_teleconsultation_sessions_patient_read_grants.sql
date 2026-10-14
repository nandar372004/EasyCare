-- Allow authenticated patients to read only the fields needed to join their
-- own appointment session. Existing RLS policies remain the row-level gate.
grant select (appointment_id, join_url_patient)
  on public.teleconsultation_sessions
  to authenticated;
