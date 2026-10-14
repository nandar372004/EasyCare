begin;

-- Reconcile the stricter provider relationship rule with the explicit Family
-- permission scopes introduced by the Care Plan foundation. Keep every scope
-- separate: a care plan grant cannot authorize records or other clinical data.
create or replace function public.can_access_patient(target_patient_id uuid, permission_name text default 'view')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select permission_name in ('view','clinical','records','appointments','medications','payments','alerts','care_plans')
    and public.clinical_identity_is_current() and (
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
          and (fa.consent_id is null or exists (
            select 1 from public.consents c
            where c.id = fa.consent_id and c.patient_id = fa.patient_id and c.status = 'granted'
          ))
          and (fa.source_family_group_id is null or (
            exists (
              select 1 from public.family_group_members owner_member
              where owner_member.family_group_id = fa.source_family_group_id
                and owner_member.patient_id = fa.patient_id
                and owner_member.status = 'active'
            )
            and exists (
              select 1
              from public.family_group_members viewer_member
              join public.patients viewer_patient on viewer_patient.profile_id = fa.family_profile_id
              where viewer_member.family_group_id = fa.source_family_group_id
                and viewer_member.patient_id = viewer_patient.id
                and viewer_member.status = 'active'
            )
          ))
          and case permission_name
            when 'appointments' then fa.can_manage_appointments
            when 'medications' then fa.can_manage_medications
            when 'payments' then fa.can_make_payments
            when 'alerts' then fa.can_receive_alerts
            when 'care_plans' then fa.can_view_care_plans
            when 'view' then fa.can_view_records
            when 'clinical' then fa.can_view_records
            when 'records' then fa.can_view_records
            else false
          end
      )
      or public.provider_has_current_clinical_relationship(target_patient_id)
      or (permission_name in ('view', 'appointments', 'alerts') and exists (
        select 1 from public.care_coordinators coordinator
        where public.current_profile_role() = 'coordinator'
          and coordinator.profile_id = auth.uid()
          and (
            exists (
              select 1 from public.patients patient
              where patient.id = target_patient_id
                and patient.primary_coordinator_id = coordinator.id
            )
            or exists (
              select 1 from public.care_requests request
              where request.patient_id = target_patient_id
                and request.coordinator_id = coordinator.id
            )
          )
      ))
      or (permission_name in ('appointments', 'alerts') and exists (
        select 1
        from public.clinic_staff admin_staff
        join public.clinic_staff provider_staff
          on provider_staff.clinic_id = admin_staff.clinic_id and provider_staff.status = 'active'
        join public.appointments appointment on appointment.provider_id = provider_staff.provider_id
        where public.current_profile_role() = 'clinic_admin'
          and admin_staff.profile_id = auth.uid()
          and admin_staff.clinic_role = 'sub_admin'
          and admin_staff.status = 'active'
          and appointment.patient_id = target_patient_id
      ))
    )
$$;

revoke all on function public.can_access_patient(uuid, text) from public, anon;
grant execute on function public.can_access_patient(uuid, text) to authenticated;

commit;
