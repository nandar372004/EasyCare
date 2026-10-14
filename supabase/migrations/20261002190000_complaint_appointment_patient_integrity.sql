begin;
set local lock_timeout = '10s';

-- Lock parent and child governance tables so the preflight cannot race with
-- concurrent complaint submission.
lock table public.complaints, public.appointments in share row exclusive mode;

do $$
declare inconsistent_count bigint;
begin
  select count(*) into inconsistent_count
  from public.complaints as c
  left join public.appointments as a on a.id = c.appointment_id
  where c.appointment_id is not null
    and (a.id is null or c.patient_id is distinct from a.patient_id);

  if inconsistent_count > 0 then
    raise exception 'Complaint repair stopped: % complaint/appointment patient relationships are inconsistent', inconsistent_count
      using errcode = '23514',
            hint = 'Run supabase/scripts/complaint_appointment_validation.sql as a trusted operator. Review reported IDs; do not automatically rewrite complaint history.';
  end if;
end;
$$;

-- complaints carries patient_id directly, so the relationship is expressible
-- declaratively. Repair 5's appointments_id_patient_key is reused as the target,
-- so no additional unique constraint or index is created.
--
-- Default MATCH SIMPLE keeps standalone complaints valid: a NULL appointment_id
-- (a general complaint) or a NULL patient_id is not checked by the foreign key,
-- and complaints.patient_id stays nullable.
alter table public.complaints
  add constraint complaints_appointment_patient_fk
  foreign key (appointment_id, patient_id)
  references public.appointments (id, patient_id)
  on update restrict on delete restrict;

-- The foreign key above cannot cover parent mutation for a standalone appointment:
-- with care_request_id NULL, MATCH SIMPLE skips Repair 13's composite FK, so an
-- appointment could still be re-parented to another patient and orphan its
-- complaint link. Guard that remaining path explicitly.
create function public.check_complaint_appointment_patient_chain() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.patient_id is distinct from old.patient_id
     and exists (
       select 1 from public.complaints as c
       where c.appointment_id = old.id
         and c.patient_id is not null
         and c.patient_id is distinct from new.patient_id
     ) then
    raise exception 'Appointment patient reassignment would invalidate complaint patient ownership'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.check_complaint_appointment_patient_chain() from public, anon, authenticated;

create trigger appointments_complaint_guard
  before update of patient_id
  on public.appointments
  for each row execute function public.check_complaint_appointment_patient_chain();

comment on constraint complaints_appointment_patient_fk on public.complaints is
  'A complaint linked to an appointment must belong to that appointment''s patient. NULL appointment_id keeps standalone complaints supported.';
commit;