begin;

create table public.ai_interactions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete restrict,
  user_profile_id uuid not null references public.profiles(id) on delete restrict,
  interaction_type public.ai_interaction_type not null,
  input_summary jsonb,
  output_summary jsonb,
  urgency_level public.care_urgency,
  model_version text,
  human_review_required boolean not null default false,
  created_at timestamptz not null default statement_timestamp()
);
create index ai_interactions_patient_created_idx on public.ai_interactions(patient_id, created_at desc) where patient_id is not null;

create table public.ai_health_summaries (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  period_start timestamptz not null,
  period_end timestamptz not null,
  summary_type public.ai_summary_type not null,
  summary_text text not null,
  source_snapshot jsonb,
  review_status public.ai_review_status not null default 'generated',
  created_at timestamptz not null default statement_timestamp(),
  check (period_end > period_start),
  unique (patient_id, summary_type, period_start, period_end)
);

create table public.teleconsultation_sessions (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id) on delete restrict,
  provider_name text,
  room_reference text,
  join_url_patient text,
  join_url_provider text,
  started_at timestamptz,
  ended_at timestamptz,
  status public.teleconsultation_status not null default 'scheduled',
  check (ended_at is null or started_at is null or ended_at >= started_at)
);

create function public.current_profile_role() returns public.profile_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and status = 'active' limit 1
$$;

create function public.is_main_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_profile_role() = 'main_admin', false)
$$;

create function public.can_access_patient(target_patient_id uuid, permission_name text default 'view') returns boolean
language sql stable security definer set search_path = '' as $$
  select
    public.is_main_admin()
    or exists (select 1 from public.patients p where p.id = target_patient_id and p.profile_id = auth.uid())
    or exists (
      select 1 from public.family_authorizations f
      where f.patient_id = target_patient_id and f.family_profile_id = auth.uid()
        and f.status = 'active'
        and case permission_name
          when 'appointments' then f.can_manage_appointments
          when 'medications' then f.can_manage_medications
          when 'payments' then f.can_make_payments
          when 'alerts' then f.can_receive_alerts
          else f.can_view_records
        end
    )
    or exists (
      select 1 from public.providers pr
      where pr.profile_id = auth.uid() and pr.verification_status = 'verified'
        and (exists (select 1 from public.appointments a where a.patient_id = target_patient_id and a.provider_id = pr.id)
          or exists (select 1 from public.care_assignments ca join public.care_requests cr on cr.id = ca.care_request_id where cr.patient_id = target_patient_id and ca.provider_id = pr.id and ca.status in ('assigned','accepted')))
    )
    or (permission_name in ('view','appointments','alerts') and exists (
      select 1 from public.care_coordinators cc
      where cc.profile_id = auth.uid() and (exists (select 1 from public.patients p where p.id = target_patient_id and p.primary_coordinator_id = cc.id)
        or exists (select 1 from public.care_requests cr where cr.patient_id = target_patient_id and cr.coordinator_id = cc.id))
    ))
    or (permission_name in ('appointments','alerts') and exists (
      select 1 from public.clinic_staff admin_staff
      join public.clinic_staff provider_staff on provider_staff.clinic_id = admin_staff.clinic_id and provider_staff.status = 'active'
      join public.appointments a on a.provider_id = provider_staff.provider_id
      where admin_staff.profile_id = auth.uid() and admin_staff.clinic_role = 'sub_admin' and admin_staff.status = 'active'
        and a.patient_id = target_patient_id
    ))
$$;

create function public.is_appointment_provider(target_appointment_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.appointments a join public.providers p on p.id = a.provider_id where a.id = target_appointment_id and p.profile_id = auth.uid())
$$;

revoke all on function public.current_profile_role() from public;
revoke all on function public.is_main_admin() from public;
revoke all on function public.can_access_patient(uuid,text) from public;
revoke all on function public.is_appointment_provider(uuid) from public;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.is_main_admin() to authenticated;
grant execute on function public.can_access_patient(uuid,text) to authenticated;
grant execute on function public.is_appointment_provider(uuid) to authenticated;

create function public.protect_security_managed_fields() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_main_admin() then
    if tg_table_name = 'profiles' and (new.role is distinct from old.role or new.status is distinct from old.status) then
      raise exception 'Profile role and status are administratively managed' using errcode='42501';
    elsif tg_table_name = 'providers' and (new.profile_id is distinct from old.profile_id or new.provider_type is distinct from old.provider_type or new.verification_status is distinct from old.verification_status or new.verified_at is distinct from old.verified_at) then
      raise exception 'Provider identity and verification are administratively managed' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_protect_security_fields before update on public.profiles for each row execute function public.protect_security_managed_fields();
