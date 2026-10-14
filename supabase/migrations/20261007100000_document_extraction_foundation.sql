begin;
set local lock_timeout = '10s';

-- Extracted content remains source-derived candidate intelligence. It is never
-- copied into diagnoses, medications, prescriptions, or Care Plan records.
create table public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  clinical_document_id uuid not null references public.clinical_documents(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  requested_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending','processing','completed','failed','needs_review')),
  document_type text,
  summary text,
  model_provider text,
  model_name text,
  model_version text,
  prompt_version text,
  schema_version text,
  started_at timestamptz,
  completed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint document_extractions_document_type_check check (
    document_type is null or document_type in (
      'discharge_summary','lab_report','prescription','procedure_report',
      'imaging_report','medical_certificate','other'
    )
  ),
  constraint document_extractions_summary_check check (summary is null or length(btrim(summary)) between 1 and 3000),
  constraint document_extractions_provider_check check (model_provider is null or length(btrim(model_provider)) between 1 and 120),
  constraint document_extractions_model_check check (model_name is null or length(btrim(model_name)) between 1 and 160),
  constraint document_extractions_model_version_check check (model_version is null or length(btrim(model_version)) between 1 and 160),
  constraint document_extractions_prompt_version_check check (prompt_version is null or length(btrim(prompt_version)) between 1 and 120),
  constraint document_extractions_schema_version_check check (schema_version is null or length(btrim(schema_version)) between 1 and 120),
  constraint document_extractions_failure_check check (failure_reason is null or length(btrim(failure_reason)) between 1 and 500),
  constraint document_extractions_time_check check (
    isfinite(created_at) and isfinite(updated_at)
    and (started_at is null or isfinite(started_at))
    and (completed_at is null or isfinite(completed_at))
    and (started_at is null or completed_at is null or completed_at >= started_at)
  ),
  constraint document_extractions_status_shape_check check (
    (extraction_status = 'pending' and started_at is null and completed_at is null and failure_reason is null)
    or (extraction_status = 'processing' and started_at is not null and completed_at is null and failure_reason is null)
    or (extraction_status = 'completed' and started_at is not null and completed_at is not null and failure_reason is null)
    or (extraction_status = 'needs_review' and started_at is not null and completed_at is not null and failure_reason is null)
    or (extraction_status = 'failed' and started_at is not null and completed_at is not null and failure_reason is not null)
  ),
  constraint document_extractions_id_document_patient_key unique (id, clinical_document_id, patient_id)
);

create index document_extractions_patient_created_idx
  on public.document_extractions(patient_id, created_at desc, id);
create index document_extractions_document_created_idx
  on public.document_extractions(clinical_document_id, created_at desc, id);
create unique index document_extractions_one_active_run_uidx
  on public.document_extractions(clinical_document_id)
  where extraction_status in ('pending','processing');

create trigger document_extractions_updated_at
  before update on public.document_extractions
  for each row execute function public.set_updated_at();

