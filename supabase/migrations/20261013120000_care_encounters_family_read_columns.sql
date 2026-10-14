begin;

-- Family Health's scoped Health Records query selects these fields and filters
-- by patient_id. Row visibility remains governed by the existing encounters_read
-- RLS policy and can_access_patient(..., 'clinical') authorization check.
-- Do not grant table-wide SELECT: other encounter fields remain unavailable.
grant select (
  id,
  patient_id,
  encounter_type,
  chief_complaint,
  assessment_summary,
  created_at
) on public.care_encounters to authenticated;

commit;
