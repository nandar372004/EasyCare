begin;
set local lock_timeout = '10s';
lock table public.appointments, public.care_encounters in share row exclusive mode;
do $$
declare mismatches bigint;
begin
  select count(*) into mismatches
  from public.care_encounters e left join public.appointments a on a.id=e.appointment_id
  where a.id is null or e.patient_id is distinct from a.patient_id;
  if mismatches > 0 then
    raise exception 'Encounter repair stopped: % inconsistent appointment/patient relationships', mismatches
      using errcode='23514',hint='Run supabase/scripts/encounter_appointment_validation.sql. Review clinical records; do not automatically rewrite them.';
  end if;
end;
$$;
alter table public.appointments
  add constraint appointments_id_patient_key unique (id,patient_id);
alter table public.care_encounters
  add constraint care_encounters_appointment_patient_fk
  foreign key (appointment_id,patient_id) references public.appointments(id,patient_id)
  on update restrict on delete restrict;
-- Existing UNIQUE(appointment_id) already supports child lookups; no duplicate index.

-- Providers cannot SELECT appointments under the patient-only booking policy.
-- A caller-bound Boolean helper checks the parent without expanding appointment reads.
create function public.can_manage_care_encounter(
  target_appointment_id uuid,target_patient_id uuid,target_provider_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select public.clinical_identity_is_current() and exists (
    select 1 from public.appointments a
    where a.id=target_appointment_id and a.patient_id=target_patient_id
      and (public.is_main_admin() or (
        public.current_profile_role() in ('doctor','nurse','caregiver')
        and a.provider_id=target_provider_id
        and exists (select 1 from public.providers p
          where p.id=target_provider_id and p.profile_id=auth.uid()
            and p.verification_status='verified')
      ))
  )
$$;
revoke all on function public.can_manage_care_encounter(uuid,uuid,uuid) from public,anon;
grant execute on function public.can_manage_care_encounter(uuid,uuid,uuid) to authenticated;
alter policy encounters_provider_manage on public.care_encounters
  using (public.can_manage_care_encounter(care_encounters.appointment_id,care_encounters.patient_id,care_encounters.provider_id))
  with check (public.can_manage_care_encounter(care_encounters.appointment_id,care_encounters.patient_id,care_encounters.provider_id));
-- Preserve encounters_read, Repair 3 restrictive identity policy, and Repairs 1/2 FKs.
commit;
