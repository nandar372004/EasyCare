begin;
set local lock_timeout = '10s';

-- Keep reviewer and decision metadata out of the applicant-facing table read.
alter table public.provider_applications
  add column review_started_by_profile_id uuid references public.profiles(id) on delete restrict,
  add column review_started_at timestamptz,
  add column decided_by_profile_id uuid references public.profiles(id) on delete restrict,
  add column decided_at timestamptz,
  add column decision_reason text,
  add column provisioned_provider_id uuid references public.providers(id) on delete restrict,
  add constraint provider_applications_review_metadata_check check (
    status not in ('under_review','verified','rejected')
    or (review_started_by_profile_id is not null and review_started_at is not null)
  ),
  add constraint provider_applications_decision_metadata_check check (
    status not in ('verified','rejected')
    or (decided_by_profile_id is not null and decided_at is not null)
  ),
  add constraint provider_applications_provisioning_check check (
    (status = 'verified') = (provisioned_provider_id is not null)
  ),
  add constraint provider_applications_rejection_reason_check check (
    status <> 'rejected' or (decision_reason is not null and length(btrim(decision_reason)) between 8 and 500)
  ),
  add constraint provider_applications_approved_reason_check check (
    status <> 'verified' or decision_reason is null
  );

-- Preserve a direct, verifiable path from each approved credential to both the
-- application and its private uploaded source document. Existing rows stay null.
alter table public.provider_application_documents
  add constraint provider_application_documents_id_app_key unique (id, application_id);

alter table public.provider_credentials
  add column source_application_id uuid references public.provider_applications(id) on delete restrict,
  add column source_application_document_id uuid,
  add constraint provider_credentials_application_document_fk
    foreign key (source_application_document_id, source_application_id)
    references public.provider_application_documents(id, application_id) on delete restrict,
  add constraint provider_credentials_application_source_pair_check check (
    (source_application_id is null) = (source_application_document_id is null)
  );
create unique index provider_credentials_application_document_uidx
  on public.provider_credentials(source_application_document_id)
  where source_application_document_id is not null;

create table public.provider_application_review_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.provider_applications(id) on delete restrict,
  reviewer_profile_id uuid not null references public.profiles(id) on delete restrict,
  event_type text not null check (event_type in ('under_review','verified','rejected')),
  decision_reason text,
  resulting_provider_id uuid references public.providers(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint provider_application_review_event_shape_check check (
    (event_type = 'rejected' and decision_reason is not null and length(btrim(decision_reason)) between 8 and 500 and resulting_provider_id is null)
    or (event_type = 'verified' and decision_reason is null and resulting_provider_id is not null)
    or (event_type = 'under_review' and decision_reason is null and resulting_provider_id is null)
  )
);
create index provider_application_review_events_application_idx
  on public.provider_application_review_events(application_id, created_at, id);
alter table public.provider_application_review_events enable row level security;
revoke all on public.provider_application_review_events from public, anon, authenticated;
grant all on public.provider_application_review_events to service_role;
create trigger provider_application_review_events_audit after insert on public.provider_application_review_events
  for each row execute function public.audit_row_change();
create trigger provider_application_review_events_immutable before update or delete on public.provider_application_review_events
  for each row execute function public.reject_immutable_change();

-- Admin review metadata is returned through an explicitly projected owner RPC,
-- never by granting applicants table access to the new reviewer columns.
revoke select on public.provider_applications from authenticated;
grant select (
  id, applicant_profile_id, status, requested_provider_type, specialty_id,
  license_number, license_issuer, qualifications, years_experience,
  organization, professional_bio, languages, service_area, created_at,
  updated_at, submitted_at
) on public.provider_applications to authenticated;
create policy provider_applications_admin_review_read on public.provider_applications for select to authenticated
  using (public.is_main_admin() and status in ('submitted','under_review','verified','rejected'));
create policy provider_application_documents_admin_review_read on public.provider_application_documents for select to authenticated
  using (public.is_main_admin() and exists(
    select 1 from public.provider_applications application
    where application.id=provider_application_documents.application_id
      and application.status in ('submitted','under_review','verified','rejected')
  ));