create table public.document_extracted_facts (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null,
  clinical_document_id uuid not null references public.clinical_documents(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  fact_type text not null
    check (fact_type in ('lab_result','medication_candidate','condition_candidate','allergy_candidate','vital_candidate','other')),
  name text not null check (length(btrim(name)) between 1 and 200),
  value_text text,
  value_numeric numeric,
  unit text,
  reference_range_text text,
  observed_at date,
  document_date date,
  source_page integer,
  source_section text,
  source_excerpt text,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  review_status text not null default 'needs_review'
    check (review_status in ('needs_review','reviewed','rejected')),
  explanation text not null check (length(btrim(explanation)) between 1 and 1000),
  created_at timestamptz not null default statement_timestamp(),
  constraint document_extracted_facts_extraction_source_fk
    foreign key (extraction_id, clinical_document_id, patient_id)
    references public.document_extractions(id, clinical_document_id, patient_id) on delete restrict,
  constraint document_extracted_facts_value_check check (nullif(btrim(value_text), '') is not null or value_numeric is not null),
  constraint document_extracted_facts_unit_check check (unit is null or length(btrim(unit)) between 1 and 80),
  constraint document_extracted_facts_reference_check check (reference_range_text is null or length(btrim(reference_range_text)) between 1 and 240),
  constraint document_extracted_facts_locator_check check (
    (source_page is null or source_page > 0)
    and (source_section is null or length(btrim(source_section)) between 1 and 200)
    and (source_excerpt is null or length(btrim(source_excerpt)) between 1 and 1600)
    and (source_page is not null or nullif(btrim(source_section), '') is not null or nullif(btrim(source_excerpt), '') is not null)
  ),
  constraint document_extracted_facts_dates_check check (
    (observed_at is null or isfinite(observed_at))
    and (document_date is null or isfinite(document_date))
    and isfinite(created_at)
  )
);

create index document_extracted_facts_patient_created_idx
  on public.document_extracted_facts(patient_id, created_at desc, id);
create index document_extracted_facts_extraction_idx
  on public.document_extracted_facts(extraction_id, created_at, id);
create index document_extracted_facts_document_idx
  on public.document_extracted_facts(clinical_document_id, source_page, id);

alter table public.document_extractions enable row level security;
alter table public.document_extracted_facts enable row level security;

create policy document_extractions_authorized_read
  on public.document_extractions for select to authenticated
  using (
    public.can_access_patient(patient_id, 'clinical')
    and exists (
      select 1 from public.clinical_documents document
      where document.id = document_extractions.clinical_document_id
        and document.patient_id = document_extractions.patient_id
        and document.status = 'active'
    )
  );

create policy document_extracted_facts_authorized_read
  on public.document_extracted_facts for select to authenticated
  using (
    public.can_access_patient(patient_id, 'clinical')
    and exists (
      select 1
      from public.document_extractions extraction
      join public.clinical_documents document
        on document.id = extraction.clinical_document_id
       and document.patient_id = extraction.patient_id
      where extraction.id = document_extracted_facts.extraction_id
        and extraction.clinical_document_id = document_extracted_facts.clinical_document_id
        and extraction.patient_id = document_extracted_facts.patient_id
        and document.status = 'active'
    )
  );

revoke all on public.document_extractions, public.document_extracted_facts from public, anon, authenticated;
grant select on public.document_extractions, public.document_extracted_facts to authenticated;
grant select, insert, update on public.document_extractions, public.document_extracted_facts to service_role;

-- The request boundary accepts only a document identifier. Patient identity,
-- role, active status, document ownership and clinical access come from auth.uid().
create function public.request_my_document_extraction(p_clinical_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  patient_row public.patients%rowtype;
  document_row public.clinical_documents%rowtype;
  extraction_id uuid;
begin
  if caller is null or p_clinical_document_id is null then
    raise exception 'Active patient session required' using errcode = '42501';
  end if;

  select patient.* into patient_row
  from public.patients patient
  join public.profiles profile on profile.id = patient.profile_id
  where patient.auth_user_id = caller
    and patient.profile_id = caller
    and patient.status = 'active'
    and profile.role = 'patient'
    and profile.status = 'active';
  if not found then
    raise exception 'Active patient identity unavailable' using errcode = '42501';
  end if;

  select document.* into document_row
  from public.clinical_documents document
  where document.id = p_clinical_document_id
    and document.patient_id = patient_row.id
    and document.status = 'active'
    and document.storage_bucket in ('clinical-documents','medical-documents')
    and public.can_access_patient(document.patient_id, 'clinical')
    and exists (
      select 1 from storage.objects object
      where object.bucket_id = document.storage_bucket
        and object.name = document.storage_path
    );
  if not found then
    raise exception 'Active authorized document unavailable' using errcode = '42501';
  end if;

  insert into public.document_extractions(clinical_document_id, patient_id, requested_by_profile_id)
  values (document_row.id, patient_row.id, caller)
  on conflict (clinical_document_id) where extraction_status in ('pending','processing') do nothing
  returning id into extraction_id;

  if extraction_id is null then
    select extraction.id into extraction_id
    from public.document_extractions extraction
    where extraction.clinical_document_id = document_row.id
      and extraction.extraction_status in ('pending','processing')
    order by extraction.created_at desc, extraction.id
    limit 1;
  end if;
  if extraction_id is null then
    raise exception 'Extraction request unavailable' using errcode = '40001';
  end if;
  return extraction_id;
end;
$$;

revoke all on function public.request_my_document_extraction(uuid) from public, anon;
grant execute on function public.request_my_document_extraction(uuid) to authenticated;

comment on table public.document_extractions is
  'Source-aware extraction runs. Outputs are candidate intelligence and are never authoritative clinical truth.';
comment on table public.document_extracted_facts is
  'Document-derived candidate facts with document, patient, extraction-run and source-locator provenance; review does not promote facts into clinical tables.';
comment on function public.request_my_document_extraction(uuid) is
  'Creates or returns a pending extraction run only for the authenticated active patient’s own active authorized document. Does not invoke an AI model.';

commit;
