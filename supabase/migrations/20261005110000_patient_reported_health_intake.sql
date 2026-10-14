begin;

-- Patient-entered health reports are deliberately separate from clinician
-- conditions, allergies, medication records, prescriptions, and schedules.
create table public.patient_reported_health_items (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  reported_by_user_id uuid not null references auth.users(id) on delete restrict,
  item_type text not null check (item_type in ('allergy','condition','medication')),
  entry_kind text not null default 'item' check (entry_kind in ('item','none_known','unknown')),
  item_name text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
  source text not null default 'patient_reported' check (source='patient_reported'),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','confirmed','rejected','corrected')),
  reviewed_by_profile_id uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  review_decision text check (review_decision is null or review_decision in ('confirmed','rejected','corrected')),
  record_status text not null default 'active' check (record_status in ('active','archived')),
  archived_at timestamptz,
  legacy_source_key text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint patient_reported_health_item_name_check check (
    (entry_kind='item' and item_name is not null and length(btrim(item_name)) between 1 and 160)
    or (entry_kind<>'item' and item_name is null and details='{}'::jsonb)
  ),
  constraint patient_reported_health_item_review_check check (
    (verification_status='unverified' and reviewed_by_profile_id is null and reviewed_at is null and review_decision is null)
    or (verification_status<>'unverified' and reviewed_by_profile_id is not null and reviewed_at is not null and review_decision=verification_status)
  ),
  constraint patient_reported_health_item_archive_check check (
    (record_status='active' and archived_at is null) or (record_status='archived' and archived_at is not null)
  ),
  constraint patient_reported_health_item_review_time_check check (reviewed_at is null or isfinite(reviewed_at)),
  constraint patient_reported_health_item_archive_time_check check (archived_at is null or isfinite(archived_at))
);

create index patient_reported_health_items_owner_idx
  on public.patient_reported_health_items(patient_id, item_type, record_status, created_at desc);
create unique index patient_reported_health_items_legacy_once_idx
  on public.patient_reported_health_items(patient_id, legacy_source_key)
  where legacy_source_key is not null;
create unique index patient_reported_health_items_single_marker_idx
  on public.patient_reported_health_items(patient_id, item_type)
  where entry_kind<>'item' and record_status='active';

comment on table public.patient_reported_health_items is
  'Patient-reported health intake only. These rows are never canonical clinical records or medication sources.';
comment on column public.patient_reported_health_items.source is
  'Fixed to patient_reported at insert; review does not change the original source.';
comment on column public.patient_reported_health_items.verification_status is
  'Only trusted provider review may change unverified to a reviewed decision.';

-- Preserve legacy profile text verbatim in care_preferences while copying a
-- reviewable, explicitly unverified projection into the patient-report store.
insert into public.patient_reported_health_items(
  patient_id, reported_by_user_id, item_type, entry_kind, item_name,
  legacy_source_key, created_at, updated_at
)
select p.id, p.auth_user_id, 'allergy', 'item', btrim(p.care_preferences->>'allergies'),
       'care_preferences:allergies', statement_timestamp(), statement_timestamp()
from public.patients p
where nullif(btrim(p.care_preferences->>'allergies'),'') is not null
on conflict (patient_id, legacy_source_key) where legacy_source_key is not null do nothing;

insert into public.patient_reported_health_items(
  patient_id, reported_by_user_id, item_type, entry_kind, item_name,
  legacy_source_key, created_at, updated_at
)
select p.id, p.auth_user_id, 'allergy', 'none_known', null,
       'care_preferences:noKnownAllergies', statement_timestamp(), statement_timestamp()
from public.patients p
where p.care_preferences->'noKnownAllergies'='true'::jsonb
  and nullif(btrim(p.care_preferences->>'allergies'),'') is null
on conflict (patient_id, legacy_source_key) where legacy_source_key is not null do nothing;

insert into public.patient_reported_health_items(
  patient_id, reported_by_user_id, item_type, entry_kind, item_name,
  legacy_source_key, created_at, updated_at
)
select p.id, p.auth_user_id, 'condition', 'item', btrim(p.care_preferences->>'existingMedicalConditions'),
       'care_preferences:existingMedicalConditions', statement_timestamp(), statement_timestamp()
from public.patients p
where nullif(btrim(p.care_preferences->>'existingMedicalConditions'),'') is not null
on conflict (patient_id, legacy_source_key) where legacy_source_key is not null do nothing;

insert into public.patient_reported_health_items(
  patient_id, reported_by_user_id, item_type, entry_kind, item_name,
  legacy_source_key, created_at, updated_at
)
select p.id, p.auth_user_id, 'medication', 'item', btrim(p.care_preferences->>'currentMedications'),
       'care_preferences:currentMedications', statement_timestamp(), statement_timestamp()
