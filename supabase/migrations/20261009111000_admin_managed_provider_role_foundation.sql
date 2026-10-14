begin;
set local lock_timeout = '10s';

-- Do not normalize an inconsistent legacy role/type pair into new authority.
do $$
begin
  if exists(select 1 from public.profiles p join public.providers pr on pr.profile_id=p.id
    where p.role in ('doctor','nurse','caregiver') and not (
      (p.role='doctor' and pr.provider_type='doctor') or
      (p.role='nurse' and pr.provider_type in ('nurse','nurse_aide','skilled_nurse_aide','special_nurse')) or
      (p.role='caregiver' and pr.provider_type='caregiver'))) then
    raise exception 'Inconsistent legacy provider role/type; refusing role migration.';
  end if;
end $$;

-- Compatibility projection for existing clinical policies: provider categories
-- are derived from providers.provider_type, never a caller-supplied role.
create or replace function public.current_profile_role() returns public.profile_role
language sql stable security definer set search_path='' as $$
  select case when p.role='admin' then 'main_admin'::public.profile_role
    when p.role='provider' then (
      select case pr.provider_type when 'doctor' then 'doctor'::public.profile_role
        when 'caregiver' then 'caregiver'::public.profile_role
        else 'nurse'::public.profile_role end
      from public.providers pr where pr.profile_id=p.id and pr.verification_status='verified'
        and pr.provider_type in ('doctor','nurse','nurse_aide','skilled_nurse_aide','special_nurse','caregiver'))
    else p.role end
  from public.profiles p where p.id=auth.uid() and p.status='active';
$$;

-- Preserve every existing identity gate, adding only normalized role support.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.clinical_identity_is_current()'::regprocedure);
  if position('when p.role in (''doctor'',''nurse'',''caregiver'')' in definition)=0
     or position('when p.role=''main_admin''' in definition)=0 then
    raise exception 'Unexpected clinical identity contract; refusing role migration.';
  end if;
  definition := replace(definition,'when p.role in (''doctor'',''nurse'',''caregiver'')','when p.role in (''provider'',''doctor'',''nurse'',''caregiver'')');
  definition := replace(definition,'when p.role=''main_admin''','when p.role in (''admin'',''main_admin'')');
  execute definition;
end $$;

create or replace function public.get_my_provider_identity()
returns table(provider_id uuid,provider_type public.provider_type,display_name text)
language sql stable security definer set search_path='' as $$
  select pr.id,pr.provider_type,coalesce(nullif(btrim(pr.display_name),''),p.full_name)
  from public.profiles p join public.providers pr on pr.profile_id=p.id
  where p.id=auth.uid() and p.status='active' and p.role='provider'
    and pr.verification_status='verified'
    and pr.provider_type in ('doctor','nurse','nurse_aide','skilled_nurse_aide','special_nurse','caregiver')
    and public.clinical_identity_is_current();
$$;

-- Retain historical application review; guards recognize the normalized admin
-- role. Existing approval remains admin-only and writes the normalized role.
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.admin_list_provider_applications(text)',
    'public.admin_get_provider_application(uuid)',
    'public.admin_start_provider_application_review(uuid)',
    'public.admin_approve_provider_application(uuid)',
    'public.admin_reject_provider_application(uuid,text)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('role=''main_admin''' in definition)=0 then
      raise exception 'Unexpected admin authorization contract: %',signature;
    end if;
    definition := replace(definition,'role=''main_admin''','role=''admin''');
    if signature='public.admin_approve_provider_application(uuid)' then
      if position('set role=resulting_role' in definition)=0 then raise exception 'Unexpected approval role contract'; end if;
      definition := replace(definition,'set role=resulting_role','set role=''provider''');
    end if;
    execute definition;
  end loop;
end $$;

-- Privileged migration only. No identities, patients, or applications deleted.
update public.profiles set role='provider' where role in ('doctor','nurse','caregiver');
update public.profiles set role='admin' where role='main_admin';

-- Retire self-application writes, including direct RPC/storage bypass of the UI.
revoke all on function public.save_provider_application_draft(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.submit_provider_application(uuid) from public,anon,authenticated;
revoke all on function public.record_provider_application_document(uuid,text,text,text,text,bigint) from public,anon,authenticated;
create policy provider_application_retired_insert_guard on storage.objects as restrictive
  for insert to anon,authenticated with check(bucket_id<>'provider-credential-evidence');

-- Existing security-field triggers and RLS stay enabled. No new provisioning RPC.
revoke all on function public.current_profile_role() from public,anon;
revoke all on function public.get_my_provider_identity() from public,anon;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.get_my_provider_identity() to authenticated;
commit;
