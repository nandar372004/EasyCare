begin;
set local lock_timeout = '10s';

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'Storage object RLS must be enabled before clinical documents are installed';
  end if;
  if exists (select 1 from storage.buckets where id = 'clinical-documents' and public) then
    raise exception 'Existing clinical-documents bucket is public; resolve its exposure before installing clinical documents';
  end if;
end;
$$;

create table public.clinical_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  encounter_id uuid,
  document_type text not null,
  title text not null,
  description text,
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null,
  document_date date,
  uploaded_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint clinical_documents_encounter_patient_fk foreign key (encounter_id, patient_id)
    references public.care_encounters(id, patient_id) on delete restrict,
  constraint clinical_documents_type_check check (document_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint clinical_documents_title_check check (length(btrim(title)) between 1 and 200),
  constraint clinical_documents_path_check check (
    split_part(storage_path, '/', 1) = patient_id::text
    and split_part(storage_path, '/', 2) = id::text
    and storage_path ~ '^[a-f0-9-]+/[a-f0-9-]+/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'),
  constraint clinical_documents_mime_check check (mime_type ~ '^[a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+$'),
  constraint clinical_documents_size_check check (file_size > 0),
  constraint clinical_documents_date_check check (document_date is null or isfinite(document_date)),
  constraint clinical_documents_created_check check (isfinite(created_at))
);
comment on table public.clinical_documents is
  'Metadata only. Content is in the private clinical-documents Storage bucket. Trusted service code validates uploads and writes metadata.';
comment on column public.clinical_documents.storage_path is
  'Bucket-relative patient UUID/document UUID/filename. Never a public URL or signed URL.';

create index clinical_documents_patient_created_idx on public.clinical_documents(patient_id, created_at desc);
create index clinical_documents_encounter_idx on public.clinical_documents(encounter_id) where encounter_id is not null;
create index clinical_documents_uploader_idx on public.clinical_documents(uploaded_by_profile_id);
alter table public.clinical_documents enable row level security;
create policy clinical_documents_authorized_read on public.clinical_documents for select to authenticated
  using (public.can_access_patient(patient_id, 'clinical'));
revoke all on public.clinical_documents from public, anon, authenticated;
grant select on public.clinical_documents to authenticated;
grant select, insert, update, delete on public.clinical_documents to service_role;

-- Provision the PRIVATE bucket with the companion Storage API script.
-- Never insert/delete managed Storage metadata to upload/delete actual files.
create policy clinical_documents_file_read on storage.objects for select to authenticated
using (bucket_id = 'clinical-documents' and exists (
  select 1 from public.clinical_documents d where d.storage_path = storage.objects.name
));
-- Restrictive guards also protect this bucket when another module has a broad
-- permissive policy. Other buckets retain their existing behavior.
create policy clinical_documents_file_read_guard on storage.objects as restrictive for select to authenticated
using (bucket_id <> 'clinical-documents' or exists (
  select 1 from public.clinical_documents d where d.storage_path = storage.objects.name
));
create policy clinical_documents_file_anon_guard on storage.objects as restrictive for select to anon
using (bucket_id <> 'clinical-documents');
create policy clinical_documents_file_insert_guard on storage.objects as restrictive for insert to anon, authenticated
with check (bucket_id <> 'clinical-documents');
create policy clinical_documents_file_update_guard on storage.objects as restrictive for update to anon, authenticated
using (bucket_id <> 'clinical-documents') with check (bucket_id <> 'clinical-documents');
create policy clinical_documents_file_delete_guard on storage.objects as restrictive for delete to anon, authenticated
using (bucket_id <> 'clinical-documents');
commit;
