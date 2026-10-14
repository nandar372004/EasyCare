begin;
set local lock_timeout = '10s';

-- Lock the whole coordinator chain so the preflight cannot race with concurrent
-- matching/booking writes.
lock table public.care_assignments, public.care_requests, public.appointments
  in share row exclusive mode;

do $$
declare inconsistent_count bigint;
begin
  select count(*) into inconsistent_count
  from public.care_assignments as a
  left join public.care_requests as r on r.id = a.care_request_id
  left join public.appointments as p on p.id = a.appointment_id
  where a.appointment_id is not null
    and (r.id is null or p.id is null or r.patient_id is distinct from p.patient_id);

  if inconsistent_count > 0 then
    raise exception 'Care assignment repair stopped: % assignment/appointment patient relationships are inconsistent', inconsistent_count
      using errcode = '23514',
            hint = 'Run supabase/scripts/care_assignment_validation.sql as a trusted operator. Review reported IDs; do not automatically rewrite clinical records.';
  end if;
end;
$$;

-- care_assignments carries no patient_id and the invariant is same-patient ownership,
-- not a shared care_request identity: a coordinator matches a provider to a care request
-- first and links the appointment afterwards, and appointments are normally created
-- standalone with a NULL care_request_id. A composite foreign key could only express
-- the stricter identity rule, which would break that workflow, so chain ownership is
-- validated in the database without denormalizing patient_id onto the child.
create function public.check_care_assignment_patient_chain() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  request_patient uuid;
  appointment_patient uuid;
begin
  if tg_table_name = 'care_assignments' then
    if new.appointment_id is null then
      -- Assignments legitimately exist before an appointment is created.
      return new;
    end if;

    select r.patient_id into request_patient
    from public.care_requests as r
    where r.id = new.care_request_id
    for share;

    select p.patient_id into appointment_patient
    from public.appointments as p
    where p.id = new.appointment_id
    for share;

    if request_patient is null or appointment_patient is null
       or request_patient is distinct from appointment_patient then
      raise exception 'Care assignment patient mismatch: assignment care request patient % does not match appointment patient %',
        request_patient, appointment_patient
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'care_requests' then
    if new.patient_id is distinct from old.patient_id
       and exists (
         select 1
         from public.care_assignments as a
         join public.appointments as p on p.id = a.appointment_id
         where a.care_request_id = old.id and p.patient_id is distinct from new.patient_id
       ) then
      raise exception 'Care request reassignment would invalidate care assignment patient ownership'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'appointments' then
    if new.patient_id is distinct from old.patient_id
       and exists (
         select 1
         from public.care_assignments as a
         join public.care_requests as r on r.id = a.care_request_id
         where a.appointment_id = old.id and r.patient_id is distinct from new.patient_id
       ) then
      raise exception 'Appointment patient reassignment would invalidate care assignment patient ownership'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.check_care_assignment_patient_chain() from public, anon, authenticated;

create trigger care_assignments_patient_chain
  before insert or update of care_request_id, appointment_id
  on public.care_assignments
  for each row execute function public.check_care_assignment_patient_chain();

create trigger care_requests_assignment_guard
  before update of patient_id
  on public.care_requests
  for each row execute function public.check_care_assignment_patient_chain();

create trigger appointments_assignment_guard
  before update of patient_id
  on public.appointments
  for each row execute function public.check_care_assignment_patient_chain();

comment on function public.check_care_assignment_patient_chain() is
  'A care assignment linked to an appointment must resolve to the same patient through care_requests.patient_id and appointments.patient_id. Enforced for every role including service_role; NULL appointment_id stays supported.';
commit;