from public.patients p
where nullif(btrim(p.care_preferences->>'currentMedications'),'') is not null
on conflict (patient_id, legacy_source_key) where legacy_source_key is not null do nothing;

alter table public.patients
  add column blood_type_source text not null default 'legacy_patient_profile'
    check (blood_type_source in ('patient_reported','legacy_patient_profile')),
  add column blood_type_reported_by_user_id uuid references auth.users(id) on delete restrict,
  add column blood_type_reported_at timestamptz,
  add column blood_type_verification_status text not null default 'unverified'
    check (blood_type_verification_status in ('unverified','confirmed','rejected','corrected')),
  add column blood_type_reviewed_by_profile_id uuid references public.profiles(id) on delete restrict,
  add column blood_type_reviewed_at timestamptz;

alter table public.patients add constraint patients_blood_type_review_check check (
  (blood_type_verification_status='unverified' and blood_type_reviewed_by_profile_id is null and blood_type_reviewed_at is null)
  or (blood_type_verification_status<>'unverified' and blood_type_reviewed_by_profile_id is not null and blood_type_reviewed_at is not null)
);
alter table public.patients add constraint patients_blood_type_provenance_check check (
  (blood_type_source='legacy_patient_profile' and blood_type_reported_by_user_id is null and blood_type_reported_at is null)
  or (blood_type_source='patient_reported' and blood_type_reported_by_user_id is not null and blood_type_reported_at is not null)
);
revoke update (blood_type) on public.patients from authenticated;

alter table public.patient_reported_health_items enable row level security;
revoke all on public.patient_reported_health_items from public, anon, authenticated;

-- All browser access is through authenticated, session-bound functions. No
-- family policy or provider permission is added to the new report table.
create function public.get_my_reported_health_intake()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'bloodType', coalesce(p.blood_type, 'Unknown'),
    'bloodTypeSource', case when p.blood_type is null then 'not_reported' else p.blood_type_source end,
    'bloodTypeVerificationStatus', p.blood_type_verification_status,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'itemType', i.item_type, 'entryKind', i.entry_kind,
        'name', i.item_name, 'details', i.details, 'source', i.source,
        'verificationStatus', i.verification_status, 'createdAt', i.created_at,
        'updatedAt', i.updated_at
      ) order by i.created_at, i.id)
      from public.patient_reported_health_items i
      where i.patient_id=p.id and i.record_status='active'
    ), '[]'::jsonb)
  ) into result
  from public.patients p
  where p.auth_user_id=auth.uid() and p.status='active';
  if result is null then raise exception 'Patient identity unavailable' using errcode='42501'; end if;
  return result;
end;
$$;

