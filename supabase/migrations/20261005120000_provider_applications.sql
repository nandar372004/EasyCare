begin;
set local lock_timeout = '10s';

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='storage' and c.relname='objects' and c.relrowsecurity
  ) then
    raise exception 'Storage object RLS must be enabled before provider credential storage is installed';
  end if;
  if exists (select 1 from storage.buckets where id='provider-credential-evidence' and public) then
    raise exception 'Existing provider credential bucket is public; resolve its exposure before installing provider applications';
  end if;
end;
$$;

create type public.provider_application_status as enum ('draft','submitted','under_review','verified','rejected','withdrawn');

create table public.provider_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_profile_id uuid not null references public.profiles(id) on delete restrict,
  status public.provider_application_status not null default 'draft',
  requested_provider_type public.provider_type,
  specialty_id uuid references public.specialties(id) on delete restrict,
  license_number text,
  license_issuer text,
  qualifications text,
  years_experience integer,
  organization text,
  professional_bio text,
  languages text[] not null default '{}',
  service_area text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  submitted_at timestamptz,
  constraint provider_applications_license_check check (license_number is null or length(btrim(license_number)) between 1 and 120),
  constraint provider_applications_issuer_check check (license_issuer is null or length(btrim(license_issuer)) between 1 and 160),
  constraint provider_applications_qualifications_check check (qualifications is null or length(btrim(qualifications)) between 1 and 4000),
  constraint provider_applications_experience_check check (years_experience is null or years_experience between 0 and 80),
  constraint provider_applications_organization_check check (organization is null or length(btrim(organization)) between 1 and 200),
  constraint provider_applications_bio_check check (professional_bio is null or length(btrim(professional_bio)) between 1 and 3000),
  constraint provider_applications_service_area_check check (service_area is null or length(btrim(service_area)) between 1 and 300),
  constraint provider_applications_submitted_check check ((status='draft')=(submitted_at is null)),
  constraint provider_applications_id_owner_key unique(id,applicant_profile_id)
);
create index provider_applications_owner_created_idx on public.provider_applications(applicant_profile_id,created_at desc,id);
create unique index provider_applications_one_open_uidx on public.provider_applications(applicant_profile_id)
  where status in ('draft','submitted','under_review');
create trigger provider_applications_updated_at before update on public.provider_applications
  for each row execute function public.set_updated_at();
create trigger provider_applications_audit after insert or update on public.provider_applications
  for each row execute function public.audit_row_change();

create table public.provider_application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.provider_applications(id) on delete restrict,
  applicant_profile_id uuid not null references public.profiles(id) on delete restrict,
  document_type text not null check (document_type in ('professional_license','qualification_certificate','registration_evidence','other')),
  file_name text not null check (file_name ~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,159}$'),
  storage_path text not null unique check (
    storage_path ~ '^[a-f0-9-]+/[a-f0-9-]+/[A-Za-z0-9][A-Za-z0-9._ -]{0,179}$'
    and split_part(storage_path,'/',4)=''),
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  file_size bigint not null check (file_size between 1 and 10485760),
  created_at timestamptz not null default statement_timestamp(),
  constraint provider_application_document_owner_fk foreign key(application_id,applicant_profile_id)
    references public.provider_applications(id,applicant_profile_id) on delete restrict
);
create index provider_application_documents_application_idx on public.provider_application_documents(application_id,created_at,id);
create trigger provider_application_documents_audit after insert or update or delete on public.provider_application_documents
  for each row execute function public.audit_row_change();

alter table public.provider_applications enable row level security;
alter table public.provider_application_documents enable row level security;
revoke all on public.provider_applications,public.provider_application_documents from public,anon,authenticated;
create policy provider_applications_read_own on public.provider_applications for select to authenticated
  using (applicant_profile_id=auth.uid());
create policy provider_application_documents_read_own on public.provider_application_documents for select to authenticated
  using (applicant_profile_id=auth.uid());
grant select on public.provider_applications,public.provider_application_documents to authenticated;
grant select,insert,update,delete on public.provider_applications,public.provider_application_documents to service_role;

