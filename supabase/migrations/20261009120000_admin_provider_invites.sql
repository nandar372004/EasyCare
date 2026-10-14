begin;

-- Existing providers retain their working state. Newly invited identities begin
-- in the invite/setup states and remain clinically unverified.
create type public.provider_account_status as enum ('invited','active','disabled');
create type public.provider_setup_state as enum ('setup_required','profile_incomplete','ready');

alter table public.providers
  add column account_status public.provider_account_status not null default 'active',
  add column setup_state public.provider_setup_state not null default 'ready';

create or replace function public.protect_security_managed_fields() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  password_is_set boolean;
  setup_complete boolean;
begin
  if caller is not null and not public.is_main_admin() then
    if tg_table_name = 'profiles' then
      if new.role is distinct from old.role or new.status is distinct from old.status then
        raise exception 'Profile role and status are administratively managed' using errcode='42501';
      end if;
      if old.role = 'provider' and (new.email is distinct from old.email
        or new.date_of_birth is distinct from old.date_of_birth or new.gender is distinct from old.gender
        or new.preferred_language is distinct from old.preferred_language) then
        raise exception 'Provider profile fields are restricted' using errcode='42501';
      end if;
    elsif tg_table_name = 'providers' then
      if new.profile_id is distinct from old.profile_id or new.provider_type is distinct from old.provider_type
        or new.verification_status is distinct from old.verification_status or new.verified_at is distinct from old.verified_at
        or new.years_experience is distinct from old.years_experience or new.languages is distinct from old.languages
        or new.service_area is distinct from old.service_area then
        raise exception 'Provider identity and restricted fields are administratively managed' using errcode='42501';
      end if;
      if new.account_status is distinct from old.account_status or new.setup_state is distinct from old.setup_state then
        if caller <> old.profile_id then
          raise exception 'Provider account state is administratively managed' using errcode='42501';
        end if;
        if old.account_status='invited' and old.setup_state='setup_required'
          and new.account_status='active' and new.setup_state='profile_incomplete' then
          select coalesce(nullif(u.encrypted_password,''),'')<>'' into password_is_set
            from auth.users u where u.id=caller;
          if not coalesce(password_is_set,false) then
            raise exception 'Set a password before starting provider setup' using errcode='42501';
          end if;
        elsif old.account_status='active' and old.setup_state='profile_incomplete'
          and new.account_status='active' and new.setup_state='ready' then
          select exists(select 1 from public.profiles p where p.id=caller and p.role='provider'
              and p.status='active' and nullif(btrim(p.full_name),'') is not null and p.phone is not null)
            and nullif(btrim(new.display_name),'') is not null
            and (new.provider_type<>'doctor' or (
              nullif(btrim(new.license_number),'') is not null
              and (new.teleconsult_enabled or new.home_visit_enabled)
              and exists(select 1 from public.provider_specialties ps where ps.provider_id=new.id)
            )) into setup_complete;
          if not coalesce(setup_complete,false) then
            raise exception 'Required provider setup fields are incomplete' using errcode='22023';
          end if;
        else
          raise exception 'Invalid provider setup state transition' using errcode='42501';
        end if;
      end if;
      if new.display_name is distinct from old.display_name or new.qualification is distinct from old.qualification
        or new.bio is distinct from old.bio or new.license_number is distinct from old.license_number
        or new.teleconsult_enabled is distinct from old.teleconsult_enabled
        or new.home_visit_enabled is distinct from old.home_visit_enabled
        or new.consultation_fee_mmk is distinct from old.consultation_fee_mmk then
        if caller <> old.profile_id or old.account_status not in ('invited','active')
          or old.setup_state not in ('setup_required','profile_incomplete','ready') then
          raise exception 'Provider profile changes are restricted' using errcode='42501';
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.current_profile_role() returns public.profile_role
language sql stable security definer set search_path='' as $$
  select case when p.role='admin' then 'main_admin'::public.profile_role
    when p.role='provider' then (
      select case pr.provider_type when 'doctor' then 'doctor'::public.profile_role
        when 'caregiver' then 'caregiver'::public.profile_role else 'nurse'::public.profile_role end
      from public.providers pr where pr.profile_id=p.id and pr.verification_status='verified'
        and pr.account_status='active' and pr.setup_state='ready'
        and pr.provider_type in ('doctor','nurse','nurse_aide','skilled_nurse_aide','special_nurse','caregiver'))
    else p.role end
  from public.profiles p where p.id=auth.uid() and p.status='active';