create trigger providers_protect_security_fields before update on public.providers for each row execute function public.protect_security_managed_fields();

do $$ declare table_name text; begin
  foreach table_name in array array[
    'profiles','patients','family_authorizations','consents','providers','provider_credentials','specialties','provider_specialties',
    'partner_clinics','clinic_staff','provider_availability','care_requests','appointments','care_assignments','visit_status_events',
    'care_encounters','clinical_notes','patient_conditions','patient_allergies','medical_history_items','vital_readings',
    'prescriptions','prescription_items','patient_medications','medication_schedules','medication_events','care_coordinators',
    'follow_ups','monitoring_alerts','notifications','service_catalog','pricing_rules','care_packages','package_services',
    'subscriptions','payments','feedback','complaints','audit_logs','ai_interactions','ai_health_summaries','teleconsultation_sessions'
  ] loop execute format('alter table public.%I enable row level security', table_name); end loop;
end $$;

create policy profiles_read_self on public.profiles for select to authenticated using (id = auth.uid() or public.is_main_admin());
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy patients_read_authorized on public.patients for select to authenticated using (public.can_access_patient(id,'view'));
create policy patients_update_owner on public.patients for update to authenticated using (profile_id = auth.uid() or public.is_main_admin()) with check (profile_id = auth.uid() or public.is_main_admin());
create policy family_authorizations_read on public.family_authorizations for select to authenticated using (family_profile_id = auth.uid() or public.can_access_patient(patient_id,'view'));
create policy family_authorizations_owner_manage on public.family_authorizations for all to authenticated using (exists(select 1 from public.patients p where p.id=patient_id and p.profile_id=auth.uid()) or public.is_main_admin()) with check (exists(select 1 from public.patients p where p.id=patient_id and p.profile_id=auth.uid()) or public.is_main_admin());
create policy consents_read on public.consents for select to authenticated using (public.can_access_patient(patient_id,'view'));
create policy consents_owner_manage on public.consents for all to authenticated using (exists(select 1 from public.patients p where p.id=patient_id and p.profile_id=auth.uid()) or public.is_main_admin()) with check (exists(select 1 from public.patients p where p.id=patient_id and p.profile_id=auth.uid()) or public.is_main_admin());

create policy providers_directory_read on public.providers for select to authenticated using (verification_status='verified' or profile_id=auth.uid() or public.is_main_admin());
create policy providers_owner_update on public.providers for update to authenticated using (profile_id=auth.uid() or public.is_main_admin()) with check (profile_id=auth.uid() or public.is_main_admin());
create policy credentials_owner_read on public.provider_credentials for select to authenticated using (exists(select 1 from public.providers p where p.id=provider_id and p.profile_id=auth.uid()) or public.is_main_admin());
create policy specialties_read on public.specialties for select to authenticated using (true);
create policy provider_specialties_read on public.provider_specialties for select to authenticated using (true);
create policy clinics_read on public.partner_clinics for select to authenticated using (status='active' or public.is_main_admin());
create policy clinic_staff_self_read on public.clinic_staff for select to authenticated using (profile_id=auth.uid() or public.is_main_admin());
create policy availability_read on public.provider_availability for select to authenticated using (status='available' or exists(select 1 from public.providers p where p.id=provider_id and p.profile_id=auth.uid()) or public.is_main_admin());
create policy availability_provider_manage on public.provider_availability for all to authenticated using (exists(select 1 from public.providers p where p.id=provider_id and p.profile_id=auth.uid()) or public.is_main_admin()) with check (exists(select 1 from public.providers p where p.id=provider_id and p.profile_id=auth.uid()) or public.is_main_admin());

