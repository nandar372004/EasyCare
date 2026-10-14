-- READ ONLY. Run with trusted full-table visibility; ordinary RLS could conceal
-- inconsistencies. Identifiers only. First result set must be empty to migrate.
select follow_up.id as follow_up_id, follow_up.patient_id,
       follow_up.encounter_id, encounter.patient_id as encounter_patient_id,
       encounter.appointment_id, appointment.patient_id as appointment_patient_id
from public.follow_ups as follow_up
left join public.patients as patient on patient.id = follow_up.patient_id
left join public.care_encounters as encounter on encounter.id = follow_up.encounter_id
left join public.appointments as appointment on appointment.id = encounter.appointment_id
where patient.id is null or encounter.id is null or appointment.id is null
   or follow_up.patient_id is distinct from encounter.patient_id
   or encounter.patient_id is distinct from appointment.patient_id
order by follow_up.id;

-- Suspicious assignment report, NOT proof of malicious intent or grounds for
-- deletion. Historical patient-assigned reminders may be legitimate read-only
-- records. Missing clinical/coordinator links need review; never silently fix.
select follow_up.id as follow_up_id, follow_up.patient_id,
       follow_up.assigned_to_profile_id, assignee.role as assignee_role,
       case when assignee.id is null then 'missing_assignee_profile'
            when assignee.role not in ('doctor','nurse','caregiver','coordinator','main_admin')
              then 'non_staff_assignment_cannot_authorize_management'
            else 'no_current_trusted_staff_patient_link' end as review_reason
from public.follow_ups as follow_up
left join public.profiles as assignee on assignee.id = follow_up.assigned_to_profile_id
where follow_up.assigned_to_profile_id is not null and (
  assignee.id is null
  or assignee.role not in ('doctor','nurse','caregiver','coordinator','main_admin')
  or (assignee.role in ('doctor','nurse','caregiver') and not exists (
    select 1 from public.providers as provider
    where provider.profile_id = assignee.id and provider.verification_status = 'verified'
      and (exists (select 1 from public.appointments as appointment
                   where appointment.provider_id = provider.id and appointment.patient_id = follow_up.patient_id)
        or exists (select 1 from public.care_assignments as assignment
                   join public.care_requests as request on request.id = assignment.care_request_id
                   where assignment.provider_id = provider.id and request.patient_id = follow_up.patient_id
                     and assignment.status in ('assigned','accepted')))
  ))
  or (assignee.role = 'coordinator' and not exists (
    select 1 from public.care_coordinators as coordinator
    where coordinator.profile_id = assignee.id
      and (exists (select 1 from public.patients as patient
                   where patient.id = follow_up.patient_id and patient.primary_coordinator_id = coordinator.id)
        or exists (select 1 from public.care_requests as request
                   where request.patient_id = follow_up.patient_id and request.coordinator_id = coordinator.id))
  ))
)
order by follow_up.id;
