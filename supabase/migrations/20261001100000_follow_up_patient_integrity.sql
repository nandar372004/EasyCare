begin;
set local lock_timeout = '10s';
lock table public.appointments, public.care_encounters, public.follow_ups in share row exclusive mode;

do $$
declare inconsistent_count bigint;
begin
  select count(*) into inconsistent_count
  from public.follow_ups as follow_up
  left join public.patients as patient on patient.id = follow_up.patient_id
  left join public.care_encounters as encounter on encounter.id = follow_up.encounter_id
  left join public.appointments as appointment on appointment.id = encounter.appointment_id
  where patient.id is null or encounter.id is null or appointment.id is null
     or follow_up.patient_id is distinct from encounter.patient_id
     or encounter.patient_id is distinct from appointment.patient_id;
  if inconsistent_count > 0 then
    raise exception 'Follow-up repair stopped: % inconsistent patient/encounter/appointment relationships', inconsistent_count
      using errcode = '23514', hint = 'Run supabase/scripts/follow_up_relationship_validation.sql as a trusted operator. Review reported IDs; do not automatically rewrite clinical data.';
  end if;
end;
$$;

alter table public.follow_ups
  add constraint follow_ups_encounter_patient_fk foreign key (encounter_id, patient_id)
  references public.care_encounters(id, patient_id) on update restrict on delete restrict;
create index follow_ups_encounter_patient_idx on public.follow_ups(encounter_id, patient_id);

-- A follow-up has no independent appointment column. Check its existing parent
-- chain without adding a duplicate relationship or constraining unrelated rows.
create function public.check_follow_up_parent_chain() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent_appointment uuid; parent_patient uuid; encounter_patient uuid;
begin
  if tg_table_name = 'follow_ups' then
    select encounter.appointment_id, encounter.patient_id into parent_appointment, encounter_patient
    from public.care_encounters as encounter where encounter.id = new.encounter_id
    for share;
    select appointment.patient_id into parent_patient
    from public.appointments as appointment where appointment.id = parent_appointment
    for share;
    if parent_patient is distinct from encounter_patient then
      raise exception 'Follow-up appointment patient mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'care_encounters' then
    -- Lock the appointment even before testing for children: a concurrent
    -- follow-up insert locks this encounter and cannot pass an obsolete chain.
    select appointment.patient_id into parent_patient
    from public.appointments as appointment where appointment.id = new.appointment_id
    for share;
    if parent_patient is distinct from new.patient_id and exists (
      select 1 from public.follow_ups as follow_up where follow_up.encounter_id = old.id
    ) then
      raise exception 'Encounter change would invalidate follow-up ownership' using errcode = '23514';
    end if;
  elsif tg_table_name = 'appointments' then
    if exists (
      select 1 from public.care_encounters as encounter
      join public.follow_ups as follow_up on follow_up.encounter_id = encounter.id
      where encounter.appointment_id = old.id and follow_up.patient_id is distinct from new.patient_id
    ) then
      raise exception 'Appointment change would invalidate follow-up ownership' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.check_follow_up_parent_chain() from public, anon, authenticated;
create trigger follow_ups_parent_chain before insert or update of encounter_id, patient_id
  on public.follow_ups for each row execute function public.check_follow_up_parent_chain();
create trigger follow_ups_encounter_parent_guard before update of appointment_id, patient_id
  on public.care_encounters for each row execute function public.check_follow_up_parent_chain();
create trigger follow_ups_appointment_parent_guard before update of patient_id
  on public.appointments for each row execute function public.check_follow_up_parent_chain();

-- Authorization only. Assignment is necessary for staff management, never
-- sufficient. Reuse existing role/access helpers; do not change suspension or
-- historical appointment semantics here. Coordinators use their existing view
-- permission, whereas clinical providers require clinical permission.
create function public.can_manage_follow_up(target_patient_id uuid, target_assignee_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_main_admin() or (
    target_assignee_profile_id = auth.uid()
    and (
      (public.current_profile_role() in ('doctor','nurse','caregiver')
        and public.can_access_patient(target_patient_id, 'clinical'))
      or (public.current_profile_role() = 'coordinator'
        and public.can_access_patient(target_patient_id, 'view'))
    )
  )
$$;
revoke all on function public.can_manage_follow_up(uuid,uuid) from public, anon;
grant execute on function public.can_manage_follow_up(uuid,uuid) to authenticated;

drop policy follow_ups_assignee_manage on public.follow_ups;
-- Preserve the existing clinical/family read policy; this extra SELECT replaces
-- only the old ALL policy's legitimate staff-assignee/admin read contribution.
create policy follow_ups_staff_read on public.follow_ups for select to authenticated
  using (public.can_manage_follow_up(follow_ups.patient_id, follow_ups.assigned_to_profile_id));
create policy follow_ups_staff_create on public.follow_ups for insert to authenticated
  with check (public.can_manage_follow_up(follow_ups.patient_id, follow_ups.assigned_to_profile_id));
create policy follow_ups_staff_update on public.follow_ups for update to authenticated
  using (public.can_manage_follow_up(follow_ups.patient_id, follow_ups.assigned_to_profile_id))
  with check (public.can_manage_follow_up(follow_ups.patient_id, follow_ups.assigned_to_profile_id));
create policy follow_ups_staff_delete on public.follow_ups for delete to authenticated
  using (public.can_manage_follow_up(follow_ups.patient_id, follow_ups.assigned_to_profile_id));
commit;
