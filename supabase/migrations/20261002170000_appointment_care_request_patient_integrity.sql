begin;
set local lock_timeout = '10s';

-- Lock parent and child booking tables in share row exclusive mode so the
-- preflight cannot race with concurrent booking writes.
lock table public.appointments, public.care_requests in share row exclusive mode;

do $$
declare inconsistent_count bigint;
begin
  select count(*) into inconsistent_count
  from public.appointments as a
  left join public.care_requests as r on r.id = a.care_request_id
  where a.care_request_id is not null
    and (r.id is null or r.patient_id is distinct from a.patient_id);

  if inconsistent_count > 0 then
    raise exception 'Appointment repair stopped: % appointment/care-request patient relationships are inconsistent', inconsistent_count
      using errcode = '23514',
            hint = 'Run supabase/scripts/appointment_care_request_validation.sql as a trusted operator. Review reported IDs; do not automatically rewrite clinical records.';
  end if;
end;
$$;

-- care_requests carries patient_id directly, so a declarative composite
-- relationship is appropriate and requires no duplicated ownership column.
alter table public.care_requests
  add constraint care_requests_id_patient_key unique (id, patient_id);

-- Default MATCH SIMPLE: appointments with care_request_id NULL stay valid, so
-- direct doctor/patient booking without a care request is preserved unchanged.
alter table public.appointments
  add constraint appointments_care_request_patient_fk
  foreign key (care_request_id, patient_id)
  references public.care_requests (id, patient_id)
  on update restrict on delete restrict;

-- Enforced on appointments INSERT and UPDATE and on care_requests ownership
-- updates (ON UPDATE RESTRICT), for service-role and direct SQL writes alike.
-- Repair 5's appointments_id_patient_key and care_encounters FK are unchanged.
comment on constraint appointments_care_request_patient_fk on public.appointments is
  'An appointment referencing a care request must belong to the same patient. NULL care_request_id remains a supported standalone booking.';
commit;