create policy care_requests_read on public.care_requests for select to authenticated using (public.can_access_patient(patient_id,'appointments'));
create policy care_requests_create on public.care_requests for insert to authenticated with check (requested_by_profile_id=auth.uid() and status='new' and urgency_level='unassessed' and public.can_access_patient(patient_id,'appointments'));
create policy care_requests_coordinator_update on public.care_requests for update to authenticated using (public.is_main_admin() or exists(select 1 from public.care_coordinators cc where cc.id=coordinator_id and cc.profile_id=auth.uid())) with check (public.is_main_admin() or exists(select 1 from public.care_coordinators cc where cc.id=coordinator_id and cc.profile_id=auth.uid()));
create policy appointments_read on public.appointments for select to authenticated using (public.can_access_patient(patient_id,'appointments'));
create policy appointments_create on public.appointments for insert to authenticated with check (booked_by_profile_id=auth.uid() and status='pending' and cancelled_at is null and public.can_access_patient(patient_id,'appointments'));
create policy appointments_update on public.appointments for update to authenticated using (public.can_access_patient(patient_id,'appointments')) with check (public.can_access_patient(patient_id,'appointments'));
create policy assignments_read on public.care_assignments for select to authenticated using (exists(select 1 from public.care_requests cr where cr.id=care_request_id and public.can_access_patient(cr.patient_id,'appointments')));
create policy assignments_coordinator_manage on public.care_assignments for all to authenticated using (public.is_main_admin() or exists(select 1 from public.care_requests cr join public.care_coordinators cc on cc.id=cr.coordinator_id where cr.id=care_request_id and cc.profile_id=auth.uid())) with check (public.is_main_admin() or exists(select 1 from public.care_requests cr join public.care_coordinators cc on cc.id=cr.coordinator_id where cr.id=care_request_id and cc.profile_id=auth.uid()));
create policy visit_events_read on public.visit_status_events for select to authenticated using (exists(select 1 from public.appointments a where a.id=appointment_id and public.can_access_patient(a.patient_id,'appointments')));
create policy visit_events_provider_create on public.visit_status_events for insert to authenticated with check (actor_profile_id=auth.uid() and (public.is_appointment_provider(appointment_id) or public.is_main_admin()));
create policy teleconsultation_read on public.teleconsultation_sessions for select to authenticated using (exists(select 1 from public.appointments a where a.id=appointment_id and public.can_access_patient(a.patient_id,'appointments')));

create policy encounters_read on public.care_encounters for select to authenticated using (public.can_access_patient(patient_id,'clinical'));
create policy encounters_provider_manage on public.care_encounters for all to authenticated using (public.is_main_admin() or exists(select 1 from public.providers p where p.id=provider_id and p.profile_id=auth.uid())) with check (public.is_main_admin() or (exists(select 1 from public.providers p where p.id=provider_id and p.profile_id=auth.uid()) and public.is_appointment_provider(appointment_id)));
create policy clinical_notes_read on public.clinical_notes for select to authenticated using (exists(select 1 from public.care_encounters e where e.id=encounter_id and public.can_access_patient(e.patient_id,'clinical')));
create policy clinical_notes_assigned_create on public.clinical_notes for insert to authenticated with check (author_profile_id=auth.uid() and exists(select 1 from public.care_encounters e join public.providers p on p.id=e.provider_id where e.id=encounter_id and p.profile_id=auth.uid()) and case public.current_profile_role() when 'doctor' then true when 'nurse' then note_type in ('assessment','progress','nursing','follow_up') when 'caregiver' then note_type='caregiver' else false end);
create policy conditions_read on public.patient_conditions for select to authenticated using (public.can_access_patient(patient_id,'clinical'));
create policy conditions_doctor_create on public.patient_conditions for insert to authenticated with check (recorded_by=auth.uid() and public.current_profile_role()='doctor' and public.can_access_patient(patient_id,'clinical'));
create policy allergies_read on public.patient_allergies for select to authenticated using (public.can_access_patient(patient_id,'clinical'));
create policy allergies_provider_create on public.patient_allergies for insert to authenticated with check (recorded_by=auth.uid() and public.current_profile_role() in ('doctor','nurse') and public.can_access_patient(patient_id,'clinical'));
create policy history_read on public.medical_history_items for select to authenticated using (public.can_access_patient(patient_id,'clinical'));
create policy vitals_read on public.vital_readings for select to authenticated using (public.can_access_patient(patient_id,'clinical'));
create policy vitals_assigned_create on public.vital_readings for insert to authenticated with check (recorded_by_profile_id=auth.uid() and public.current_profile_role() in ('doctor','nurse','caregiver') and public.can_access_patient(patient_id,'clinical'));
create policy prescriptions_read on public.prescriptions for select to authenticated using (public.can_access_patient(patient_id,'clinical'));
create policy prescriptions_doctor_create on public.prescriptions for insert to authenticated with check (public.current_profile_role()='doctor' and exists(select 1 from public.providers p join public.care_encounters e on e.provider_id=p.id where p.id=doctor_provider_id and p.profile_id=auth.uid() and e.id=encounter_id and e.patient_id=patient_id));
create policy prescription_items_read on public.prescription_items for select to authenticated using (exists(select 1 from public.prescriptions p where p.id=prescription_id and public.can_access_patient(p.patient_id,'clinical')));
create policy prescription_items_doctor_create on public.prescription_items for insert to authenticated with check (exists(select 1 from public.prescriptions rx join public.providers p on p.id=rx.doctor_provider_id where rx.id=prescription_id and p.profile_id=auth.uid() and public.current_profile_role()='doctor'));
create policy patient_medications_read on public.patient_medications for select to authenticated using (public.can_access_patient(patient_id,'medications'));
create policy medication_schedules_read on public.medication_schedules for select to authenticated using (exists(select 1 from public.patient_medications m where m.id=patient_medication_id and public.can_access_patient(m.patient_id,'medications')));
create policy medication_events_read on public.medication_events for select to authenticated using (public.can_access_patient(patient_id,'medications'));
create policy follow_ups_read on public.follow_ups for select to authenticated using (public.can_access_patient(patient_id,'clinical'));
create policy coordinators_read_self on public.care_coordinators for select to authenticated using (profile_id=auth.uid() or public.is_main_admin());
create policy follow_ups_assignee_manage on public.follow_ups for all to authenticated using (assigned_to_profile_id=auth.uid() or public.is_main_admin()) with check (assigned_to_profile_id=auth.uid() or public.is_main_admin());
create policy alerts_read on public.monitoring_alerts for select to authenticated using (public.can_access_patient(patient_id,'alerts'));
create policy alerts_provider_create on public.monitoring_alerts for insert to authenticated with check (public.current_profile_role() in ('doctor','nurse') and public.can_access_patient(patient_id,'clinical'));
create policy alerts_reviewer_update on public.monitoring_alerts for update to authenticated using (public.current_profile_role() in ('doctor','nurse','coordinator','main_admin') and public.can_access_patient(patient_id,'alerts')) with check (reviewed_by_profile_id=auth.uid() or public.is_main_admin());

