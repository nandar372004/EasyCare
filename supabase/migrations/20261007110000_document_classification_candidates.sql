begin;
set local lock_timeout = '10s';

-- Candidate taxonomy only. clinical_documents document types remain unchanged.
alter table public.document_extractions
  drop constraint document_extractions_document_type_check,
  add constraint document_extractions_document_type_check check (
    document_type is null or document_type in (
      'discharge_summary','lab_report','prescription','procedure_report',
      'imaging_report','medical_certificate','referral','progress_note','other'
    )
  ),
  add column classification_confidence numeric,
  add column classification_review_required boolean not null default true,
  add column classified_at timestamptz,
  add constraint document_extractions_classification_shape_check check (
    classification_review_required
    and (
      (classification_confidence is null and classified_at is null)
      or (classification_confidence is not null and classification_confidence between 0 and 1
        and classified_at is not null and isfinite(classified_at) and document_type is not null)
    )
  );

-- Only trusted server workers can record AI output. Identity and source are
-- derived from the Step 1 ownership-bound run, never from model/browser fields.
create function public.record_document_classification_candidate(
  p_extraction_id uuid,
  p_document_type text,
  p_confidence numeric,
  p_model_provider text,
  p_model_name text,
  p_model_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.document_extractions%rowtype;
  source public.clinical_documents%rowtype;
begin
  if p_document_type is null or p_document_type not in (
    'discharge_summary','lab_report','prescription','procedure_report',
    'imaging_report','medical_certificate','referral','progress_note','other'
  ) or p_confidence is null or not (p_confidence between 0 and 1)
    or p_model_provider is null or length(btrim(p_model_provider)) not between 1 and 120
    or p_model_name is null or length(btrim(p_model_name)) not between 1 and 160
    or p_model_version is null or length(btrim(p_model_version)) not between 1 and 160 then
    raise exception 'Invalid classification candidate' using errcode = '23514';
  end if;

  select * into run from public.document_extractions
  where id = p_extraction_id for update;
  if not found or run.extraction_status <> 'pending' or run.classified_at is not null then
    raise exception 'Pending extraction unavailable' using errcode = '42501';
  end if;
  select document.* into source from public.clinical_documents document
  where document.id = run.clinical_document_id and document.patient_id = run.patient_id
    and document.status = 'active' and document.source = 'patient_upload' and document.storage_bucket = 'medical-documents'
  for share;
  if not found then
    raise exception 'Active source document unavailable' using errcode = '42501';
  end if;

  perform 1 from public.patients patient
    join public.profiles profile on profile.id = patient.profile_id
  where patient.id = run.patient_id and patient.auth_user_id = run.requested_by_profile_id
    and patient.profile_id = run.requested_by_profile_id and patient.status = 'active'
    and profile.role = 'patient' and profile.status = 'active'
  for share of patient, profile;
  if not found then
    raise exception 'Active patient identity unavailable' using errcode = '42501';
  end if;
  perform 1 from storage.objects object
  where object.bucket_id = source.storage_bucket and object.name = source.storage_path
  for share;
  if not found then
    raise exception 'Source file unavailable' using errcode = '42501';
  end if;

  update public.document_extractions
  set document_type = p_document_type,
      classification_confidence = p_confidence,
      classification_review_required = true,
      classified_at = statement_timestamp(),
      extraction_status = 'needs_review',
      started_at = statement_timestamp(),
      completed_at = statement_timestamp(),
      model_provider = btrim(p_model_provider), model_name = btrim(p_model_name),
      model_version = btrim(p_model_version),
      prompt_version = 'document-classification-v1', schema_version = 'document-classification-v1'
  where id = run.id;
  return run.id;
end;
$$;

revoke all on function public.record_document_classification_candidate(uuid,text,numeric,text,text,text)
  from public, anon, authenticated;
grant execute on function public.record_document_classification_candidate(uuid,text,numeric,text,text,text)
  to service_role;

comment on column public.document_extractions.document_type is
  'AI-derived candidate document category; never silently copied to clinical_documents.document_type.';
comment on column public.document_extractions.classification_review_required is
  'Always true for AI-derived classification candidates, including high-confidence classifications.';
comment on function public.record_document_classification_candidate(uuid,text,numeric,text,text,text) is
  'Trusted server boundary for classification only. Writes no candidate facts or authoritative clinical records.';
commit;
