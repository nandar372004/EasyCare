begin;

-- A provider relationship is current only while its source is in a current
-- lifecycle state. A non-terminal Care Plan is the explicit ongoing-care link.
create function public.provider_has_current_clinical_relationship(target_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.clinical_identity_is_current()
    and public.current_profile_role() in ('doctor','nurse','caregiver')
    and exists (
      select 1 from public.providers provider
      where provider.profile_id = auth.uid()
        and provider.verification_status = 'verified'
        and ((public.current_profile_role() = 'doctor' and provider.provider_type = 'doctor')
          or (public.current_profile_role() = 'nurse' and provider.provider_type in ('nurse','nurse_aide'))
          or (public.current_profile_role() = 'caregiver' and provider.provider_type = 'caregiver'))
        and (
          exists (
            select 1 from public.appointments appointment
            where appointment.patient_id = target_patient_id
              and appointment.provider_id = provider.id
              and appointment.status in ('pending','confirmed','rescheduled')
              and appointment.cancelled_at is null
              and appointment.scheduled_end > statement_timestamp()
          )
          or exists (
            select 1 from public.care_assignments assignment
            join public.care_requests request on request.id = assignment.care_request_id
            where request.patient_id = target_patient_id
              and assignment.provider_id = provider.id
              and assignment.status in ('assigned','accepted')
              and request.status not in ('closed','cancelled')
          )
          or (provider.provider_type = 'doctor' and exists (
            select 1 from public.care_plans plan
            where plan.patient_id = target_patient_id
              and plan.responsible_provider_id = provider.id
              and plan.status in ('active','paused')
          ))
        )
    )
$$;

revoke all on function public.provider_has_current_clinical_relationship(uuid) from public, anon, authenticated;

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
        and fa.revoked_at is null
        and (fa.expires_at is null or fa.expires_at > statement_timestamp())
        and (fa.consent_id is null or exists (select 1 from public.consents c where c.id=fa.consent_id and c.patient_id=fa.patient_id and c.status='granted'))
        and case permission_name
          when 'appointments' then fa.can_manage_appointments
          when 'medications' then fa.can_manage_medications
          when 'payments' then fa.can_make_payments
          when 'alerts' then fa.can_receive_alerts
          else fa.can_view_records
        end
    )
    or public.provider_has_current_clinical_relationship(target_patient_id)
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

revoke all on function public.can_access_patient(uuid,text) from public, anon;
grant execute on function public.can_access_patient(uuid,text) to authenticated;

create or replace function public.list_my_clinical_patients()
returns table(patient_id uuid, display_name text, relationship_context text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare current_provider uuid; current_type public.provider_type;
begin
  select identity.provider_id, identity.provider_type into current_provider, current_type
  from public.get_my_provider_identity() identity;
  if current_provider is null then return; end if;

  return query
  select patient.id, patient.full_name,
    case
      when exists (select 1 from public.appointments appointment
        where appointment.patient_id = patient.id and appointment.provider_id = current_provider
          and appointment.status in ('pending','confirmed','rescheduled')
          and appointment.cancelled_at is null and appointment.scheduled_end > statement_timestamp()) then 'appointment'
      when exists (select 1 from public.care_assignments assignment
        join public.care_requests request on request.id = assignment.care_request_id
        where request.patient_id = patient.id and assignment.provider_id = current_provider
          and assignment.status in ('assigned','accepted') and request.status not in ('closed','cancelled')) then 'care_assignment'
      else 'care_plan'
    end
  from public.patients patient
  where patient.status = 'active'
    and public.provider_has_current_clinical_relationship(patient.id)
    and public.can_access_patient(patient.id, 'clinical')
  order by patient.full_name, patient.id;
end $$;

create or replace function public.is_appointment_provider(target_appointment_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.clinical_identity_is_current()
    and public.current_profile_role() in ('doctor','nurse','caregiver')
    and exists (select 1 from public.appointments appointment join public.providers provider on provider.id=appointment.provider_id
      where appointment.id=target_appointment_id and provider.profile_id=auth.uid() and provider.verification_status='verified'
        and ((public.current_profile_role()='doctor' and provider.provider_type='doctor')
          or (public.current_profile_role()='nurse' and provider.provider_type in ('nurse','nurse_aide'))
          or (public.current_profile_role()='caregiver' and provider.provider_type='caregiver'))
        and appointment.status in ('pending','confirmed','rescheduled') and appointment.cancelled_at is null
        and appointment.scheduled_end > statement_timestamp())
$$;
revoke all on function public.is_appointment_provider(uuid) from public,anon;
grant execute on function public.is_appointment_provider(uuid) to authenticated;

-- Existing provider encounter policies permitted UPDATE/DELETE by provider_id
-- alone. Require the appointment to remain current for encounter mutations.
alter policy encounters_provider_manage on public.care_encounters
  using (public.is_main_admin() or (
    public.current_profile_role() in ('doctor','nurse','caregiver')
    and exists (select 1 from public.providers provider where provider.id=care_encounters.provider_id and provider.profile_id=auth.uid())
    and public.is_appointment_provider(care_encounters.appointment_id)))
  with check (public.is_main_admin() or (
    public.current_profile_role() in ('doctor','nurse','caregiver')
    and exists (select 1 from public.providers provider where provider.id=care_encounters.provider_id and provider.profile_id=auth.uid())
    and public.is_appointment_provider(care_encounters.appointment_id)));
-- Repair 13's old predicate is no longer used by the RLS policy; remove its
-- caller-visible Boolean probe after replacing the policy with the stricter check.
revoke all on function public.can_manage_care_encounter(uuid,uuid,uuid) from public, anon, authenticated;

-- Clinical note and prescription writes also need a current relationship;
-- encounter/provider ownership by itself must not preserve stale access.
drop policy clinical_notes_assigned_create on public.clinical_notes;
create policy clinical_notes_assigned_create on public.clinical_notes for insert to authenticated
  with check (author_profile_id=auth.uid()
    and exists(select 1 from public.care_encounters encounter join public.providers provider on provider.id=encounter.provider_id
      where encounter.id=encounter_id and provider.profile_id=auth.uid()
        and public.can_access_patient(encounter.patient_id,'clinical'))
    and case public.current_profile_role()
      when 'doctor' then true
      when 'nurse' then note_type in ('assessment','progress','nursing','follow_up')
      when 'caregiver' then note_type='caregiver'
      else false end);

drop policy prescriptions_doctor_create on public.prescriptions;
create policy prescriptions_doctor_create on public.prescriptions for insert to authenticated
  with check (public.current_profile_role()='doctor'
    and exists(select 1 from public.providers provider join public.care_encounters encounter on encounter.provider_id=provider.id
      where provider.id=prescriptions.doctor_provider_id and provider.profile_id=auth.uid()
        and encounter.id=prescriptions.encounter_id and encounter.patient_id=prescriptions.patient_id
        and public.can_access_patient(prescriptions.patient_id,'clinical')));

drop policy prescription_items_doctor_create on public.prescription_items;
create policy prescription_items_doctor_create on public.prescription_items for insert to authenticated
  with check (exists(select 1 from public.prescriptions prescription join public.providers provider on provider.id=prescription.doctor_provider_id
    where prescription.id=prescription_id and provider.profile_id=auth.uid()
      and public.current_profile_role()='doctor'
      and public.can_access_patient(prescription.patient_id,'clinical')));

commit;
