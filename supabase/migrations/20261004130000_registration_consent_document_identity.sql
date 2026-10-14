begin;

-- Existing consent rows retain their established semantics. Registration
-- acknowledgements have explicit document identity, independent consent types,
-- per-document versions, actor attribution and acceptance timestamps.
alter table public.consents
  add column document_key text;

alter table public.consents
  add constraint consents_document_key_check
  check (document_key is null or document_key in ('terms_of_service', 'privacy_policy')),
  add constraint consents_registration_document_type_check
  check (
    document_key is null
    or (document_key = 'terms_of_service' and consent_type = 'terms_of_service')
    or (document_key = 'privacy_policy' and consent_type = 'privacy_policy')
  );

create index consents_document_evidence_idx
  on public.consents(patient_id, document_key, version, granted_at)
  where document_key is not null;

comment on column public.consents.document_key is
  'Identifies a specific document acknowledged by the patient; null for existing non-document consent semantics.';

create or replace function public.create_patient_registration(registration jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  patient_id uuid;
  user_id uuid := (registration->>'userId')::uuid;
  birth_date date;
  terms_accepted boolean := coalesce((registration->>'termsAccepted')::boolean, false);
  privacy_accepted boolean := coalesce((registration->>'privacyConsent')::boolean, false);
begin
  if user_id is null or not exists (select 1 from auth.users where id = user_id) then
    raise exception 'Invalid managed Auth user';
  end if;
  if ((registration ? 'termsAccepted') or (registration ? 'privacyConsent'))
    and (not terms_accepted or not privacy_accepted) then
    raise exception 'Required registration acknowledgements missing';
  end if;

  begin
    birth_date := (registration->>'dateOfBirth')::date;
  exception when others then
    raise exception 'Invalid date of birth';
  end;
  if birth_date is null or birth_date >= current_date then
    raise exception 'Invalid date of birth';
  end if;

  insert into public.profiles (
    id, role, full_name, phone, email, date_of_birth, preferred_language, status
  ) values (
    user_id, 'patient', registration->>'fullName', registration->>'phone',
    nullif(registration->>'email', ''), birth_date,
    coalesce(nullif(registration->>'preferredLanguage', ''), 'en'), 'active'
  );

  insert into public.patients (
    profile_id, auth_user_id, full_name, primary_phone, email, date_of_birth,
    preferred_language, status
  ) values (
    user_id, user_id, registration->>'fullName', registration->>'phone',
    nullif(registration->>'email', ''), birth_date,
    coalesce(nullif(registration->>'preferredLanguage', ''), 'en'), 'active'
  ) returning id into patient_id;

  if terms_accepted and privacy_accepted then
    insert into public.consents (
      patient_id, granted_by_profile_id, consent_type, document_key, version, status
    ) values
      (patient_id, user_id, 'terms_of_service', 'terms_of_service', 'terms-v1', 'granted'),
      (patient_id, user_id, 'privacy_policy', 'privacy_policy', 'privacy-v1', 'granted');
  else
    -- Compatibility for trusted internal callers using pre-contract fixture or
    -- migration payloads; the public Edge Function requires both acknowledgements.
    insert into public.consents (patient_id, granted_by_profile_id, consent_type, version, status)
    values
      (patient_id, user_id, 'care', 'registration-legacy', 'granted'),
      (patient_id, user_id, 'data_processing', 'registration-legacy', 'granted');
  end if;

  return patient_id;
end;
$$;

revoke all on function public.create_patient_registration(jsonb) from public;
grant execute on function public.create_patient_registration(jsonb) to service_role;

commit;