create or replace function public.get_my_provider_application() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare caller uuid := auth.uid(); result jsonb;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select jsonb_build_object(
    'profile', jsonb_build_object('full_name', profile.full_name, 'phone', profile.phone),
    'is_verified_provider', exists(select 1 from public.get_my_provider_identity()),
    'application', (
      select jsonb_build_object(
        'id', application.id,
        'applicant_profile_id', application.applicant_profile_id,
        'status', application.status,
        'requested_provider_type', application.requested_provider_type,
        'specialty_id', application.specialty_id,
        'license_number', application.license_number,
        'license_issuer', application.license_issuer,
        'qualifications', application.qualifications,
        'years_experience', application.years_experience,
        'organization', application.organization,
        'professional_bio', application.professional_bio,
        'languages', application.languages,
        'service_area', application.service_area,
        'created_at', application.created_at,
        'updated_at', application.updated_at,
        'submitted_at', application.submitted_at,
        'decision_reason', case when application.status = 'rejected' then application.decision_reason else null end,
        'documents', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', document.id, 'document_type', document.document_type,
            'file_name', document.file_name, 'storage_path', document.storage_path,
            'mime_type', document.mime_type, 'file_size', document.file_size,
            'created_at', document.created_at
          ) order by document.created_at, document.id)
          from public.provider_application_documents document
          where document.application_id = application.id and document.applicant_profile_id = caller
        ), '[]'::jsonb)
      )
      from public.provider_applications application
      where application.applicant_profile_id = caller
      order by application.created_at desc, application.id desc limit 1
    )
  ) into result
  from public.profiles profile
  where profile.id = caller and profile.status = 'active';
  if result is null then raise exception 'Provider application unavailable' using errcode='42501'; end if;
  return result;
end $$;

create function public.admin_list_provider_applications(p_status text default null)
returns table(
  application_id uuid,
  applicant_name text,
  requested_provider_type public.provider_type,
  specialty_name text,
  application_status public.provider_application_status,
  submitted_at timestamptz,
  review_started_at timestamptz,
  decided_at timestamptz
)
language plpgsql stable security definer set search_path='' as $$
declare caller uuid := auth.uid();
begin
  if caller is null or not public.is_main_admin()
    or not exists(select 1 from public.profiles where id=caller and role='main_admin' and status='active') then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  if p_status is not null and p_status not in ('submitted','under_review','verified','rejected') then
    raise exception 'Unsupported application filter' using errcode='22023';
  end if;
  return query
  select application.id, profile.full_name, application.requested_provider_type,
    specialty.name, application.status, application.submitted_at,
    application.review_started_at, application.decided_at
  from public.provider_applications application
  join public.profiles profile on profile.id=application.applicant_profile_id
  left join public.specialties specialty on specialty.id=application.specialty_id
  where application.status in ('submitted','under_review','verified','rejected')
    and (p_status is null or application.status::text=p_status)
  order by application.submitted_at desc, application.id;
end $$;