create policy notifications_own on public.notifications for select to authenticated using (recipient_profile_id=auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated using (recipient_profile_id=auth.uid()) with check (recipient_profile_id=auth.uid());
create policy catalog_read on public.service_catalog for select to authenticated using (active);
create policy pricing_read on public.pricing_rules for select to authenticated using (active);
create policy packages_read on public.care_packages for select to authenticated using (active);
create policy package_services_read on public.package_services for select to authenticated using (true);
create policy subscriptions_read on public.subscriptions for select to authenticated using (public.can_access_patient(patient_id,'payments'));
create policy subscriptions_create on public.subscriptions for insert to authenticated with check (purchased_by_profile_id=auth.uid() and status='pending' and public.can_access_patient(patient_id,'payments'));
create policy payments_read on public.payments for select to authenticated using (payer_profile_id=auth.uid() or public.can_access_patient(patient_id,'payments'));
create policy payments_create on public.payments for insert to authenticated with check (payer_profile_id=auth.uid() and status='pending' and paid_at is null and refunded_at is null and public.can_access_patient(patient_id,'payments'));
create policy feedback_read_own on public.feedback for select to authenticated using (submitted_by_profile_id=auth.uid() or public.is_main_admin());
create policy feedback_create on public.feedback for insert to authenticated with check (submitted_by_profile_id=auth.uid() and exists(select 1 from public.appointments a where a.id=appointment_id and a.status='completed' and public.can_access_patient(a.patient_id,'view')));
create policy complaints_read on public.complaints for select to authenticated using (submitted_by_profile_id=auth.uid() or public.is_main_admin());
create policy complaints_create on public.complaints for insert to authenticated with check (submitted_by_profile_id=auth.uid() and (patient_id is null or public.can_access_patient(patient_id,'view')));
create policy audit_admin_read on public.audit_logs for select to authenticated using (public.is_main_admin());

-- AI writes are intentionally server-side only. Authenticated users can read only scoped, sanitized outputs.
create policy ai_interactions_read on public.ai_interactions for select to authenticated using (user_profile_id=auth.uid() and (patient_id is null or public.can_access_patient(patient_id,'view')));
create policy ai_summaries_read on public.ai_health_summaries for select to authenticated using (review_status<>'hidden' and public.can_access_patient(patient_id,'clinical'));

commit;
