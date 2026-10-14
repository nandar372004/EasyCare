begin;

-- Resolve doctor ownership through the existing authenticated, SECURITY DEFINER
-- provider setup identity helper. This avoids granting providers.profile_id.
drop policy if exists doctor_professional_information_owner_read on public.doctor_professional_information;
create policy doctor_professional_information_owner_read
  on public.doctor_professional_information for select to authenticated
  using (exists (
    select 1 from public.get_my_provider_setup_identity() identity
    where identity.provider_id = doctor_professional_information.provider_id
      and identity.provider_type::text = 'doctor'
  ));

drop policy if exists doctor_professional_information_owner_insert on public.doctor_professional_information;
create policy doctor_professional_information_owner_insert
  on public.doctor_professional_information for insert to authenticated
  with check (exists (
    select 1 from public.get_my_provider_setup_identity() identity
    where identity.provider_id = doctor_professional_information.provider_id
      and identity.provider_type::text = 'doctor'
  ));

drop policy if exists doctor_professional_information_owner_update on public.doctor_professional_information;
create policy doctor_professional_information_owner_update
  on public.doctor_professional_information for update to authenticated
  using (exists (
    select 1 from public.get_my_provider_setup_identity() identity
    where identity.provider_id = doctor_professional_information.provider_id
      and identity.provider_type::text = 'doctor'
  ))
  with check (exists (
    select 1 from public.get_my_provider_setup_identity() identity
    where identity.provider_id = doctor_professional_information.provider_id
      and identity.provider_type::text = 'doctor'
  ));

drop policy if exists doctor_professional_information_owner_delete on public.doctor_professional_information;
create policy doctor_professional_information_owner_delete
  on public.doctor_professional_information for delete to authenticated
  using (exists (
    select 1 from public.get_my_provider_setup_identity() identity
    where identity.provider_id = doctor_professional_information.provider_id
      and identity.provider_type::text = 'doctor'
  ));

drop policy if exists doctor_medical_license_owner_insert on storage.objects;
create policy doctor_medical_license_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'doctor-medical-licenses'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.get_my_provider_setup_identity() identity
      where identity.provider_id::text = (storage.foldername(name))[2]
        and identity.provider_type::text = 'doctor'
    ));

drop policy if exists doctor_medical_license_owner_read on storage.objects;
create policy doctor_medical_license_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'doctor-medical-licenses'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.get_my_provider_setup_identity() identity
      where identity.provider_id::text = (storage.foldername(name))[2]
        and identity.provider_type::text = 'doctor'
    ));

drop policy if exists doctor_medical_license_owner_update on storage.objects;
create policy doctor_medical_license_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'doctor-medical-licenses'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.get_my_provider_setup_identity() identity
      where identity.provider_id::text = (storage.foldername(name))[2]
        and identity.provider_type::text = 'doctor'
    ))
  with check (bucket_id = 'doctor-medical-licenses'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.get_my_provider_setup_identity() identity
      where identity.provider_id::text = (storage.foldername(name))[2]
        and identity.provider_type::text = 'doctor'
    ));

drop policy if exists doctor_medical_license_owner_delete on storage.objects;
create policy doctor_medical_license_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'doctor-medical-licenses'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.get_my_provider_setup_identity() identity
      where identity.provider_id::text = (storage.foldername(name))[2]
        and identity.provider_type::text = 'doctor'
    ));

commit;