create function public.admin_get_provider_application(p_application_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller uuid := auth.uid(); result jsonb;
begin
  if caller is null or not public.is_main_admin()
    or not exists(select 1 from public.profiles where id=caller and role='main_admin' and status='active') then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  select jsonb_build_object(
    'application', jsonb_build_object(
      'id', application.id, 'status', application.status,
      'requested_provider_type', application.requested_provider_type,
      'specialty_id', application.specialty_id, 'license_number', application.license_number,
      'license_issuer', application.license_issuer, 'qualifications', application.qualifications,
      'years_experience', application.years_experience, 'organization', application.organization,
      'professional_bio', application.professional_bio, 'languages', application.languages,
      'service_area', application.service_area, 'submitted_at', application.submitted_at,
      'review_started_by_profile_id', application.review_started_by_profile_id,
      'review_started_at', application.review_started_at,
      'decided_by_profile_id', application.decided_by_profile_id,
      'decided_at', application.decided_at, 'decision_reason', application.decision_reason,
      'provisioned_provider_id', application.provisioned_provider_id
    ),
    'applicant', jsonb_build_object(
      'profile_id', profile.id, 'full_name', profile.full_name, 'phone', profile.phone,
      'email', profile.email, 'role', profile.role, 'status', profile.status
    ),
    'specialty', specialty.name,
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', document.id, 'document_type', document.document_type,
        'file_name', document.file_name, 'storage_path', document.storage_path,
        'mime_type', document.mime_type, 'file_size', document.file_size,
        'created_at', document.created_at
      ) order by document.created_at, document.id)
      from public.provider_application_documents document
      where document.application_id=application.id
    ), '[]'::jsonb)
  ) into result
  from public.provider_applications application
  join public.profiles profile on profile.id=application.applicant_profile_id
  left join public.specialties specialty on specialty.id=application.specialty_id
  where application.id=p_application_id
    and application.status in ('submitted','under_review','verified','rejected');
  if result is null then raise exception 'Submitted application unavailable' using errcode='42501'; end if;
  return result;
end $$;

create function public.admin_start_provider_application_review(p_application_id uuid)
returns public.provider_application_status
language plpgsql security definer set search_path='' as $$
declare caller uuid := auth.uid(); application_row public.provider_applications;
begin
  if caller is null or not public.is_main_admin()
    or not exists(select 1 from public.profiles where id=caller and role='main_admin' and status='active') then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  select * into application_row from public.provider_applications where id=p_application_id for update;
  if not found or application_row.status <> 'submitted' then
    raise exception 'Submitted application unavailable for review' using errcode='42501';
  end if;
  if application_row.applicant_profile_id=caller then
    raise exception 'Applicants cannot review their own application' using errcode='42501';
  end if;
  update public.provider_applications
  set status='under_review', review_started_by_profile_id=caller,
      review_started_at=statement_timestamp()
  where id=application_row.id;
  insert into public.provider_application_review_events(application_id,reviewer_profile_id,event_type)
  values(application_row.id,caller,'under_review');
  return 'under_review';
end $$;

