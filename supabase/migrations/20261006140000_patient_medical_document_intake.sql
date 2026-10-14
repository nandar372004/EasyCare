begin;
set local lock_timeout = '10s';

-- Reuse the existing private clinical document metadata/storage architecture.
-- Patient uploads remain source artifacts and never create clinical facts.
alter table public.clinical_documents
  add column original_filename text,
  add column storage_bucket text not null default 'clinical-documents'
    check (storage_bucket in ('clinical-documents', 'medical-documents')),
  add column source text not null default 'clinical_record'
    check (source in ('clinical_record', 'patient_upload')),
  add column status text not null default 'active'
    check (status in ('active', 'removed')),
  add column updated_at timestamptz not null default statement_timestamp(),
  add column removed_at timestamptz,
  add constraint clinical_documents_original_filename_check check (
    original_filename is null or (
      length(original_filename) between 1 and 255
      and position('/' in original_filename) = 0
      and position(chr(92) in original_filename) = 0
      and original_filename !~ '[[:cntrl:]]'
    )
  ),
  add constraint clinical_documents_status_time_check check (
    (status = 'active' and removed_at is null)
    or (status = 'removed' and removed_at is not null)
  ),
  add constraint clinical_documents_updated_check check (isfinite(updated_at)),
  add constraint clinical_documents_removed_check check (removed_at is null or isfinite(removed_at));

comment on column public.clinical_documents.source is
  'Patient uploads are retained as source evidence only; no extracted clinical truth is stored here.';
comment on column public.clinical_documents.original_filename is
  'Original client filename, preserved separately from the randomized private Storage object name.';
comment on column public.clinical_documents.storage_path is
  'Bucket-relative path only; never a public URL or signed URL.';
comment on column public.clinical_documents.storage_bucket is
  'Private Storage bucket containing the source file; patient uploads use medical-documents.';

create index clinical_documents_patient_uploads_idx
  on public.clinical_documents(patient_id, created_at desc)
  where source = 'patient_upload' and status = 'active';

drop policy clinical_documents_authorized_read on public.clinical_documents;
create policy clinical_documents_authorized_read on public.clinical_documents for select to authenticated
  using (status = 'active' and public.can_access_patient(patient_id, 'clinical'));

drop policy clinical_documents_file_read on storage.objects;
create policy clinical_documents_file_read on storage.objects for select to authenticated
using (bucket_id = 'clinical-documents' and exists (
  select 1 from public.clinical_documents d
  where d.storage_path = storage.objects.name and d.status = 'active'
    and public.can_access_patient(d.patient_id, 'clinical')
));

drop policy clinical_documents_file_read_guard on storage.objects;
create policy clinical_documents_file_read_guard on storage.objects as restrictive for select to authenticated
using (bucket_id <> 'clinical-documents' or exists (
  select 1 from public.clinical_documents d
  where d.storage_path = storage.objects.name and d.status = 'active'
    and public.can_access_patient(d.patient_id, 'clinical')
));

create policy medical_documents_file_read on storage.objects for select to authenticated
using (bucket_id = 'medical-documents' and exists (
  select 1 from public.clinical_documents d
  where d.storage_bucket = 'medical-documents' and d.storage_path = storage.objects.name
    and d.source = 'patient_upload' and d.status = 'active'
    and public.can_access_patient(d.patient_id, 'clinical')
));
create policy medical_documents_file_read_guard on storage.objects as restrictive for select to authenticated
using (bucket_id <> 'medical-documents' or exists (
  select 1 from public.clinical_documents d
  where d.storage_bucket = 'medical-documents' and d.storage_path = storage.objects.name
    and d.source = 'patient_upload' and d.status = 'active'
    and public.can_access_patient(d.patient_id, 'clinical')
));
create policy medical_documents_file_anon_guard on storage.objects as restrictive for select to anon
using (bucket_id <> 'medical-documents');
create policy medical_documents_file_insert_guard on storage.objects as restrictive for insert to anon, authenticated
with check (bucket_id <> 'medical-documents');
create policy medical_documents_file_update_guard on storage.objects as restrictive for update to anon, authenticated
using (bucket_id <> 'medical-documents') with check (bucket_id <> 'medical-documents');
create policy medical_documents_file_delete_guard on storage.objects as restrictive for delete to anon, authenticated
using (bucket_id <> 'medical-documents');

