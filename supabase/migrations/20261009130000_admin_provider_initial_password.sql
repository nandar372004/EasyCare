begin;

-- Reuse the existing setup lifecycle and add only the independent password
-- rotation flag needed by accounts provisioned with an administrator password.
alter table public.providers
  add column must_change_password boolean not null default false;

create or replace function public.protect_provider_password_setup_state() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.must_change_password is distinct from old.must_change_password and auth.uid() is not null then
    raise exception 'Provider password setup state is server managed' using errcode='42501';
  end if;
  return new;
end;
$$;

create trigger protect_provider_password_setup_state
  before update of must_change_password on public.providers
  for each row execute function public.protect_provider_password_setup_state();

create function public.provision_admin_created_provider(
  p_profile_id uuid, p_email text, p_display_name text, p_provider_type public.provider_type
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare provider_id uuid;
begin
  if auth.uid() is not null then raise exception 'Service role required' using errcode='42501'; end if;
  if p_profile_id is null or p_email is null or p_display_name is null
    or p_provider_type::text not in ('doctor','nurse_aide','skilled_nurse_aide','special_nurse')
    or length(btrim(p_display_name)) not between 1 and 160 then
    raise exception 'Invalid provider details' using errcode='22023';
  end if;

  insert into public.profiles(id,role,full_name,email,status)
    values(p_profile_id,'provider',btrim(p_display_name),lower(btrim(p_email)),'active');
  insert into public.providers(profile_id,provider_type,display_name,verification_status,account_status,setup_state,must_change_password)
    values(p_profile_id,p_provider_type,btrim(p_display_name),'pending','active','setup_required',true)
    returning id into provider_id;
  return provider_id;
end;
$$;

create function public.complete_provider_initial_password_change(p_profile_id uuid)
returns public.provider_setup_state
language plpgsql security definer set search_path = '' as $$
declare result_state public.provider_setup_state;
begin
  if auth.uid() is not null then raise exception 'Service role required' using errcode='42501'; end if;
  update public.providers
    set must_change_password=false,account_status='active',setup_state='profile_incomplete'
    where profile_id=p_profile_id and account_status in ('invited','active') and setup_state='setup_required'
      and (must_change_password or account_status='invited')
    returning setup_state into result_state;
  if not found then raise exception 'Provider password setup is unavailable' using errcode='42501'; end if;
  return result_state;
end;
$$;

create or replace function public.begin_my_provider_setup() returns public.provider_setup_state
language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); current_status public.provider_account_status;
  current_setup public.provider_setup_state; must_change boolean;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select pr.account_status,pr.setup_state,pr.must_change_password
    into current_status,current_setup,must_change
    from public.profiles p join public.providers pr on pr.profile_id=p.id
    where p.id=caller and p.role='provider' and p.status='active'
      and pr.provider_type in ('doctor','nurse','nurse_aide','skilled_nurse_aide','special_nurse','caregiver')
    for update of pr;
  if not found or coalesce(must_change,true) then
    raise exception 'Provider password setup is required' using errcode='42501';
  end if;
  if current_setup='setup_required' and current_status='invited' then
    update public.providers set account_status='active',setup_state='profile_incomplete'
      where profile_id=caller returning setup_state into current_setup;
  end if;
  if current_status='disabled' or current_setup not in ('profile_incomplete','ready') then
    raise exception 'Provider setup is unavailable' using errcode='42501';
  end if;
  return current_setup;
end;
$$;

revoke all on function public.provision_admin_created_provider(uuid,text,text,public.provider_type) from public,anon,authenticated;
grant execute on function public.provision_admin_created_provider(uuid,text,text,public.provider_type) to service_role;
revoke all on function public.complete_provider_initial_password_change(uuid) from public,anon,authenticated;
grant execute on function public.complete_provider_initial_password_change(uuid) to service_role;
revoke all on function public.protect_provider_password_setup_state() from public,anon,authenticated;
revoke all on function public.begin_my_provider_setup() from public,anon;
grant execute on function public.begin_my_provider_setup() to authenticated;

commit;