create function public.admin_approve_provider_application(p_application_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  caller uuid := auth.uid();
  application_row public.provider_applications;
  applicant public.profiles;
  primary_document public.provider_application_documents;
  provider_id uuid;
  decision_time timestamptz := statement_timestamp();
  resulting_role public.profile_role;
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
  if application_row.requested_provider_type not in ('doctor','nurse','nurse_aide','caregiver')
    or application_row.specialty_id is null
    or not exists(select 1 from public.specialties where id=application_row.specialty_id)
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
    created_at, id
  limit 1;
  if not found or not exists(select 1 from storage.objects object
    where object.bucket_id='provider-credential-evidence' and object.name=primary_document.storage_path) then
    raise exception 'Credential evidence is missing from private storage' using errcode='23514';
  end if;
  resulting_role := case application_row.requested_provider_type
    when 'doctor' then 'doctor'::public.profile_role
    when 'nurse' then 'nurse'::public.profile_role
    when 'nurse_aide' then 'nurse'::public.profile_role
    when 'caregiver' then 'caregiver'::public.profile_role
  end;

  update public.profiles set role=resulting_role where id=applicant.id;
  insert into public.providers(
    profile_id, provider_type, license_number, verification_status,
    years_experience, bio, languages, service_area, display_name, verified_at
  ) values (
    applicant.id, application_row.requested_provider_type, application_row.license_number,
    'verified', application_row.years_experience, application_row.professional_bio,
    application_row.languages,
    case when nullif(btrim(application_row.service_area),'') is null then null
      else jsonb_build_object('description', btrim(application_row.service_area)) end,
    applicant.full_name, decision_time
  ) returning id into provider_id;
  insert into public.provider_specialties(provider_id,specialty_id,is_primary)
  values(provider_id,application_row.specialty_id,true);
  insert into public.provider_credentials(
    provider_id,credential_type,credential_number,issuer,document_url,
    verification_status,verified_by,verified_at,source_application_id,source_application_document_id
  ) values (
    provider_id,primary_document.document_type,application_row.license_number,
    application_row.license_issuer,null,'verified',caller,decision_time,
    application_row.id,primary_document.id
  );
  update public.provider_applications set
    status='verified', decided_by_profile_id=caller, decided_at=decision_time,
    decision_reason=null, provisioned_provider_id=provider_id
  where id=application_row.id;
  insert into public.provider_application_review_events(
    application_id,reviewer_profile_id,event_type,resulting_provider_id
  ) values(application_row.id,caller,'verified',provider_id);
  return provider_id;
end $$;

create function public.admin_reject_provider_application(p_application_id uuid,p_safe_reason text)
returns public.provider_application_status
language plpgsql security definer set search_path='' as $$
declare caller uuid := auth.uid(); application_row public.provider_applications; reason text;
begin
  if caller is null or not public.is_main_admin()
    or not exists(select 1 from public.profiles where id=caller and role='main_admin' and status='active') then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  reason := nullif(btrim(p_safe_reason),'');
  if reason is null or length(reason) not between 8 and 500 then
    raise exception 'Provide a safe applicant-facing reason between 8 and 500 characters' using errcode='22023';
  end if;
  select * into application_row from public.provider_applications where id=p_application_id for update;
  if not found or application_row.status <> 'under_review' then
    raise exception 'Application must be under review before rejection' using errcode='42501';
  end if;
  if application_row.applicant_profile_id=caller then
    raise exception 'Applicants cannot reject their own application' using errcode='42501';
  end if;
  update public.provider_applications set
    status='rejected', decided_by_profile_id=caller, decided_at=statement_timestamp(),
    decision_reason=reason, provisioned_provider_id=null
  where id=application_row.id;
  insert into public.provider_application_review_events(
    application_id,reviewer_profile_id,event_type,decision_reason
  ) values(application_row.id,caller,'rejected',reason);
  return 'rejected';
end $$;

-- Only recorded application documents may be read by their owner or an active
-- main admin. Storage signed URLs are minted by the authenticated client and
-- remain short lived; the bucket itself stays private.
create policy provider_application_files_admin_read on storage.objects for select to authenticated
using (
  bucket_id='provider-credential-evidence'
  and public.is_main_admin()
  and exists(select 1 from public.provider_application_documents document
    join public.provider_applications application on application.id=document.application_id
    where document.storage_path=storage.objects.name
      and application.status in ('submitted','under_review','verified','rejected'))
);
drop policy provider_application_files_read_guard on storage.objects;
create policy provider_application_files_read_guard on storage.objects as restrictive for select to authenticated
using (
  bucket_id<>'provider-credential-evidence'
  or exists(select 1 from public.provider_application_documents document
    join public.provider_applications application on application.id=document.application_id
    where document.storage_path=storage.objects.name
      and ((document.applicant_profile_id=auth.uid() and application.applicant_profile_id=auth.uid())
        or (public.is_main_admin() and application.status in ('submitted','under_review','verified','rejected'))))
);

revoke all on function public.admin_list_provider_applications(text) from public,anon;
revoke all on function public.admin_get_provider_application(uuid) from public,anon;
revoke all on function public.admin_start_provider_application_review(uuid) from public,anon;
revoke all on function public.admin_approve_provider_application(uuid) from public,anon;
revoke all on function public.admin_reject_provider_application(uuid,text) from public,anon;
revoke all on function public.get_my_provider_application() from public,anon;
grant execute on function public.admin_list_provider_applications(text) to authenticated;
grant execute on function public.admin_get_provider_application(uuid) to authenticated;
grant execute on function public.admin_start_provider_application_review(uuid) to authenticated;
grant execute on function public.admin_approve_provider_application(uuid) to authenticated;
grant execute on function public.admin_reject_provider_application(uuid,text) to authenticated;
grant execute on function public.get_my_provider_application() to authenticated;

commit;