create function public.record_my_medical_document(
  p_document_id uuid,
  p_document_type text,
  p_title text,
  p_original_filename text,
  p_storage_path text,
  p_mime_type text,
  p_file_size bigint,
  p_document_date date default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare patient_row public.patients%rowtype; display_title text; file_extension text;
begin
  if auth.uid() is null or p_document_id is null then
    raise exception 'Authenticated patient required' using errcode = '42501';
  end if;
  select p.* into patient_row
  from public.patients p
  join public.profiles profile on profile.id = p.profile_id
  where p.auth_user_id = auth.uid() and p.profile_id = auth.uid()
    and p.status = 'active' and profile.role = 'patient' and profile.status = 'active'
  for update of p;
  if not found then raise exception 'Patient identity unavailable' using errcode = '42501'; end if;

  if p_document_type is null or p_document_type not in ('discharge_summary','lab_report','prescription','procedure_report','imaging_report','medical_certificate','other') then
    raise exception 'Unsupported medical document type' using errcode = '22023';
  end if;
  if p_original_filename is null or length(p_original_filename) not between 1 and 255
    or position('/' in p_original_filename) > 0 or position(chr(92) in p_original_filename) > 0
    or p_original_filename ~ '[[:cntrl:]]' then
    raise exception 'Invalid original filename' using errcode = '22023';
  end if;
  file_extension := lower(split_part(p_original_filename, '.', array_length(string_to_array(p_original_filename, '.'), 1)));
  if p_mime_type is null or not ((p_mime_type = 'application/pdf' and file_extension = 'pdf')
      or (p_mime_type = 'image/jpeg' and file_extension in ('jpg','jpeg'))
      or (p_mime_type = 'image/png' and file_extension = 'png')) then
    raise exception 'Filename extension and MIME type must match' using errcode = '22023';
  end if;
  if p_file_size is null or p_file_size < 1 or p_file_size > 10485760 then
    raise exception 'Medical documents must be 10 MB or smaller' using errcode = '22023';
  end if;
  if p_document_date is not null and not isfinite(p_document_date) then
    raise exception 'Invalid document date' using errcode = '22023';
  end if;
  if p_storage_path is null or p_storage_path !~ '^[a-f0-9-]+/[a-f0-9-]+/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
    or split_part(p_storage_path, '/', 1) <> patient_row.id::text
    or split_part(p_storage_path, '/', 2) <> p_document_id::text then
    raise exception 'Invalid patient document storage path' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'medical-documents' and object.name = p_storage_path
  ) then
    raise exception 'Uploaded medical document object unavailable' using errcode = '22023';
  end if;
  display_title := nullif(btrim(p_title), '');
  if display_title is not null and length(display_title) > 200 then
    raise exception 'Document title is too long' using errcode = '22023';
  end if;

  insert into public.clinical_documents(
    id, patient_id, document_type, title, original_filename, storage_bucket, storage_path,
    mime_type, file_size, document_date, uploaded_by_profile_id, source, status
  ) values (
    p_document_id, patient_row.id, p_document_type,
    coalesce(display_title, p_original_filename), p_original_filename, 'medical-documents', p_storage_path,
    p_mime_type, p_file_size, p_document_date, auth.uid(), 'patient_upload', 'active'
  );
  return p_document_id;
end;
$$;

revoke all on function public.record_my_medical_document(uuid,text,text,text,text,text,bigint,date) from public, anon;
grant execute on function public.record_my_medical_document(uuid,text,text,text,text,text,bigint,date) to authenticated;

-- Metadata continues to be read-only for browser roles. Trusted Edge code
-- writes/removes storage objects; owner-bound RPCs manage metadata state.
revoke all on public.clinical_documents from public, anon, authenticated;
grant select on public.clinical_documents to authenticated;
grant select, insert, update, delete on public.clinical_documents to service_role;

commit;
