begin;
set local lock_timeout = '10s';

-- Lock parent and child medication tables in share row exclusive mode to prevent concurrent writes during preflight.
lock table public.patient_medications, public.medication_schedules, public.medication_events in share row exclusive mode;

do $$
declare inconsistent_count bigint;
begin
  select count(*) into inconsistent_count
  from public.medication_events as e
  left join public.medication_schedules as s on s.id = e.schedule_id
  left join public.patient_medications as m on m.id = s.patient_medication_id
  where s.id is null or m.id is null or m.patient_id is distinct from e.patient_id;

  if inconsistent_count > 0 then
    raise exception 'Medication event repair stopped: % inconsistent event/schedule/patient relationships', inconsistent_count
      using errcode = '23514',
            hint = 'Run supabase/scripts/medication_event_validation.sql as a trusted operator. Review reported IDs; do not automatically rewrite clinical records.';
  end if;
end;
$$;

-- medication_schedules does not contain patient_id directly; ownership is derived
-- through patient_medications. Enforce event-to-schedule patient integrity via
-- database triggers without adding duplicated denormalized columns.
create function public.check_medication_event_patient_chain() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  schedule_patient uuid;
  new_med_patient uuid;
begin
  if tg_table_name = 'medication_events' then
    select m.patient_id into schedule_patient
    from public.medication_schedules as s
    join public.patient_medications as m on m.id = s.patient_medication_id
    where s.id = new.schedule_id
    for share of s, m;

    if schedule_patient is null or new.patient_id is distinct from schedule_patient then
      raise exception 'Medication event patient mismatch: event patient % does not match schedule patient %', new.patient_id, schedule_patient
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'medication_schedules' then
    if new.patient_medication_id is distinct from old.patient_medication_id then
      select m.patient_id into new_med_patient
      from public.patient_medications as m
      where m.id = new.patient_medication_id
      for share of m;

      if exists (
        select 1 from public.medication_events as e
        where e.schedule_id = old.id and e.patient_id is distinct from new_med_patient
      ) then
        raise exception 'Medication schedule reassignment would invalidate medication event patient ownership'
          using errcode = '23514';
      end if;
    end if;
  elsif tg_table_name = 'patient_medications' then
    if new.patient_id is distinct from old.patient_id then
      if exists (
        select 1 from public.medication_schedules as s
        join public.medication_events as e on e.schedule_id = s.id
        where s.patient_medication_id = old.id and e.patient_id is distinct from new.patient_id
      ) then
        raise exception 'Patient medication reassignment would invalidate medication event patient ownership'
          using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.check_medication_event_patient_chain() from public, anon, authenticated;

create trigger medication_events_parent_chain
  before insert or update of schedule_id, patient_id
  on public.medication_events
  for each row execute function public.check_medication_event_patient_chain();

create trigger medication_schedules_parent_guard
  before update of patient_medication_id
  on public.medication_schedules
  for each row execute function public.check_medication_event_patient_chain();

create trigger patient_medications_parent_guard
  before update of patient_id
  on public.patient_medications
  for each row execute function public.check_medication_event_patient_chain();

commit;
