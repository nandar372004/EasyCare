begin;
set local lock_timeout = '10s';

-- Separate patient-facing explanation from the original extraction explanation.
-- This remains attached to a candidate fact and is never canonical clinical truth.
alter table public.document_extracted_facts
  add column plain_language_explanation jsonb;

create function public.save_my_document_fact_explanation(
  p_fact_id uuid,
  p_owner_profile_id uuid,
  p_explanation_fields jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  fact public.document_extracted_facts%rowtype;
  document public.clinical_documents%rowtype;
  extraction public.document_extractions%rowtype;
  patient public.patients%rowtype;
  profile public.profiles%rowtype;
  explanation_payload jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Trusted explanation worker required' using errcode = '42501';
  end if;
  if p_fact_id is null or p_owner_profile_id is null
    or jsonb_typeof(p_explanation_fields) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_explanation_fields)) <> 6
    or not (p_explanation_fields ?& array[
      'simple_title','short_summary','plain_language_explanation',
      'why_it_may_matter','review_message','uncertainty_note'
    ]) then
    raise exception 'Invalid explanation payload' using errcode = '23514';
  end if;
  if nullif(btrim(p_explanation_fields->>'simple_title'), '') is null or length(p_explanation_fields->>'simple_title') > 120
    or nullif(btrim(p_explanation_fields->>'short_summary'), '') is null or length(p_explanation_fields->>'short_summary') > 240
    or nullif(btrim(p_explanation_fields->>'plain_language_explanation'), '') is null or length(p_explanation_fields->>'plain_language_explanation') > 1000
    or nullif(btrim(p_explanation_fields->>'why_it_may_matter'), '') is null or length(p_explanation_fields->>'why_it_may_matter') > 400
    or nullif(btrim(p_explanation_fields->>'review_message'), '') is null or length(p_explanation_fields->>'review_message') > 200
    or nullif(btrim(p_explanation_fields->>'uncertainty_note'), '') is null or length(p_explanation_fields->>'uncertainty_note') > 400 then
    raise exception 'Invalid explanation field' using errcode = '23514';
  end if;

  select candidate.* into fact from public.document_extracted_facts candidate
  where candidate.id = p_fact_id and candidate.patient_id is not null
    and candidate.review_status in ('needs_review','confirmed')
  for update;
  if not found then
    raise exception 'Explainable candidate unavailable' using errcode = '42501';
  end if;
  select source.* into document from public.clinical_documents source
  where source.id = fact.clinical_document_id and source.patient_id = fact.patient_id
    and source.status = 'active' and source.source = 'patient_upload'
    and source.storage_bucket = 'medical-documents'
  for share;
  if not found then
    raise exception 'Active source document unavailable' using errcode = '42501';
  end if;
  select run.* into extraction from public.document_extractions run
  where run.id = fact.extraction_id and run.clinical_document_id = fact.clinical_document_id
    and run.patient_id = fact.patient_id and run.requested_by_profile_id = p_owner_profile_id
  for share;
  if not found then
    raise exception 'Source extraction unavailable' using errcode = '42501';
  end if;
  select owner.* into patient from public.patients owner
  where owner.id = fact.patient_id and owner.auth_user_id = p_owner_profile_id
    and owner.profile_id = p_owner_profile_id and owner.status = 'active'
  for share;
  if not found then
    raise exception 'Active patient identity unavailable' using errcode = '42501';
  end if;
  select owner_profile.* into profile from public.profiles owner_profile
  where owner_profile.id = p_owner_profile_id and owner_profile.role = 'patient' and owner_profile.status = 'active'
  for share;
  if not found then
    raise exception 'Active patient profile unavailable' using errcode = '42501';
  end if;
  perform 1 from storage.objects object
  where object.bucket_id = document.storage_bucket and object.name = document.storage_path
  for share;
  if not found then
    raise exception 'Source file unavailable' using errcode = '42501';
  end if;

  explanation_payload := p_explanation_fields || jsonb_build_object(
    'source_reference', jsonb_build_object(
      'fact_id', fact.id,
      'extraction_id', fact.extraction_id,
      'source_document_id', fact.clinical_document_id,
      'source_page', fact.source_page,
      'source_section', fact.source_section,
      'source_excerpt', fact.source_excerpt,
      'confidence', fact.confidence,
      'confidence_band', fact.confidence_band,
      'review_state', fact.review_status,
      'information_origin', 'Source-derived explanation of an AI-extracted candidate; not clinician-confirmed.'
    )
  );
  update public.document_extracted_facts
  set plain_language_explanation = explanation_payload
  where id = fact.id and review_status in ('needs_review','confirmed');
  return jsonb_build_object('fact_id', fact.id, 'explanation', explanation_payload);
end;
$$;

create function public.sync_document_fact_explanation_review_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.review_status = 'rejected' then
    new.plain_language_explanation := null;
  elsif new.plain_language_explanation is not null and new.review_status is distinct from old.review_status then
    new.plain_language_explanation := jsonb_set(
      jsonb_set(new.plain_language_explanation, '{source_reference,review_state}', to_jsonb(new.review_status), true),
      '{review_message}',
      to_jsonb(case when new.review_status = 'confirmed'
        then 'This item was patient-reviewed and confirmed. This is not clinician confirmation.'
        else 'AI extracted this from your document. Please review it.' end),
      true
    );
  end if;
  return new;
end;
$$;

create trigger document_extracted_facts_explanation_review_sync
before update of review_status on public.document_extracted_facts
for each row execute function public.sync_document_fact_explanation_review_state();

revoke all on function public.save_my_document_fact_explanation(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_my_document_fact_explanation(uuid,uuid,jsonb) to service_role;
revoke all on function public.sync_document_fact_explanation_review_state() from public, anon, authenticated, service_role;

comment on column public.document_extracted_facts.plain_language_explanation is
  'Optional patient-facing, source-derived explanation contract. Never a diagnosis, clinician confirmation, or canonical clinical truth; cleared when rejected.';
comment on function public.save_my_document_fact_explanation(uuid,uuid,jsonb) is
  'Trusted server-only persistence boundary for a patient-owned active candidate explanation; provenance is read from linked rows and cannot be supplied by the browser.';

commit;
