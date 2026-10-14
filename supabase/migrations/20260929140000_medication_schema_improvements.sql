begin;
set local lock_timeout = '10s';

alter table public.patient_medications
  add column if not exists prescribing_provider_id uuid references public.providers(id) on delete restrict,
  add column if not exists reason_for_medication text,
  add column if not exists discontinued_at timestamptz,
  add column if not exists discontinued_reason text;

-- Nullable additions preserve historical records without inventing a prescriber
-- or discontinuation date. Existing discontinued records may remain undated.
alter table public.patient_medications
  add constraint patient_medications_reason_check check (reason_for_medication is null or length(btrim(reason_for_medication)) > 0),
  add constraint patient_medications_discontinued_reason_check check (discontinued_reason is null or length(btrim(discontinued_reason)) > 0),
  add constraint patient_medications_discontinued_at_check check (discontinued_at is null or (isfinite(discontinued_at) and status = 'discontinued')),
  add constraint patient_medications_discontinued_status_check check (discontinued_reason is null or status = 'discontinued');

create index patient_medications_patient_status_idx on public.patient_medications(patient_id, status);
create index patient_medications_prescriber_idx on public.patient_medications(prescribing_provider_id)
  where prescribing_provider_id is not null;
create index medication_schedules_medication_idx on public.medication_schedules(patient_medication_id);
create index medication_events_schedule_idx on public.medication_events(schedule_id);
-- Existing medication_events(patient_id, scheduled_at) serves daily/history queries.
grant select (prescribing_provider_id, reason_for_medication, discontinued_at, discontinued_reason)
  on public.patient_medications to authenticated;
grant select on public.medication_events to authenticated;

-- Keep existing read RLS, including authorized family/clinical event reads.
-- No direct browser mutation grants or policies are added. This function is the
-- only new patient write surface; IDs, schedule and confirmation cannot be spoofed.
create function public.record_medication_event_status(
  target_event_id uuid, new_status public.medication_event_status
) returns public.medication_events
language plpgsql security definer set search_path = ''
as $$
declare
  result public.medication_events;
begin
  if auth.uid() is null or new_status is null or new_status not in ('taken', 'skipped') then
    raise exception 'Only authenticated taken/skipped confirmations are allowed' using errcode = '42501';
  end if;
  update public.medication_events e
  set status = new_status, confirmed_by_profile_id = auth.uid(), confirmed_at = statement_timestamp()
  where e.id = target_event_id and exists (
    select 1 from public.patients p
    join public.patient_medications m on m.patient_id = p.id
    join public.medication_schedules s on s.patient_medication_id = m.id
    where p.id = e.patient_id and p.profile_id = auth.uid() and s.id = e.schedule_id
  ) returning e.* into result;
  if not found then
    raise exception 'Medication event unavailable' using errcode = '42501';
  end if;
  return result;
end;
$$;
revoke all on function public.record_medication_event_status(uuid, public.medication_event_status) from public, anon;
grant execute on function public.record_medication_event_status(uuid, public.medication_event_status) to authenticated;
comment on function public.record_medication_event_status(uuid, public.medication_event_status) is
  'Patient self-confirmation of an existing event as taken/skipped. Trusted scheduling code creates events. Corrections replace the current confirmation; events are not an immutable audit log.';
commit;
