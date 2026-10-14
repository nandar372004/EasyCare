begin;
set local lock_timeout = '10s';

-- Keep bilingual content attached to the same candidate explanation object.
-- This replaces only the trusted explanation RPC and its review-state trigger.
create or replace function public.save_my_document_fact_explanation(
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
  legacy_fields text[] := array[
    'simple_title','short_summary','plain_language_explanation',
    'why_it_may_matter','review_message','uncertainty_note'
  ];
  myanmar_fields text[] := array[
    'simple_title_my','short_summary_my','plain_language_explanation_my',
    'why_it_may_matter_my','review_message_my','uncertainty_note_my'
  ];
  field_name text;
  is_legacy_english boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Trusted explanation worker required' using errcode = '42501';
  end if;
  if p_fact_id is null or p_owner_profile_id is null
    or jsonb_typeof(p_explanation_fields) is distinct from 'object' then
    raise exception 'Invalid bilingual explanation payload' using errcode = '23514';
  end if;
  is_legacy_english := (select count(*) from jsonb_object_keys(p_explanation_fields)) = 6
    and p_explanation_fields ?& legacy_fields;
  if is_legacy_english then
    -- Keep already-deployed Phase I workers functional until the bilingual
    -- Edge Function version is deployed. Existing English callers remain valid.
    if nullif(btrim(p_explanation_fields->>'simple_title'), '') is null or length(p_explanation_fields->>'simple_title') > 120
      or nullif(btrim(p_explanation_fields->>'short_summary'), '') is null or length(p_explanation_fields->>'short_summary') > 240
      or nullif(btrim(p_explanation_fields->>'plain_language_explanation'), '') is null or length(p_explanation_fields->>'plain_language_explanation') > 1000
      or nullif(btrim(p_explanation_fields->>'why_it_may_matter'), '') is null or length(p_explanation_fields->>'why_it_may_matter') > 400
      or nullif(btrim(p_explanation_fields->>'review_message'), '') is null or length(p_explanation_fields->>'review_message') > 200
      or nullif(btrim(p_explanation_fields->>'uncertainty_note'), '') is null or length(p_explanation_fields->>'uncertainty_note') > 400 then
      raise exception 'Invalid English explanation field' using errcode = '23514';
    end if;
  else
    if (select count(*) from jsonb_object_keys(p_explanation_fields)) <> 14
      or not (p_explanation_fields ?& array[
        'simple_title_en','simple_title_my','short_summary_en','short_summary_my',
        'plain_language_explanation_en','plain_language_explanation_my',
        'why_it_may_matter_en','why_it_may_matter_my',
        'review_message_en','review_message_my','uncertainty_note_en','uncertainty_note_my',
        'source_assertion','translation_status'
      ]) then
      raise exception 'Invalid bilingual explanation payload' using errcode = '23514';
    end if;
    if p_explanation_fields->>'translation_status' is null
      or p_explanation_fields->>'translation_status' not in ('complete','english_only')
      or p_explanation_fields->>'source_assertion' is null
      or p_explanation_fields->>'source_assertion' not in ('affirmed','negated','uncertain','negated_uncertain') then
      raise exception 'Invalid bilingual explanation state' using errcode = '23514';
    end if;
    if p_explanation_fields->>'translation_status' = 'complete' then
      foreach field_name in array myanmar_fields loop
        if nullif(btrim(p_explanation_fields->>field_name), '') is null then
          raise exception 'Incomplete Myanmar explanation' using errcode = '23514';
        end if;
      end loop;
    else
      foreach field_name in array myanmar_fields loop
        if (p_explanation_fields -> field_name) is distinct from 'null'::jsonb then
          raise exception 'English-only explanation must not include Myanmar text' using errcode = '23514';
        end if;
      end loop;
    end if;
    if nullif(btrim(p_explanation_fields->>'simple_title_en'), '') is null or length(p_explanation_fields->>'simple_title_en') > 120
      or nullif(btrim(p_explanation_fields->>'short_summary_en'), '') is null or length(p_explanation_fields->>'short_summary_en') > 240
      or nullif(btrim(p_explanation_fields->>'plain_language_explanation_en'), '') is null or length(p_explanation_fields->>'plain_language_explanation_en') > 1000
      or nullif(btrim(p_explanation_fields->>'why_it_may_matter_en'), '') is null or length(p_explanation_fields->>'why_it_may_matter_en') > 400
      or nullif(btrim(p_explanation_fields->>'review_message_en'), '') is null or length(p_explanation_fields->>'review_message_en') > 200
      or nullif(btrim(p_explanation_fields->>'uncertainty_note_en'), '') is null or length(p_explanation_fields->>'uncertainty_note_en') > 400 then
      raise exception 'Invalid English explanation field' using errcode = '23514';
    end if;
    if exists (
      select 1 from unnest(myanmar_fields) as item(key)
      where jsonb_typeof(p_explanation_fields -> (item.key)) = 'string'
        and (nullif(btrim(p_explanation_fields ->> (item.key)), '') is null
          or length(p_explanation_fields ->> (item.key)) > case item.key
            when 'simple_title_my' then 120 when 'short_summary_my' then 240
            when 'plain_language_explanation_my' then 1000 when 'why_it_may_matter_my' then 400
            when 'review_message_my' then 200 else 400 end)
    ) then
      raise exception 'Invalid Myanmar explanation field' using errcode = '23514';
    end if;
  end if;

  select candidate.* into fact from public.document_extracted_facts candidate
  where candidate.id = p_fact_id and candidate.patient_id is not null
    and candidate.review_status in ('needs_review','confirmed') for update;
  if not found then raise exception 'Explainable candidate unavailable' using errcode = '42501'; end if;
  if is_legacy_english then
    if (fact.review_status = 'needs_review'
        and p_explanation_fields->>'review_message' <> 'AI extracted this from your document. Please review it.')
      or (fact.review_status = 'confirmed'
        and p_explanation_fields->>'review_message' <> 'This item was patient-reviewed and confirmed. This is not clinician confirmation.') then
      raise exception 'Explanation review state mismatch' using errcode = '23514';
    end if;
  elsif (fact.review_status = 'needs_review'
      and (p_explanation_fields->>'review_message_en' <> 'AI extracted this from your document. Please review it.'
        or (p_explanation_fields->>'translation_status' = 'complete'
          and p_explanation_fields->>'review_message_my' <> 'ဒီအချက်အလက်ကို AI က သင့် document ထဲကနေ ထုတ်ယူထားတာပါ။ ကျေးဇူးပြုပြီး ပြန်လည်စစ်ဆေးပါ။')))
    or (fact.review_status = 'confirmed'
      and (p_explanation_fields->>'review_message_en' <> 'Patient reviewed. This is not clinician confirmation.'
        or (p_explanation_fields->>'translation_status' = 'complete'
          and p_explanation_fields->>'review_message_my' <> 'လူနာမှ ပြန်လည်စစ်ဆေးပြီးဖြစ်သည်။ ၎င်းသည် ဆရာဝန်မှ အတည်ပြုခြင်း မဟုတ်ပါ।')))
    then
    raise exception 'Explanation review state mismatch' using errcode = '23514';
  end if;

  select source.* into document from public.clinical_documents source
  where source.id = fact.clinical_document_id and source.patient_id = fact.patient_id
    and source.status = 'active' and source.source = 'patient_upload'
    and source.storage_bucket = 'medical-documents' for share;
  if not found then raise exception 'Active source document unavailable' using errcode = '42501'; end if;
  select run.* into extraction from public.document_extractions run
  where run.id = fact.extraction_id and run.clinical_document_id = fact.clinical_document_id
    and run.patient_id = fact.patient_id and run.requested_by_profile_id = p_owner_profile_id for share;
  if not found then raise exception 'Source extraction unavailable' using errcode = '42501'; end if;
  select owner.* into patient from public.patients owner
  where owner.id = fact.patient_id and owner.auth_user_id = p_owner_profile_id
    and owner.profile_id = p_owner_profile_id and owner.status = 'active' for share;
  if not found then raise exception 'Active patient identity unavailable' using errcode = '42501'; end if;
  select owner_profile.* into profile from public.profiles owner_profile
  where owner_profile.id = p_owner_profile_id and owner_profile.role = 'patient'
    and owner_profile.status = 'active' for share;
  if not found then raise exception 'Active patient profile unavailable' using errcode = '42501'; end if;
  perform 1 from storage.objects object
  where object.bucket_id = document.storage_bucket and object.name = document.storage_path for share;
  if not found then raise exception 'Source file unavailable' using errcode = '42501'; end if;

  explanation_payload := p_explanation_fields || jsonb_build_object(
    'source_reference', jsonb_build_object(
      'fact_id', fact.id, 'extraction_id', fact.extraction_id,
      'source_document_id', fact.clinical_document_id, 'source_page', fact.source_page,
      'source_section', fact.source_section, 'source_excerpt', fact.source_excerpt,
      'confidence', fact.confidence, 'confidence_band', fact.confidence_band,
      'review_state', fact.review_status,
      'information_origin', 'Source-derived candidate explanation; not clinician-confirmed.'
    )
  );
  update public.document_extracted_facts set plain_language_explanation = explanation_payload
  where id = fact.id and review_status in ('needs_review','confirmed');
  return jsonb_build_object('fact_id', fact.id, 'explanation', explanation_payload);
end;
$$;

create or replace function public.sync_document_fact_explanation_review_state()
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
      '{review_message_en}',
      to_jsonb(case when new.review_status = 'confirmed'
        then 'Patient reviewed. This is not clinician confirmation.'
        else 'AI extracted this from your document. Please review it.' end), true
    );
    if new.plain_language_explanation->>'translation_status' = 'complete' then
      new.plain_language_explanation := jsonb_set(new.plain_language_explanation, '{review_message_my}',
        to_jsonb(case when new.review_status = 'confirmed'
          then 'လူနာမှ ပြန်လည်စစ်ဆေးပြီးဖြစ်သည်။ ၎င်းသည် ဆရာဝန်မှ အတည်ပြုခြင်း မဟုတ်ပါ။'
          else 'ဒီအချက်အလက်ကို AI က သင့် document ထဲကနေ ထုတ်ယူထားတာပါ။ ကျေးဇူးပြုပြီး ပြန်လည်စစ်ဆေးပါ။' end), true);
    end if;
    if new.plain_language_explanation ? 'review_message' then
      new.plain_language_explanation := jsonb_set(new.plain_language_explanation, '{review_message}',
        to_jsonb(case when new.review_status = 'confirmed'
          then 'This item was patient-reviewed and confirmed. This is not clinician confirmation.'
          else 'AI extracted this from your document. Please review it.' end), true);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.save_my_document_fact_explanation(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_my_document_fact_explanation(uuid,uuid,jsonb) to service_role;
revoke all on function public.sync_document_fact_explanation_review_state() from public, anon, authenticated, service_role;

comment on function public.save_my_document_fact_explanation(uuid,uuid,jsonb) is
  'Trusted server-only bilingual candidate explanation persistence. Both languages share one fact/source reference; rejected explanations are cleared by the existing review trigger.';

commit;