$$;

create or replace function public.get_my_provider_identity()
returns table(provider_id uuid,provider_type public.provider_type,display_name text)
language sql stable security definer set search_path='' as $$
  select pr.id,pr.provider_type,coalesce(nullif(btrim(pr.display_name),''),p.full_name)
  from public.profiles p join public.providers pr on pr.profile_id=p.id
  where p.id=auth.uid() and p.status='active' and p.role='provider'
    and pr.verification_status='verified' and pr.account_status='active' and pr.setup_state='ready'
    and pr.provider_type in ('doctor','nurse','nurse_aide','skilled_nurse_aide','special_nurse','caregiver')
    and public.clinical_identity_is_current();
$$;

create function public.get_my_provider_setup_identity()
returns table(profile_role public.profile_role,provider_id uuid,provider_type public.provider_type,
  display_name text,full_name text,phone text,bio text,qualification text,license_number text,
  consultation_fee_mmk integer,teleconsult_enabled boolean,home_visit_enabled boolean,
  specialty_id uuid,account_status public.provider_account_status,setup_state public.provider_setup_state,
  verification_status public.verification_status)
language sql stable security definer set search_path='' as $$
  select p.role,pr.id,pr.provider_type,pr.display_name,p.full_name,p.phone,pr.bio,pr.qualification,
    pr.license_number,pr.consultation_fee_mmk,pr.teleconsult_enabled,pr.home_visit_enabled,
    (select ps.specialty_id from public.provider_specialties ps where ps.provider_id=pr.id and ps.is_primary limit 1),
    pr.account_status,pr.setup_state,pr.verification_status
  from public.profiles p join public.providers pr on pr.profile_id=p.id
  where p.id=auth.uid() and p.role='provider' and p.status='active'
    and pr.provider_type in ('doctor','nurse','nurse_aide','skilled_nurse_aide','special_nurse','caregiver')
    and pr.account_status in ('invited','active')
    and pr.setup_state in ('setup_required','profile_incomplete','ready');
$$;

create function public.begin_my_provider_setup() returns public.provider_setup_state
language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); current_status public.provider_account_status; current_setup public.provider_setup_state;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select pr.account_status,pr.setup_state into current_status,current_setup
    from public.profiles p join public.providers pr on pr.profile_id=p.id
    where p.id=caller and p.role='provider' and p.status='active'
      and pr.provider_type in ('doctor','nurse','nurse_aide','skilled_nurse_aide','special_nurse','caregiver')
    for update of pr;
  if not found then raise exception 'Provider setup is unavailable' using errcode='42501'; end if;
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

