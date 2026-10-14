begin;
set local lock_timeout = '10s';

-- Confidence bands are explanatory metadata, never medical certainty.
alter table public.document_extracted_facts
  add column confidence_band text generated always as (
    case when confidence >= 0.85 then 'high'
         when confidence >= 0.60 then 'medium'
         else 'low' end
  ) stored,
  add column reviewed_by_profile_id uuid references public.profiles(id) on delete restrict,
  add column reviewed_at timestamptz,
  add column review_note text,
  add constraint document_extracted_facts_review_shape_check check (
    (review_status = 'needs_review' and reviewed_by_profile_id is null and reviewed_at is null and review_note is null)
    or (review_status in ('confirmed','rejected') and reviewed_by_profile_id is not null
      and reviewed_at is not null and isfinite(reviewed_at)
      and (review_note is null or length(btrim(review_note)) between 1 and 1000))
    or (review_status = 'reviewed'
      and ((reviewed_by_profile_id is null and reviewed_at is null)
        or (reviewed_by_profile_id is not null and reviewed_at is not null and isfinite(reviewed_at)))
      and (review_note is null or length(btrim(review_note)) between 1 and 1000))
  );

alter table public.document_extracted_facts
  add constraint document_extracted_facts_id_document_patient_key
  unique (id, clinical_document_id, patient_id);

create table public.document_extracted_fact_reviews (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid not null,
  clinical_document_id uuid not null,
  patient_id uuid not null,
  previous_status text not null check (previous_status = 'needs_review'),
  new_status text not null check (new_status in ('confirmed','rejected')),
  reviewer_profile_id uuid not null references public.profiles(id) on delete restrict,
  reviewed_at timestamptz not null default statement_timestamp() check (isfinite(reviewed_at)),
  review_note text check (review_note is null or length(btrim(review_note)) between 1 and 1000),
  constraint document_extracted_fact_reviews_fact_fk
    foreign key (fact_id, clinical_document_id, patient_id)
    references public.document_extracted_facts(id, clinical_document_id, patient_id) on delete restrict,
  constraint document_extracted_fact_reviews_once unique (fact_id)
);

create index document_extracted_fact_reviews_patient_time_idx
  on public.document_extracted_fact_reviews(patient_id, reviewed_at desc, id);

alter table public.document_extracted_fact_reviews enable row level security;
revoke all on public.document_extracted_fact_reviews from public, anon, authenticated;
grant select, insert on public.document_extracted_fact_reviews to service_role;

create function public.review_my_document_extracted_fact(
  p_fact_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  fact public.document_extracted_facts%rowtype;
  reviewer_profile uuid;
  review_time timestamptz := statement_timestamp();
  clean_note text := nullif(btrim(p_note), '');
begin
  if caller is null or p_fact_id is null then
    raise exception 'Patient review identity required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('confirmed','rejected')
    or (p_note is not null and (clean_note is null or length(clean_note) > 1000)) then
    raise exception 'Invalid candidate review decision' using errcode = '23514';
  end if;

  select candidate.* into fact
  from public.document_extracted_facts candidate
  join public.clinical_documents document
    on document.id = candidate.clinical_document_id and document.patient_id = candidate.patient_id
  join public.patients patient
    on patient.id = candidate.patient_id and patient.auth_user_id = caller and patient.profile_id = caller
  join public.profiles profile
    on profile.id = patient.profile_id and profile.id = caller
  where candidate.id = p_fact_id
    and candidate.review_status = 'needs_review'
    and document.status = 'active'
    and document.source = 'patient_upload'
    and document.storage_bucket = 'medical-documents'
    and patient.status = 'active' and profile.role = 'patient' and profile.status = 'active'
    and exists (
      select 1 from storage.objects object
      where object.bucket_id = document.storage_bucket and object.name = document.storage_path
    )
  for update of candidate, document, patient, profile;
  if not found then
    raise exception 'Reviewable candidate unavailable' using errcode = '42501';
  end if;
  reviewer_profile := caller;

  update public.document_extracted_facts
  set review_status = p_decision,
      reviewed_by_profile_id = reviewer_profile,
      reviewed_at = review_time,
      review_note = clean_note
  where id = fact.id and review_status = 'needs_review';
  if not found then
    raise exception 'Reviewable candidate unavailable' using errcode = '42501';
  end if;

  insert into public.document_extracted_fact_reviews (
    fact_id, clinical_document_id, patient_id, previous_status, new_status,
    reviewer_profile_id, reviewed_at, review_note
  ) values (
    fact.id, fact.clinical_document_id, fact.patient_id, 'needs_review', p_decision,
    reviewer_profile, review_time, clean_note
  );

  return jsonb_build_object(
    'fact_id', fact.id, 'review_status', p_decision,
    'reviewed_at', review_time, 'review_note', clean_note
  );
end;
$$;

revoke all on function public.review_my_document_extracted_fact(uuid,text,text) from public, anon, service_role;
grant execute on function public.review_my_document_extracted_fact(uuid,text,text) to authenticated;

comment on column public.document_extracted_facts.confidence_band is
  'Interpretive extraction score band only: high >= 0.85, medium >= 0.60, low < 0.60. Not medical certainty.';
comment on column public.document_extracted_facts.review_status is
  'Candidate review state only. Patient confirmation does not establish clinician verification or canonical clinical truth.';
comment on function public.review_my_document_extracted_fact(uuid,text,text) is
  'Allows only the authenticated active patient owner to confirm or reject an active source-derived candidate; writes reviewer metadata and an audit row, never canonical clinical truth.';
comment on table public.document_extracted_fact_reviews is
  'Append-only audit trail for patient review decisions on source-derived candidate facts; not a clinical-truth table.';

commit;
