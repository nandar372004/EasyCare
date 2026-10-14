begin;

-- No row means not_started, so existing patients remain compatible.
create table public.patient_onboarding_states (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  status text not null check (status in ('in_progress','completed','skipped')),
  updated_at timestamptz not null default statement_timestamp()
);
alter table public.patient_onboarding_states enable row level security;
revoke all on public.patient_onboarding_states from public, anon, authenticated;

create function public.get_my_patient_onboarding()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'status', coalesce(s.status, 'not_started'),
    'profile', jsonb_build_object(
      'addressLine', p.address_line, 'township', p.township, 'city', p.city,
      'emergencyContactName', p.emergency_contact_name,
      'emergencyContactRelationship', p.emergency_contact_relationship,
      'emergencyContactPhone', p.emergency_contact_phone
    ),
    'identity', jsonb_build_object('fullName', pr.full_name, 'dateOfBirth', pr.date_of_birth, 'phone', pr.phone)
  ) into result
  from public.patients p join public.profiles pr on pr.id = p.profile_id
  left join public.patient_onboarding_states s on s.patient_id = p.id
  where p.auth_user_id = auth.uid() and p.profile_id = auth.uid()
    and p.status = 'active' and pr.role = 'patient' and pr.status = 'active';
  if result is null then raise exception 'Patient identity unavailable'; end if;
  return result;
end;
$$;

create function public.save_my_patient_onboarding(p_status text, p_profile jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare patient_row public.patients%rowtype; normalized_emergency_phone text;
begin
  if p_status not in ('in_progress','completed','skipped') then raise exception 'Invalid onboarding status'; end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then raise exception 'Profile must be an object'; end if;
  if exists (select 1 from jsonb_object_keys(p_profile) as keys(key) where key not in (
    'addressLine','township','city','emergencyContactName','emergencyContactRelationship','emergencyContactPhone'
  )) then raise exception 'Unsupported profile field'; end if;
  if exists (select 1 from jsonb_each_text(p_profile) e where e.value is not null and length(btrim(e.value)) > 200) then raise exception 'Profile field is too long'; end if;
  if nullif(btrim(p_profile->>'emergencyContactPhone'),'') is not null then
    normalized_emergency_phone := public.normalize_myanmar_phone(p_profile->>'emergencyContactPhone');
  end if;
  select * into patient_row from public.patients p
  where p.auth_user_id = auth.uid() and p.profile_id = auth.uid() and p.status = 'active' for update;
  if not found then raise exception 'Patient identity unavailable'; end if;
  perform 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'patient' and pr.status = 'active' for update;
  if not found then raise exception 'Patient identity unavailable'; end if;
  update public.patients set
    address_line = case when p_profile ? 'addressLine' then nullif(btrim(p_profile->>'addressLine'),'') else address_line end,
    township = case when p_profile ? 'township' then nullif(btrim(p_profile->>'township'),'') else township end,
    city = case when p_profile ? 'city' then nullif(btrim(p_profile->>'city'),'') else city end,
    emergency_contact_name = case when p_profile ? 'emergencyContactName' then nullif(btrim(p_profile->>'emergencyContactName'),'') else emergency_contact_name end,
    emergency_contact_relationship = case when p_profile ? 'emergencyContactRelationship' then nullif(btrim(p_profile->>'emergencyContactRelationship'),'') else emergency_contact_relationship end,
    emergency_contact_phone = case when p_profile ? 'emergencyContactPhone' then normalized_emergency_phone else emergency_contact_phone end
  where id = patient_row.id;
  insert into public.patient_onboarding_states(patient_id,status,updated_at)
  values (patient_row.id,p_status,statement_timestamp())
  on conflict (patient_id) do update set status=excluded.status, updated_at=excluded.updated_at;
  return public.get_my_patient_onboarding();
end;
$$;

revoke all on function public.get_my_patient_onboarding() from public, anon;
revoke all on function public.save_my_patient_onboarding(text,jsonb) from public, anon;
grant execute on function public.get_my_patient_onboarding() to authenticated;
grant execute on function public.save_my_patient_onboarding(text,jsonb) to authenticated;
commit;
