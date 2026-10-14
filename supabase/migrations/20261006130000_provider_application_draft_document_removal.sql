begin;
set local lock_timeout = '10s';

-- This RPC is an internal step for the authenticated removal Edge Function.
-- The function verifies the caller's JWT and passes the corresponding user id;
-- direct browser roles cannot execute this privileged metadata operation.
create function public.delete_provider_application_document_for_owner(
  p_applicant_profile_id uuid,
  p_application_id uuid,
  p_document_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  application_row public.provider_applications;
  document_row public.provider_application_documents;
begin
  if p_applicant_profile_id is null or p_application_id is null or p_document_id is null then
    raise exception 'Credential document is unavailable' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_applicant_profile_id
      and profile.status = 'active'
      and profile.role in ('patient', 'family')
  ) then
    raise exception 'Credential document is unavailable' using errcode = '42501';
  end if;

  select * into application_row
  from public.provider_applications application
  where application.id = p_application_id
    and application.applicant_profile_id = p_applicant_profile_id
  for update;

  if not found or application_row.status <> 'draft' then
    raise exception 'Credential document is unavailable' using errcode = '42501';
  end if;

  delete from public.provider_application_documents document
  where document.id = p_document_id
    and document.application_id = p_application_id
    and document.applicant_profile_id = p_applicant_profile_id
  returning document.* into document_row;

  if not found then
    raise exception 'Credential document is unavailable' using errcode = '42501';
  end if;

  return to_jsonb(document_row);
end;
$$;

revoke all on function public.delete_provider_application_document_for_owner(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_provider_application_document_for_owner(uuid, uuid, uuid) to service_role;
comment on function public.delete_provider_application_document_for_owner(uuid, uuid, uuid) is
  'Internal metadata step for the authenticated provider-application document removal Edge Function. Service role only.';

commit;
