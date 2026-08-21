begin;

-- EasyCare is patient-only. The historical provider management policy also
-- participates in SELECT and reads providers.profile_id, which is intentionally
-- not exposed to authenticated patients. Keep only the directory read policy.
drop policy if exists availability_provider_manage on public.provider_availability;

drop policy if exists availability_read on public.provider_availability;
create policy availability_read on public.provider_availability
  for select to authenticated
  using (status = 'available');

grant select (id, provider_id, service_type, start_at, end_at, status)
  on table public.provider_availability to authenticated;

revoke insert, update, delete
  on table public.provider_availability from authenticated;

commit;
