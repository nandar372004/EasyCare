begin;
set local lock_timeout = '10s';

-- Step 3 adds structured candidate detail to the Step 1 fact table. These are
-- still review-only source-derived candidates, not authoritative health data.
alter table public.document_extracted_facts
  drop constraint document_extracted_facts_fact_type_check,
  drop constraint document_extracted_facts_value_check,
  drop constraint document_extracted_facts_review_status_check,
  add column observed_at_time timestamptz,
  add column abnormal_flag boolean,
  add column strength_text text,
  add column form_text text,
  add column frequency_text text,
  add column instruction_text text,
  add column recommended_at date,
  add column source_context text,
  add constraint document_extracted_facts_fact_type_check check (fact_type in (
    'lab_result','medication_candidate','condition_candidate','allergy_candidate',
    'vital_candidate','procedure_candidate','follow_up_candidate','other'
  )),
  add constraint document_extracted_facts_value_check check (
    nullif(btrim(value_text), '') is not null or value_numeric is not null
    or fact_type in ('medication_candidate','condition_candidate','allergy_candidate','procedure_candidate','follow_up_candidate','other')
  ),
  add constraint document_extracted_facts_review_status_check check (
    review_status in ('needs_review','reviewed','confirmed','rejected')
  ),
  add constraint document_extracted_facts_structured_text_check check (
    (strength_text is null or length(btrim(strength_text)) between 1 and 120)
    and (form_text is null or length(btrim(form_text)) between 1 and 120)
    and (frequency_text is null or length(btrim(frequency_text)) between 1 and 200)
    and (instruction_text is null or length(btrim(instruction_text)) between 1 and 1000)
    and (source_context is null or length(btrim(source_context)) between 1 and 1000)
    and (observed_at_time is null or isfinite(observed_at_time))
    and (recommended_at is null or isfinite(recommended_at))
  );

-- Candidate-level idempotency only. Facts from different documents/runs never merge.
create unique index document_extracted_facts_source_dedupe_uidx
  on public.document_extracted_facts (
    extraction_id, fact_type, lower(btrim(name)), coalesce(source_page, 0),
    coalesce(lower(btrim(source_section)), ''), coalesce(lower(btrim(source_excerpt)), '')
  );

create function public.record_document_extracted_facts(
  p_extraction_id uuid,
  p_summary text,
  p_candidate_facts jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.document_extractions%rowtype;
  source public.clinical_documents%rowtype;
  item jsonb;
  locator jsonb;
  inserted_count integer := 0;
  affected_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Trusted extraction worker required' using errcode = '42501';
  end if;
  if p_extraction_id is null or p_summary is null or length(btrim(p_summary)) not between 1 and 3000
    or jsonb_typeof(p_candidate_facts) is distinct from 'array' or jsonb_array_length(p_candidate_facts) > 100 then
    raise exception 'Invalid structured extraction payload' using errcode = '23514';
  end if;

  select * into run from public.document_extractions
  where id = p_extraction_id for update;
  if not found or run.extraction_status <> 'needs_review' or run.classified_at is null then
    raise exception 'Classified extraction run unavailable' using errcode = '42501';
  end if;

  select document.* into source from public.clinical_documents document
  where document.id = run.clinical_document_id and document.patient_id = run.patient_id
    and document.source = 'patient_upload' and document.status = 'active'
    and document.storage_bucket = 'medical-documents'
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

  for item in select value from jsonb_array_elements(p_candidate_facts)
  loop
    if jsonb_typeof(item) <> 'object' or (select count(*) from jsonb_object_keys(item)) <> 19
      or not (item ?& array[
        'factType','name','valueText','valueNumeric','unit','referenceRangeText','observedAt',
        'observedAtTime','abnormalFlag','strengthText','formText','frequencyText','instructionText',
        'recommendedAt','sourceContext','sourceLocator','confidence','reviewRequired','explanation'
      ])
      or jsonb_typeof(item->'factType') is distinct from 'string'
      or item->>'factType' not in ('lab_result','medication_candidate','condition_candidate','allergy_candidate','vital_candidate','procedure_candidate','follow_up_candidate','other')
      or nullif(btrim(item->>'name'), '') is null or length(btrim(item->>'name')) > 200
      or jsonb_typeof(item->'reviewRequired') is distinct from 'boolean' or item->>'reviewRequired' <> 'true'
      or jsonb_typeof(item->'confidence') is distinct from 'number' or (item->>'confidence')::numeric not between 0 and 1
      or nullif(btrim(item->>'explanation'), '') is null or length(btrim(item->>'explanation')) > 1000
      or jsonb_typeof(item->'sourceLocator') is distinct from 'object'
      or (select count(*) from jsonb_object_keys(item->'sourceLocator')) <> 3
      or not (item->'sourceLocator' ?& array['page','section','excerpt'])
      or nullif(btrim(item->'sourceLocator'->>'excerpt'), '') is null
      or length(btrim(item->'sourceLocator'->>'excerpt')) > 1600 then
      raise exception 'Invalid structured candidate fact' using errcode = '23514';
    end if;
    locator := item->'sourceLocator';
    if nullif(locator->>'page','') is not null and (locator->>'page')::integer < 1 then
      raise exception 'Invalid source page locator' using errcode = '23514';
    end if;

    insert into public.document_extracted_facts (
      extraction_id, clinical_document_id, patient_id, fact_type, name, value_text, value_numeric,
      unit, reference_range_text, observed_at, observed_at_time, abnormal_flag, strength_text,
      form_text, frequency_text, instruction_text, recommended_at, source_context,
      source_page, source_section, source_excerpt, confidence, review_status, explanation
    ) values (
      run.id, run.clinical_document_id, run.patient_id, item->>'factType', btrim(item->>'name'),
      nullif(btrim(item->>'valueText'), ''), nullif(item->>'valueNumeric','')::numeric,
      nullif(btrim(item->>'unit'), ''), nullif(btrim(item->>'referenceRangeText'), ''),
      nullif(item->>'observedAt','')::date, nullif(item->>'observedAtTime','')::timestamptz,
      nullif(item->>'abnormalFlag','')::boolean, nullif(btrim(item->>'strengthText'), ''),
      nullif(btrim(item->>'formText'), ''), nullif(btrim(item->>'frequencyText'), ''),
      nullif(btrim(item->>'instructionText'), ''), nullif(item->>'recommendedAt','')::date,
      nullif(btrim(item->>'sourceContext'), ''), nullif(locator->>'page','')::integer,
      nullif(btrim(locator->>'section'), ''), btrim(locator->>'excerpt'),
      (item->>'confidence')::numeric, 'needs_review', btrim(item->>'explanation')
    ) on conflict do nothing;
    get diagnostics affected_count = row_count;
    inserted_count := inserted_count + affected_count;
  end loop;

  update public.document_extractions set summary = btrim(p_summary) where id = run.id;
  return inserted_count;
end;
$$;

revoke all on function public.record_document_extracted_facts(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_document_extracted_facts(uuid,text,jsonb) to service_role;
comment on function public.record_document_extracted_facts(uuid,text,jsonb) is
  'Trusted server-only persistence boundary for source-located candidate facts. Always stores needs_review and never writes authoritative clinical records.';
comment on column public.document_extracted_facts.abnormal_flag is
  'Source-reported abnormal flag only; null when the source does not explicitly mark abnormality.';
comment on column public.document_extracted_facts.review_status is
  'Candidate review state. Extraction persistence always sets needs_review; only a later authorized human review flow may confirm or reject.';

commit;
