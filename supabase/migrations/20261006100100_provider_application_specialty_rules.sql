begin;

-- Resolve every accepted nursing subtype through the existing nurse role.
-- This retains the established verified-provider and clinical-relationship
-- gates while recognizing the two new provider_type enum values.
create or replace function public.get_my_provider_identity()
returns table(provider_id uuid, provider_type public.provider_type, display_name text)
language sql stable security definer set search_path = '' as $$
  select provider.id, provider.provider_type,
    coalesce(nullif(btrim(provider.display_name), ''), profile.full_name)
  from public.profiles profile
  join public.providers provider on provider.profile_id = profile.id
  where profile.id = auth.uid()
    and profile.status = 'active'
    and ((profile.role = 'doctor' and provider.provider_type = 'doctor')
      or (profile.role = 'nurse' and provider.provider_type in ('nurse','nurse_aide','skilled_nurse_aide','special_nurse'))
      or (profile.role = 'caregiver' and provider.provider_type = 'caregiver'))
    and provider.verification_status = 'verified'
    and public.clinical_identity_is_current()
$$;

revoke all on function public.get_my_provider_identity() from public, anon;
grant execute on function public.get_my_provider_identity() to authenticated;

create or replace function public.provider_has_current_clinical_relationship(target_patient_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.clinical_identity_is_current()
    and public.current_profile_role() in ('doctor','nurse','caregiver')
    and exists (
      select 1 from public.providers provider
      where provider.profile_id = auth.uid()
        and provider.verification_status = 'verified'
        and ((public.current_profile_role() = 'doctor' and provider.provider_type = 'doctor')
          or (public.current_profile_role() = 'nurse' and provider.provider_type in ('nurse','nurse_aide','skilled_nurse_aide','special_nurse'))
          or (public.current_profile_role() = 'caregiver' and provider.provider_type = 'caregiver'))
        and (
          exists (
            select 1 from public.appointments appointment
            where appointment.patient_id = target_patient_id
              and appointment.provider_id = provider.id
              and appointment.status in ('pending','confirmed','rescheduled')
              and appointment.cancelled_at is null
              and appointment.scheduled_end > statement_timestamp()
          )
          or exists (
            select 1 from public.care_assignments assignment
            join public.care_requests request on request.id = assignment.care_request_id
            where request.patient_id = target_patient_id
              and assignment.provider_id = provider.id
              and assignment.status in ('assigned','accepted')
              and request.status not in ('closed','cancelled')
          )
          or (provider.provider_type = 'doctor' and exists (
            select 1 from public.care_plans plan
            where plan.patient_id = target_patient_id
              and plan.responsible_provider_id = provider.id
              and plan.status in ('active','paused')
          ))
        )
    )
$$;

revoke all on function public.provider_has_current_clinical_relationship(uuid) from public, anon, authenticated;

create or replace function public.is_appointment_provider(target_appointment_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.clinical_identity_is_current()
    and public.current_profile_role() in ('doctor','nurse','caregiver')
    and exists (
      select 1 from public.appointments appointment
      join public.providers provider on provider.id = appointment.provider_id
      where appointment.id = target_appointment_id
        and provider.profile_id = auth.uid()
        and provider.verification_status = 'verified'
        and ((public.current_profile_role() = 'doctor' and provider.provider_type = 'doctor')
          or (public.current_profile_role() = 'nurse' and provider.provider_type in ('nurse','nurse_aide','skilled_nurse_aide','special_nurse'))
          or (public.current_profile_role() = 'caregiver' and provider.provider_type = 'caregiver'))
        and appointment.status in ('pending','confirmed','rescheduled')
        and appointment.cancelled_at is null
        and appointment.scheduled_end > statement_timestamp()
    )
$$;

revoke all on function public.is_appointment_provider(uuid) from public, anon;
grant execute on function public.is_appointment_provider(uuid) to authenticated;

-- Non-doctor drafts discard any submitted specialty value. Doctor applications
-- continue to require a valid specialty at submission and approval.
create or replace function public.save_provider_application_draft(p_application_id uuid,p_fields jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid(); profile_row public.profiles; application_id uuid;
  provider_kind public.provider_type; specialty uuid; language_values text[];
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into profile_row from public.profiles where id=caller and status='active' and role in ('patient','family');
  if not found then raise exception 'Provider application unavailable' using errcode='42501'; end if;
  if exists(select 1 from public.providers where profile_id=caller and verification_status='verified') then
    raise exception 'Verified provider accounts do not need an application' using errcode='42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields)<>'object'
    or p_fields-ARRAY['requested_provider_type','specialty_id','license_number','license_issuer','qualifications','years_experience','organization','professional_bio','languages','service_area'] <> '{}'::jsonb then
    raise exception 'Invalid provider application fields' using errcode='22023';
  end if;
  if p_fields ? 'requested_provider_type' and nullif(btrim(p_fields->>'requested_provider_type'),'') is not null then
    begin provider_kind := (p_fields->>'requested_provider_type')::public.provider_type;
    exception when others then raise exception 'Unsupported provider type' using errcode='22023'; end;
  else provider_kind := null; end if;
  if provider_kind = 'doctor' and p_fields ? 'specialty_id' and nullif(btrim(p_fields->>'specialty_id'),'') is not null then
    begin specialty := (p_fields->>'specialty_id')::uuid;
    exception when others then raise exception 'Choose an available specialty' using errcode='22023'; end;
    if not exists(select 1 from public.specialties where id=specialty) then
      raise exception 'Choose an available specialty' using errcode='22023';
    end if;
  else specialty := null; end if;
  if p_fields ? 'languages' then
    if jsonb_typeof(p_fields->'languages')<>'array' or jsonb_array_length(p_fields->'languages')>10
      or exists(select 1 from jsonb_array_elements(p_fields->'languages') entry where jsonb_typeof(entry)<>'string' or length(btrim(entry#>>'{}')) not between 1 and 40) then
      raise exception 'Enter up to ten valid languages' using errcode='22023';
    end if;
    select coalesce(array_agg(btrim(value)),'{}'::text[]) into language_values from jsonb_array_elements_text(p_fields->'languages') value;
  else language_values := '{}'; end if;
  if p_application_id is null then
    insert into public.provider_applications(applicant_profile_id,requested_provider_type,specialty_id,license_number,license_issuer,qualifications,years_experience,organization,professional_bio,languages,service_area)
    values(caller,provider_kind,specialty,nullif(btrim(p_fields->>'license_number'),''),nullif(btrim(p_fields->>'license_issuer'),''),nullif(btrim(p_fields->>'qualifications'),''),nullif(p_fields->>'years_experience','')::integer,nullif(btrim(p_fields->>'organization'),''),nullif(btrim(p_fields->>'professional_bio'),''),language_values,nullif(btrim(p_fields->>'service_area'),''))
    returning id into application_id;
  else
    update public.provider_applications set requested_provider_type=provider_kind,specialty_id=specialty,
      license_number=nullif(btrim(p_fields->>'license_number'),''),license_issuer=nullif(btrim(p_fields->>'license_issuer'),''),
      qualifications=nullif(btrim(p_fields->>'qualifications'),''),years_experience=nullif(p_fields->>'years_experience','')::integer,
      organization=nullif(btrim(p_fields->>'organization'),''),professional_bio=nullif(btrim(p_fields->>'professional_bio'),''),
      languages=language_values,service_area=nullif(btrim(p_fields->>'service_area'),'')
    where id=p_application_id and applicant_profile_id=caller and status='draft'
    returning id into application_id;
    if application_id is null then raise exception 'Draft application unavailable' using errcode='42501'; end if;
  end if;
  return application_id;
end $$;

revoke all on function public.save_provider_application_draft(uuid,jsonb) from public, anon;
grant execute on function public.save_provider_application_draft(uuid,jsonb) to authenticated;

create or replace function public.submit_provider_application(p_application_id uuid)
returns public.provider_application_status language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); application_row public.provider_applications;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=caller and status='active' and role in ('patient','family')) then
    raise exception 'Provider application unavailable' using errcode='42501';
  end if;
  select * into application_row from public.provider_applications
  where id=p_application_id and applicant_profile_id=caller and status='draft' for update;
  if not found then raise exception 'Draft application unavailable' using errcode='42501'; end if;
  if application_row.requested_provider_type is null
    or (application_row.requested_provider_type='doctor' and
      (application_row.specialty_id is null or not exists(select 1 from public.specialties where id=application_row.specialty_id)))
    or nullif(btrim(application_row.license_number),'') is null
    or nullif(btrim(application_row.license_issuer),'') is null
    or nullif(btrim(application_row.qualifications),'') is null
    or not exists(select 1 from public.provider_application_documents document join storage.objects object
      on object.bucket_id='provider-credential-evidence' and object.name=document.storage_path
      where document.application_id=application_row.id and document.applicant_profile_id=caller) then
    raise exception 'Complete the required professional details and upload credential evidence before submitting' using errcode='22023';
  end if;
  update public.provider_applications set status='submitted',submitted_at=statement_timestamp()
  where id=application_row.id returning status into application_row.status;
  return application_row.status;
end $$;

revoke all on function public.submit_provider_application(uuid) from public, anon;
grant execute on function public.submit_provider_application(uuid) to authenticated;

create or replace function public.admin_approve_provider_application(p_application_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid(); application_row public.provider_applications; applicant public.profiles;
  primary_document public.provider_application_documents; provider_id uuid;
  decision_time timestamptz := statement_timestamp(); resulting_role public.profile_role;
begin
  if caller is null or not public.is_main_admin()
    or not exists(select 1 from public.profiles where id=caller and role='main_admin' and status='active') then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  select * into application_row from public.provider_applications where id=p_application_id for update;
  if not found then raise exception 'Application unavailable' using errcode='42501'; end if;
  if application_row.applicant_profile_id=caller then
    raise exception 'Applicants cannot approve their own application' using errcode='42501';
  end if;
  if application_row.status='verified' and application_row.provisioned_provider_id is not null then
    if exists(select 1 from public.providers where id=application_row.provisioned_provider_id
      and profile_id=application_row.applicant_profile_id and verification_status='verified') then
      return application_row.provisioned_provider_id;
    end if;
    raise exception 'Verified provider identity is inconsistent' using errcode='23514';
  end if;
  if application_row.status <> 'under_review' then
    raise exception 'Application must be under review before approval' using errcode='42501';
  end if;
  if application_row.requested_provider_type not in ('doctor','nurse','nurse_aide','skilled_nurse_aide','special_nurse','caregiver')
    or (application_row.requested_provider_type='doctor' and
      (application_row.specialty_id is null or not exists(select 1 from public.specialties where id=application_row.specialty_id)))
    or nullif(btrim(application_row.license_number),'') is null
    or nullif(btrim(application_row.license_issuer),'') is null
    or nullif(btrim(application_row.qualifications),'') is null then
    raise exception 'Application is missing required professional details' using errcode='23514';
  end if;
  select * into applicant from public.profiles
  where id=application_row.applicant_profile_id and status='active' and role in ('patient','family') for update;
  if not found then raise exception 'Applicant is not eligible for provider verification' using errcode='42501'; end if;
  if exists(select 1 from public.providers where profile_id=application_row.applicant_profile_id) then
    raise exception 'A provider identity already exists for this applicant' using errcode='23505';
  end if;
  select * into primary_document from public.provider_application_documents
  where application_id=application_row.id and applicant_profile_id=application_row.applicant_profile_id
  order by case document_type when 'professional_license' then 0 when 'registration_evidence' then 1 when 'qualification_certificate' then 2 else 3 end,
    created_at, id limit 1;
  if not found or not exists(select 1 from storage.objects object
    where object.bucket_id='provider-credential-evidence' and object.name=primary_document.storage_path) then
    raise exception 'Credential evidence is missing from private storage' using errcode='23514';
  end if;
  resulting_role := case application_row.requested_provider_type
    when 'doctor' then 'doctor'::public.profile_role
    when 'caregiver' then 'caregiver'::public.profile_role
    else 'nurse'::public.profile_role
  end;

  update public.profiles set role=resulting_role where id=applicant.id;
  insert into public.providers(profile_id,provider_type,license_number,verification_status,years_experience,bio,languages,service_area,display_name,verified_at)
  values(applicant.id,application_row.requested_provider_type,application_row.license_number,'verified',application_row.years_experience,
    application_row.professional_bio,application_row.languages,
    case when nullif(btrim(application_row.service_area),'') is null then null else jsonb_build_object('description',btrim(application_row.service_area)) end,
    applicant.full_name,decision_time)
  returning id into provider_id;
  if application_row.requested_provider_type='doctor' then
    insert into public.provider_specialties(provider_id,specialty_id,is_primary)
    values(provider_id,application_row.specialty_id,true);
  end if;
  insert into public.provider_credentials(provider_id,credential_type,credential_number,issuer,document_url,verification_status,verified_by,verified_at,source_application_id,source_application_document_id)
  values(provider_id,primary_document.document_type,application_row.license_number,application_row.license_issuer,null,'verified',caller,decision_time,application_row.id,primary_document.id);
  update public.provider_applications set status='verified',decided_by_profile_id=caller,decided_at=decision_time,
    decision_reason=null,provisioned_provider_id=provider_id where id=application_row.id;
  insert into public.provider_application_review_events(application_id,reviewer_profile_id,event_type,resulting_provider_id)
  values(application_row.id,caller,'verified',provider_id);
  return provider_id;
end $$;

revoke all on function public.admin_approve_provider_application(uuid) from public, anon;
grant execute on function public.admin_approve_provider_application(uuid) to authenticated;

commit;