-- The storage bucket is private. Credentials are not placed in public URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('provider-credential-evidence','provider-credential-evidence',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set name=excluded.name,public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create function public.save_provider_application_draft(p_application_id uuid,p_fields jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  caller uuid:=auth.uid(); profile_row public.profiles; application_id uuid;
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
    begin provider_kind:=(p_fields->>'requested_provider_type')::public.provider_type;
    exception when others then raise exception 'Unsupported provider type' using errcode='22023'; end;
  else provider_kind:=null; end if;
  if p_fields ? 'specialty_id' and nullif(btrim(p_fields->>'specialty_id'),'') is not null then
    begin specialty:=(p_fields->>'specialty_id')::uuid;
    exception when others then raise exception 'Choose an available specialty' using errcode='22023'; end;
    if not exists(select 1 from public.specialties where id=specialty) then raise exception 'Choose an available specialty' using errcode='22023'; end if;
  else specialty:=null; end if;
  if p_fields ? 'languages' then
    if jsonb_typeof(p_fields->'languages')<>'array' or jsonb_array_length(p_fields->'languages')>10
      or exists(select 1 from jsonb_array_elements(p_fields->'languages') entry where jsonb_typeof(entry)<>'string' or length(btrim(entry#>>'{}')) not between 1 and 40) then
      raise exception 'Enter up to ten valid languages' using errcode='22023';
    end if;
    select coalesce(array_agg(btrim(value)),'{}'::text[]) into language_values from jsonb_array_elements_text(p_fields->'languages') value;
  else language_values:='{}'; end if;
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

create function public.record_provider_application_document(
  p_application_id uuid,p_document_type text,p_file_name text,p_storage_path text,p_mime_type text,p_file_size bigint
) returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); document_id uuid;
begin
  if caller is null or p_document_type not in ('professional_license','qualification_certificate','registration_evidence','other')
    or p_mime_type not in ('application/pdf','image/jpeg','image/png')
    or p_file_size is null or p_file_size not between 1 and 10485760
    or p_file_name is null or p_file_name !~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,159}$'
    or p_storage_path is null or p_storage_path !~ ('^'||caller::text||'/'||p_application_id::text||'/[A-Za-z0-9][A-Za-z0-9._ -]{0,179}$') then
    raise exception 'Credential document is invalid' using errcode='22023';
  end if;
  if not exists(select 1 from public.provider_applications where id=p_application_id and applicant_profile_id=caller and status='draft')
    or not exists(select 1 from storage.objects where bucket_id='provider-credential-evidence' and name=p_storage_path) then
    raise exception 'Credential document is unavailable' using errcode='42501';
  end if;
  insert into public.provider_application_documents(application_id,applicant_profile_id,document_type,file_name,storage_path,mime_type,file_size)
  values(p_application_id,caller,p_document_type,p_file_name,p_storage_path,p_mime_type,p_file_size) returning id into document_id;
  return document_id;
end $$;

create function public.submit_provider_application(p_application_id uuid)
returns public.provider_application_status language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); application_row public.provider_applications;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=caller and status='active' and role in ('patient','family')) then
    raise exception 'Provider application unavailable' using errcode='42501';
  end if;
  select * into application_row from public.provider_applications where id=p_application_id and applicant_profile_id=caller and status='draft' for update;
  if not found then raise exception 'Draft application unavailable' using errcode='42501'; end if;
  if application_row.requested_provider_type is null or application_row.specialty_id is null
    or nullif(btrim(application_row.license_number),'') is null or nullif(btrim(application_row.license_issuer),'') is null
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

create function public.get_my_provider_application() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=auth.uid(); result jsonb;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select jsonb_build_object(
    'profile',jsonb_build_object('full_name',profile.full_name,'phone',profile.phone),
    'is_verified_provider',exists(select 1 from public.get_my_provider_identity()),
    'application',(
      select to_jsonb(application) || jsonb_build_object('documents',coalesce((
        select jsonb_agg(jsonb_build_object('id',document.id,'document_type',document.document_type,'file_name',document.file_name,'storage_path',document.storage_path,'mime_type',document.mime_type,'file_size',document.file_size,'created_at',document.created_at) order by document.created_at,document.id)
        from public.provider_application_documents document where document.application_id=application.id and document.applicant_profile_id=caller
      ),'[]'::jsonb))
      from public.provider_applications application where application.applicant_profile_id=caller order by application.created_at desc,application.id desc limit 1
    )
  ) into result from public.profiles profile where profile.id=caller and profile.status='active';
  if result is null then raise exception 'Provider application unavailable' using errcode='42501'; end if;
  return result;
end $$;

revoke all on function public.save_provider_application_draft(uuid,jsonb) from public,anon;
revoke all on function public.record_provider_application_document(uuid,text,text,text,text,bigint) from public,anon;
revoke all on function public.submit_provider_application(uuid) from public,anon;
revoke all on function public.get_my_provider_application() from public,anon;
grant execute on function public.save_provider_application_draft(uuid,jsonb) to authenticated;
grant execute on function public.record_provider_application_document(uuid,text,text,text,text,bigint) to authenticated;
grant execute on function public.submit_provider_application(uuid) to authenticated;
grant execute on function public.get_my_provider_application() to authenticated;

-- Only the signed-in owner may upload or retrieve files associated with their
-- own draft/submitted application. Only recorded files can be downloaded.
create policy provider_application_files_read on storage.objects for select to authenticated
using (bucket_id='provider-credential-evidence' and split_part(name,'/',1)=auth.uid()::text and exists(
  select 1 from public.provider_application_documents document join public.provider_applications application on application.id=document.application_id
  where document.storage_path=storage.objects.name and document.applicant_profile_id=auth.uid()
    and application.applicant_profile_id=auth.uid()
));
create policy provider_application_files_insert on storage.objects for insert to authenticated
with check (bucket_id='provider-credential-evidence' and split_part(name,'/',1)=auth.uid()::text and split_part(name,'/',4)=''
  and exists(select 1 from public.provider_applications application where application.id::text=split_part(name,'/',2)
    and application.applicant_profile_id=auth.uid() and application.status='draft'));
create policy provider_application_files_delete on storage.objects for delete to authenticated
using (bucket_id='provider-credential-evidence' and split_part(name,'/',1)=auth.uid()::text and exists(
  select 1 from public.provider_application_documents document join public.provider_applications application on application.id=document.application_id
  where document.storage_path=storage.objects.name and document.applicant_profile_id=auth.uid()
    and application.applicant_profile_id=auth.uid() and application.status='draft'
));
create policy provider_application_files_read_guard on storage.objects as restrictive for select to authenticated
using (bucket_id<>'provider-credential-evidence' or (split_part(name,'/',1)=auth.uid()::text and exists(
  select 1 from public.provider_application_documents document join public.provider_applications application on application.id=document.application_id
  where document.storage_path=storage.objects.name and document.applicant_profile_id=auth.uid()
    and application.applicant_profile_id=auth.uid()
)));
create policy provider_application_files_anon_guard on storage.objects as restrictive for select to anon
using (bucket_id<>'provider-credential-evidence');
create policy provider_application_files_insert_guard on storage.objects as restrictive for insert to anon,authenticated
with check (bucket_id<>'provider-credential-evidence' or (split_part(name,'/',1)=auth.uid()::text and split_part(name,'/',4)=''
  and exists(select 1 from public.provider_applications application where application.id::text=split_part(name,'/',2)
    and application.applicant_profile_id=auth.uid() and application.status='draft')));
create policy provider_application_files_update_guard on storage.objects as restrictive for update to anon,authenticated
using (bucket_id<>'provider-credential-evidence') with check (bucket_id<>'provider-credential-evidence');
create policy provider_application_files_delete_guard on storage.objects as restrictive for delete to anon,authenticated
using (bucket_id<>'provider-credential-evidence' or (split_part(name,'/',1)=auth.uid()::text and exists(
  select 1 from public.provider_application_documents document join public.provider_applications application on application.id=document.application_id
  where document.storage_path=storage.objects.name and document.applicant_profile_id=auth.uid()
    and application.applicant_profile_id=auth.uid() and application.status='draft'
)));

commit;