create function public.complete_my_provider_setup(
  p_display_name text,p_phone text,p_bio text default null,p_qualification text default null,
  p_specialty_id uuid default null,p_license_number text default null,
  p_teleconsult_enabled boolean default false,p_home_visit_enabled boolean default false,
  p_consultation_fee_mmk integer default null
) returns public.provider_setup_state
language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); provider_row public.providers%rowtype; result_state public.provider_setup_state;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select pr.* into provider_row from public.profiles p join public.providers pr on pr.profile_id=p.id
    where p.id=caller and p.role='provider' and p.status='active'
      and pr.provider_type in ('doctor','nurse','nurse_aide','skilled_nurse_aide','special_nurse','caregiver')
      and pr.account_status='active' and pr.setup_state='profile_incomplete' for update of pr;
  if not found then raise exception 'Provider setup is unavailable' using errcode='42501'; end if;
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 160
    or p_phone is null or length(btrim(p_phone))=0
    or (p_bio is not null and length(btrim(p_bio))>1000)
    or (p_qualification is not null and length(btrim(p_qualification))>300)
    or (p_consultation_fee_mmk is not null and p_consultation_fee_mmk<0) then
    raise exception 'Provider setup fields are invalid' using errcode='22023';
  end if;
  if provider_row.provider_type='doctor' then
    if p_specialty_id is null or not exists(select 1 from public.specialties where id=p_specialty_id)
      or p_license_number is null or length(btrim(p_license_number)) not between 1 and 120
      or not (p_teleconsult_enabled or p_home_visit_enabled) then
      raise exception 'Doctor setup requires specialty, license, and consultation type' using errcode='22023';
    end if;
  end if;

  update public.profiles set full_name=btrim(p_display_name),phone=btrim(p_phone) where id=caller;
  if provider_row.provider_type='doctor' then
    delete from public.provider_specialties where provider_id=provider_row.id;
    insert into public.provider_specialties(provider_id,specialty_id,is_primary)
      values(provider_row.id,p_specialty_id,true);
  end if;
  update public.providers set display_name=btrim(p_display_name),bio=nullif(btrim(p_bio),''),
    qualification=nullif(btrim(p_qualification),''),
    license_number=case when provider_row.provider_type='doctor' then btrim(p_license_number) else license_number end,
    teleconsult_enabled=case when provider_row.provider_type='doctor' then p_teleconsult_enabled else teleconsult_enabled end,
    home_visit_enabled=case when provider_row.provider_type='doctor' then p_home_visit_enabled else home_visit_enabled end,
    consultation_fee_mmk=case when provider_row.provider_type='doctor' then p_consultation_fee_mmk else consultation_fee_mmk end,
    setup_state='ready'
    where id=provider_row.id returning setup_state into result_state;
  return result_state;
end;
$$;

create function public.provision_invited_provider(
  p_profile_id uuid, p_email text, p_display_name text, p_provider_type public.provider_type
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare provider_id uuid;
begin
  if auth.uid() is not null then raise exception 'Service role required' using errcode='42501'; end if;
  if p_profile_id is null or p_email is null or p_display_name is null
    or p_provider_type::text not in ('doctor','nurse','nurse_aide','skilled_nurse_aide','special_nurse','caregiver') then
    raise exception 'Invalid provider details' using errcode='22023';
  end if;

  insert into public.profiles(id,role,full_name,email,status)
    values(p_profile_id,'provider',btrim(p_display_name),lower(btrim(p_email)),'active');
  insert into public.providers(profile_id,provider_type,display_name,verification_status,account_status,setup_state)
    values(p_profile_id,p_provider_type,btrim(p_display_name),'pending','invited','setup_required')
    returning id into provider_id;
  return provider_id;
end;
$$;

revoke all on function public.provision_invited_provider(uuid,text,text,public.provider_type) from public,anon,authenticated;
grant execute on function public.provision_invited_provider(uuid,text,text,public.provider_type) to service_role;
revoke all on function public.get_my_provider_setup_identity() from public,anon;
revoke all on function public.begin_my_provider_setup() from public,anon;
revoke all on function public.complete_my_provider_setup(text,text,text,text,uuid,text,boolean,boolean,integer) from public,anon;
grant execute on function public.get_my_provider_setup_identity() to authenticated;
grant execute on function public.begin_my_provider_setup() to authenticated;
grant execute on function public.complete_my_provider_setup(text,text,text,text,uuid,text,boolean,boolean,integer) to authenticated;

-- The provisioning RPC is the only write path introduced here. Existing RLS
-- policies and table-level privileges are left unchanged.
commit;
