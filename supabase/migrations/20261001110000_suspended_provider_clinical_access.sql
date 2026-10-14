-- Repair 3: identity is necessary, never sufficient, for clinical authorization.
-- Run supabase/scripts/provider_clinical_access_validation.sql before deployment.
begin;
create function public.clinical_identity_is_current() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case
    -- Preserve existing patient/family rules; their relationships remain in RLS.
    when p.role in ('patient','family') then true
    when p.status is distinct from 'active' then false
    when p.role in ('doctor','nurse','caregiver') then exists (
      select 1 from public.providers pr where pr.profile_id=p.id
        and pr.verification_status='verified')
    when p.role='coordinator' then exists (
      select 1 from public.care_coordinators cc where cc.profile_id=p.id
        and cc.status='active')
    when p.role='clinic_admin' then exists (
      select 1 from public.clinic_staff cs where cs.profile_id=p.id
        and cs.clinic_role='sub_admin' and cs.status='active')
    when p.role='main_admin' then true
    else false end from public.profiles p where p.id=auth.uid()),false)
$$;
revoke all on function public.clinical_identity_is_current() from public, anon;
grant execute on function public.clinical_identity_is_current() to authenticated;

create or replace function public.can_access_patient(target_patient_id uuid, permission_name text default 'view')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.clinical_identity_is_current() and (
    exists (
      select 1 from public.patients patient
      where patient.id = target_patient_id and patient.auth_user_id = auth.uid()
    )
    or public.is_main_admin()
    or exists (
      select 1 from public.family_authorizations fa
      where fa.patient_id = target_patient_id
        and fa.family_profile_id = auth.uid()
        and fa.status = 'active'
        and case permission_name
          when 'appointments' then fa.can_manage_appointments
          when 'medications' then fa.can_manage_medications
          when 'payments' then fa.can_make_payments
          when 'alerts' then fa.can_receive_alerts
          else fa.can_view_records
        end
    )
    or exists (
      select 1 from public.providers provider
      where public.current_profile_role() in ('doctor','nurse','caregiver') and provider.profile_id = auth.uid() and provider.verification_status = 'verified'
        and (
          exists (select 1 from public.appointments appointment where appointment.patient_id = target_patient_id and appointment.provider_id = provider.id)
          or exists (
            select 1 from public.care_assignments assignment
            join public.care_requests request on request.id = assignment.care_request_id
            where request.patient_id = target_patient_id
              and assignment.provider_id = provider.id
              and assignment.status in ('assigned', 'accepted')
          )
        )
    )
    or (permission_name in ('view', 'appointments', 'alerts') and exists (
      select 1 from public.care_coordinators coordinator
      where public.current_profile_role() = 'coordinator' and coordinator.profile_id = auth.uid()
        and (
          exists (select 1 from public.patients patient where patient.id = target_patient_id and patient.primary_coordinator_id = coordinator.id)
          or exists (select 1 from public.care_requests request where request.patient_id = target_patient_id and request.coordinator_id = coordinator.id)
        )
    ))
    or (permission_name in ('appointments', 'alerts') and exists (
      select 1
      from public.clinic_staff admin_staff
      join public.clinic_staff provider_staff
        on provider_staff.clinic_id = admin_staff.clinic_id and provider_staff.status = 'active'
      join public.appointments appointment on appointment.provider_id = provider_staff.provider_id
      where public.current_profile_role() = 'clinic_admin' and admin_staff.profile_id = auth.uid()
        and admin_staff.clinic_role = 'sub_admin'
        and admin_staff.status = 'active'
        and appointment.patient_id = target_patient_id
    ))
  )
$$;

create or replace function public.is_appointment_provider(target_appointment_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.clinical_identity_is_current()
    and public.current_profile_role() in ('doctor','nurse','caregiver')
    and exists (select 1 from public.appointments a join public.providers p on p.id=a.provider_id
      where a.id=target_appointment_id and p.profile_id=auth.uid() and p.verification_status='verified')
$$;
-- Keep the existing RPC ACLs explicit. No alternative unguarded helper is retained.
revoke all on function public.can_access_patient(uuid,text) from public, anon;
revoke all on function public.is_appointment_provider(uuid) from public, anon;
grant execute on function public.can_access_patient(uuid,text) to authenticated;
grant execute on function public.is_appointment_provider(uuid) to authenticated;

-- RESTRICTIVE policies AND with the existing permissive relationship policies.
-- They grant no access themselves. BOTH old-row USING and new-row CHECK apply.
-- These legacy policies did not check a role at all. Keep their relationships,
-- but prevent a non-clinical profile with an inconsistent staff record using them.
alter policy encounters_provider_manage on public.care_encounters
  using (public.is_main_admin() or (
    public.current_profile_role() in ('doctor','nurse','caregiver') and exists (
      select 1 from public.providers p where p.id=care_encounters.provider_id and p.profile_id=auth.uid())))
  with check (public.is_main_admin() or (
    public.current_profile_role() in ('doctor','nurse','caregiver') and exists (
      select 1 from public.providers p where p.id=care_encounters.provider_id and p.profile_id=auth.uid())
    and public.is_appointment_provider(care_encounters.appointment_id)));
alter policy care_requests_coordinator_update on public.care_requests
  using (public.is_main_admin() or (public.current_profile_role()='coordinator' and exists (
    select 1 from public.care_coordinators cc where cc.id=care_requests.coordinator_id and cc.profile_id=auth.uid())))
  with check (public.is_main_admin() or (public.current_profile_role()='coordinator' and exists (
    select 1 from public.care_coordinators cc where cc.id=care_requests.coordinator_id and cc.profile_id=auth.uid())));
alter policy assignments_coordinator_manage on public.care_assignments
  using (public.is_main_admin() or (public.current_profile_role()='coordinator' and exists (
    select 1 from public.care_requests cr join public.care_coordinators cc on cc.id=cr.coordinator_id
    where cr.id=care_assignments.care_request_id and cc.profile_id=auth.uid())))
  with check (public.is_main_admin() or (public.current_profile_role()='coordinator' and exists (
    select 1 from public.care_requests cr join public.care_coordinators cc on cc.id=cr.coordinator_id
    where cr.id=care_assignments.care_request_id and cc.profile_id=auth.uid())));

create policy clinical_identity_required on public.patients
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.family_authorizations
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.consents
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.care_requests
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.care_assignments
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.appointments
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.visit_status_events
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.teleconsultation_sessions
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.care_encounters
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.clinical_notes
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.patient_conditions
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.patient_allergies
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.medical_history_items
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.vital_readings
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.prescriptions
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.prescription_items
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.patient_medications
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.medication_schedules
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.medication_events
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.follow_ups
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.monitoring_alerts
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.patient_health_profiles
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.lab_orders
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.lab_results
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.clinical_documents
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.ai_health_summaries
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
create policy clinical_identity_required on public.ai_interactions
  as restrictive for all to authenticated
  using ((select public.clinical_identity_is_current()))
  with check ((select public.clinical_identity_is_current()));
commit;