create function public.save_my_reported_blood_type(p_blood_type text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare patient_row public.patients%rowtype;
begin
  if auth.uid() is null or p_blood_type is null or p_blood_type not in ('A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown') then
    raise exception 'Invalid patient-reported blood type' using errcode='22023';
  end if;
  update public.patients p set
    blood_type=p_blood_type,
    blood_type_source='patient_reported',
    blood_type_reported_by_user_id=auth.uid(),
    blood_type_reported_at=statement_timestamp(),
    blood_type_verification_status='unverified',
    blood_type_reviewed_by_profile_id=null,
    blood_type_reviewed_at=null
  where p.auth_user_id=auth.uid() and p.status='active'
  returning p.* into patient_row;
  if not found then raise exception 'Patient identity unavailable' using errcode='42501'; end if;
  return public.get_my_reported_health_intake();
end;
$$;

create function public.add_my_reported_health_item(
  p_item_type text, p_entry_kind text, p_item_name text default null, p_details jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare patient_row public.patients%rowtype; allowed_keys text[];
begin
  if auth.uid() is null or p_item_type not in ('allergy','condition','medication')
    or p_entry_kind not in ('item','none_known','unknown') then
    raise exception 'Invalid reported health item' using errcode='22023';
  end if;
  if p_details is null or jsonb_typeof(p_details)<>'object' then raise exception 'Item details must be an object' using errcode='22023'; end if;
  if p_entry_kind='item' then
    if p_item_name is null or length(btrim(p_item_name)) not between 1 and 160 then raise exception 'A name up to 160 characters is required' using errcode='22023'; end if;
    allowed_keys := case p_item_type when 'allergy' then array['reaction','allergenType']
      when 'condition' then array['context'] else array['dose','frequency','reason'] end;
    if exists(select 1 from jsonb_object_keys(p_details) k where k not in (select unnest(allowed_keys))) then
      raise exception 'Unsupported item detail' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_each(p_details) e where jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}')>240) then
      raise exception 'Item detail is invalid or too long' using errcode='22023';
    end if;
    if p_item_type='allergy' and p_details ? 'allergenType'
      and p_details->>'allergenType' not in ('medication','food','environmental','insect','latex','other','unknown') then
      raise exception 'Invalid allergy type' using errcode='22023';
    end if;
  elsif p_item_name is not null or p_details<>'{}'::jsonb then
    raise exception 'None-known and unknown entries cannot contain item details' using errcode='22023';
  end if;
  select * into patient_row from public.patients p where p.auth_user_id=auth.uid() and p.status='active' for update;
  if not found then raise exception 'Patient identity unavailable' using errcode='42501'; end if;

  if p_entry_kind='item' then
    update public.patient_reported_health_items set record_status='archived', archived_at=statement_timestamp(), updated_at=statement_timestamp()
    where patient_id=patient_row.id and item_type=p_item_type and entry_kind<>'item'
      and record_status='active' and verification_status='unverified';
  else
    if exists(select 1 from public.patient_reported_health_items i where i.patient_id=patient_row.id
      and i.item_type=p_item_type and i.record_status='active' and i.verification_status<>'unverified') then
      raise exception 'Reviewed health information must be updated through a clinical review' using errcode='42501';
    end if;
    update public.patient_reported_health_items set record_status='archived', archived_at=statement_timestamp(), updated_at=statement_timestamp()
    where patient_id=patient_row.id and item_type=p_item_type and record_status='active';
  end if;

  insert into public.patient_reported_health_items(patient_id,reported_by_user_id,item_type,entry_kind,item_name,details)
  values(patient_row.id,auth.uid(),p_item_type,p_entry_kind,nullif(btrim(p_item_name),''),p_details);
  return public.get_my_reported_health_intake();
end;
$$;

create function public.update_my_reported_health_item(p_item_id uuid, p_item_name text, p_details jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare item_row public.patient_reported_health_items%rowtype; allowed_keys text[];
begin
  if auth.uid() is null or p_item_name is null or length(btrim(p_item_name)) not between 1 and 160
    or p_details is null or jsonb_typeof(p_details)<>'object' then
    raise exception 'Invalid reported health item' using errcode='22023';
  end if;
  select i.* into item_row from public.patient_reported_health_items i
  join public.patients p on p.id=i.patient_id
  where i.id=p_item_id and p.auth_user_id=auth.uid() and p.status='active'
    and i.reported_by_user_id=auth.uid() and i.item_type in ('allergy','condition','medication')
    and i.entry_kind='item' and i.record_status='active' and i.verification_status='unverified'
  for update of i;
  if not found then raise exception 'Reported item unavailable' using errcode='42501'; end if;
  allowed_keys := case item_row.item_type when 'allergy' then array['reaction','allergenType']
    when 'condition' then array['context'] else array['dose','frequency','reason'] end;
  if exists(select 1 from jsonb_object_keys(p_details) k where k not in (select unnest(allowed_keys)))
    or exists(select 1 from jsonb_each(p_details) e where jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}')>240) then
    raise exception 'Unsupported or invalid item detail' using errcode='22023';
  end if;
  if item_row.item_type='allergy' and p_details ? 'allergenType'
    and p_details->>'allergenType' not in ('medication','food','environmental','insect','latex','other','unknown') then
    raise exception 'Invalid allergy type' using errcode='22023';
  end if;
  update public.patient_reported_health_items set item_name=btrim(p_item_name),details=p_details,updated_at=statement_timestamp()
  where id=p_item_id;
  return public.get_my_reported_health_intake();
end;
$$;

create function public.archive_my_reported_health_item(p_item_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  update public.patient_reported_health_items i set record_status='archived',archived_at=statement_timestamp(),updated_at=statement_timestamp()
  from public.patients p
  where i.id=p_item_id and p.id=i.patient_id and p.auth_user_id=auth.uid() and p.status='active'
    and i.reported_by_user_id=auth.uid() and i.entry_kind='item' and i.record_status='active' and i.verification_status='unverified';
  if not found then raise exception 'Reported item unavailable' using errcode='42501'; end if;
  return public.get_my_reported_health_intake();
end;
$$;

revoke all on function public.get_my_reported_health_intake() from public,anon;
revoke all on function public.save_my_reported_blood_type(text) from public,anon;
revoke all on function public.add_my_reported_health_item(text,text,text,jsonb) from public,anon;
revoke all on function public.update_my_reported_health_item(uuid,text,jsonb) from public,anon;
revoke all on function public.archive_my_reported_health_item(uuid) from public,anon;
grant execute on function public.get_my_reported_health_intake() to authenticated;
grant execute on function public.save_my_reported_blood_type(text) to authenticated;
grant execute on function public.add_my_reported_health_item(text,text,text,jsonb) to authenticated;
grant execute on function public.update_my_reported_health_item(uuid,text,jsonb) to authenticated;
grant execute on function public.archive_my_reported_health_item(uuid) to authenticated;

commit;
