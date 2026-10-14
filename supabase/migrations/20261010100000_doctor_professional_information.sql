begin;

create table public.doctor_professional_information (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 1 and 160),
  nrc text not null check (length(btrim(nrc)) between 1 and 80),
  date_of_birth date not null check (date_of_birth < current_date),
  work_experience_years integer not null check (work_experience_years between 0 and 80),
  current_hospital text check (current_hospital is null or length(btrim(current_hospital)) <= 200),
  medical_qualification text not null check (length(btrim(medical_qualification)) between 1 and 300),
  mmc_registration_number text not null check (length(btrim(mmc_registration_number)) between 1 and 120),
  medical_practitioner_license_number text not null check (length(btrim(medical_practitioner_license_number)) between 1 and 120),
  license_type text not null check (license_type in ('general_medical_practitioner', 'specialist_medical_practitioner', 'limited_medical_practitioner')),
  medical_license_storage_path text,
  medical_license_file_name text,
  medical_license_mime_type text check (medical_license_mime_type is null or medical_license_mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  updated_at timestamptz not null default statement_timestamp(),
  constraint doctor_license_file_metadata_complete check (
    (medical_license_storage_path is null and medical_license_file_name is null and medical_license_mime_type is null)
    or (medical_license_storage_path is not null and medical_license_file_name is not null and medical_license_mime_type is not null)
  )
);

create trigger doctor_professional_information_updated_at
  before update on public.doctor_professional_information
  for each row execute function public.set_updated_at();

alter table public.doctor_professional_information enable row level security;
grant select, insert, update, delete on public.doctor_professional_information to authenticated;

create policy doctor_professional_information_owner_read
  on public.doctor_professional_information for select to authenticated
  using (exists (
    select 1 from public.providers provider
    where provider.id = provider_id and provider.profile_id = auth.uid() and provider.provider_type = 'doctor'
  ));

create policy doctor_professional_information_owner_insert
  on public.doctor_professional_information for insert to authenticated
  with check (exists (
    select 1 from public.providers provider
    where provider.id = provider_id and provider.profile_id = auth.uid() and provider.provider_type = 'doctor'
  ));

create policy doctor_professional_information_owner_update
  on public.doctor_professional_information for update to authenticated
  using (exists (
    select 1 from public.providers provider
    where provider.id = provider_id and provider.profile_id = auth.uid() and provider.provider_type = 'doctor'
  ))
  with check (exists (
    select 1 from public.providers provider
    where provider.id = provider_id and provider.profile_id = auth.uid() and provider.provider_type = 'doctor'
  ));

create policy doctor_professional_information_owner_delete
  on public.doctor_professional_information for delete to authenticated
  using (exists (
    select 1 from public.providers provider
    where provider.id = provider_id and provider.profile_id = auth.uid() and provider.provider_type = 'doctor'
  ));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('doctor-medical-licenses', 'doctor-medical-licenses', false, 10485760, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf','image/jpeg','image/png'];

create policy doctor_medical_license_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'doctor-medical-licenses' and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.providers provider where provider.profile_id = auth.uid() and provider.provider_type = 'doctor'));
create policy doctor_medical_license_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'doctor-medical-licenses' and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.providers provider where provider.profile_id = auth.uid() and provider.provider_type = 'doctor'));
create policy doctor_medical_license_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'doctor-medical-licenses' and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.providers provider where provider.profile_id = auth.uid() and provider.provider_type = 'doctor'))
  with check (bucket_id = 'doctor-medical-licenses' and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.providers provider where provider.profile_id = auth.uid() and provider.provider_type = 'doctor'));
create policy doctor_medical_license_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'doctor-medical-licenses' and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.providers provider where provider.profile_id = auth.uid() and provider.provider_type = 'doctor'));

commit;
