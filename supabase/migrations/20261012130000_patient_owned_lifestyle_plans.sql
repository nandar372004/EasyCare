begin;
set local lock_timeout = '10s';

create table public.patient_lifestyle_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 4000),
  category text check (category is null or category in ('nutrition','exercise','sleep','posture','stress','general_wellness','other')),
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint patient_lifestyle_plans_id_patient_unique unique (id, patient_id)
);

create table public.patient_lifestyle_resources (
  id uuid primary key default gen_random_uuid(),
  lifestyle_plan_id uuid not null,
  patient_id uuid not null,
  title text check (title is null or char_length(btrim(title)) between 1 and 200),
  url text not null check (char_length(url) between 1 and 2048 and url ~* '^https?://' and url !~ '[[:space:][:cntrl:]]'),
  resource_type text not null check (resource_type in ('youtube','website')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint patient_lifestyle_resources_plan_owner_fk foreign key (lifestyle_plan_id, patient_id)
    references public.patient_lifestyle_plans(id, patient_id) on delete cascade
);

create index patient_lifestyle_plans_owner_active_idx
  on public.patient_lifestyle_plans(patient_id, is_active, created_at, id);
create index patient_lifestyle_resources_plan_idx
  on public.patient_lifestyle_resources(lifestyle_plan_id, created_at, id);

alter table public.patient_lifestyle_plans enable row level security;
alter table public.patient_lifestyle_resources enable row level security;

revoke all on public.patient_lifestyle_plans, public.patient_lifestyle_resources from public, anon, authenticated;
grant select on public.patient_lifestyle_plans, public.patient_lifestyle_resources to authenticated;

create policy patient_lifestyle_plans_read_own on public.patient_lifestyle_plans
  for select to authenticated using (exists (
    select 1 from public.patients p where p.id=patient_lifestyle_plans.patient_id and p.auth_user_id=(select auth.uid())
  ));
create policy patient_lifestyle_resources_read_own on public.patient_lifestyle_resources
  for select to authenticated using (exists (
    select 1 from public.patients p where p.id=patient_lifestyle_resources.patient_id and p.auth_user_id=(select auth.uid())
  ));

create function public.save_my_patient_lifestyle_plan(
  p_plan_id uuid, p_title text, p_description text, p_category text
) returns public.patient_lifestyle_plans
language plpgsql security definer set search_path = '' as $$
declare
  owner_patient_id uuid;
  result public.patient_lifestyle_plans;
  normalized_title text := btrim(coalesce(p_title,''));
  normalized_description text := nullif(btrim(coalesce(p_description,'')),'');
  normalized_category text := nullif(btrim(coalesce(p_category,'')),'');
begin
  if auth.uid() is null then raise exception 'Authenticated patient required' using errcode='42501'; end if;
  select p.id into owner_patient_id from public.patients p where p.auth_user_id=auth.uid() and p.status='active' for key share;
  if not found then raise exception 'Authenticated patient required' using errcode='42501'; end if;
  if char_length(normalized_title) not between 1 and 200 or char_length(coalesce(normalized_description,'')) > 4000
      or (normalized_category is not null and normalized_category not in ('nutrition','exercise','sleep','posture','stress','general_wellness','other')) then
    raise exception 'Lifestyle plan details are invalid' using errcode='22023';
  end if;
  if p_plan_id is null then
    insert into public.patient_lifestyle_plans(patient_id,title,description,category)
      values(owner_patient_id,normalized_title,normalized_description,normalized_category) returning * into result;
  else
    update public.patient_lifestyle_plans lp set title=normalized_title,description=normalized_description,
      category=normalized_category,updated_at=statement_timestamp()
      where lp.id=p_plan_id and lp.patient_id=owner_patient_id and lp.is_active returning * into result;
    if not found then raise exception 'Lifestyle plan is unavailable' using errcode='42501'; end if;
  end if;
  return result;
end;
$$;

create function public.deactivate_my_patient_lifestyle_plan(p_plan_id uuid)
returns public.patient_lifestyle_plans
language plpgsql security definer set search_path = '' as $$
declare owner_patient_id uuid; result public.patient_lifestyle_plans;
begin
  if auth.uid() is null or p_plan_id is null then raise exception 'Authenticated patient plan required' using errcode='42501'; end if;
  select p.id into owner_patient_id from public.patients p where p.auth_user_id=auth.uid() and p.status='active';
  if not found then raise exception 'Authenticated patient required' using errcode='42501'; end if;
  update public.patient_lifestyle_plans lp set is_active=false,updated_at=statement_timestamp()
    where lp.id=p_plan_id and lp.patient_id=owner_patient_id and lp.is_active returning * into result;
  if not found then raise exception 'Lifestyle plan is unavailable' using errcode='42501'; end if;
  return result;
end;
$$;

create function public.save_my_patient_lifestyle_resource(
  p_plan_id uuid, p_resource_id uuid, p_title text, p_url text
) returns public.patient_lifestyle_resources
language plpgsql security definer set search_path = '' as $$
declare
  owner_patient_id uuid;
  result public.patient_lifestyle_resources;
  normalized_url text := btrim(coalesce(p_url,''));
  normalized_title text := nullif(btrim(coalesce(p_title,'')),'');
  resource_host text;
  resource_port text;
  normalized_type text;
begin
  if auth.uid() is null then raise exception 'Authenticated patient required' using errcode='42501'; end if;
  select p.id into owner_patient_id from public.patients p where p.auth_user_id=auth.uid() and p.status='active';
  if not found then raise exception 'Authenticated patient required' using errcode='42501'; end if;
  if p_plan_id is null or char_length(normalized_url) not between 1 and 2048
      or normalized_url !~* '^https?://' or normalized_url ~ '[[:space:][:cntrl:]]'
      or char_length(coalesce(normalized_title,'')) > 200 then
    raise exception 'Enter a valid HTTP or HTTPS resource URL and title' using errcode='22023';
  end if;
  resource_host := lower(split_part(regexp_replace(normalized_url,'^https?://','','i'),'/',1));
  resource_host := split_part(resource_host,'?',1);
  resource_host := split_part(resource_host,'#',1);
  if resource_host !~* '^([a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(:[0-9]{1,5})?$'
      or position('@' in resource_host) > 0 then
    raise exception 'Enter a valid HTTP or HTTPS resource URL' using errcode='22023';
  end if;
  resource_port := nullif(substring(resource_host from ':([0-9]+)$'),'');
  if resource_port is not null and resource_port::integer > 65535 then
    raise exception 'Enter a valid HTTP or HTTPS resource URL' using errcode='22023';
  end if;
  normalized_type := case when regexp_replace(resource_host,':[0-9]+$','') in
    ('youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be') then 'youtube' else 'website' end;
  if not exists(select 1 from public.patient_lifestyle_plans lp where lp.id=p_plan_id and lp.patient_id=owner_patient_id and lp.is_active) then
    raise exception 'Lifestyle plan is unavailable' using errcode='42501';
  end if;
  if p_resource_id is null then
    insert into public.patient_lifestyle_resources(lifestyle_plan_id,patient_id,title,url,resource_type)
      values(p_plan_id,owner_patient_id,normalized_title,normalized_url,normalized_type) returning * into result;
  else
    update public.patient_lifestyle_resources r set title=normalized_title,url=normalized_url,resource_type=normalized_type,
      updated_at=statement_timestamp()
      where r.id=p_resource_id and r.lifestyle_plan_id=p_plan_id and r.patient_id=owner_patient_id returning * into result;
    if not found then raise exception 'Lifestyle resource is unavailable' using errcode='42501'; end if;
  end if;
  return result;
end;
$$;

create function public.delete_my_patient_lifestyle_resource(p_plan_id uuid, p_resource_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare owner_patient_id uuid;
begin
  if auth.uid() is null or p_plan_id is null or p_resource_id is null then raise exception 'Authenticated patient resource required' using errcode='42501'; end if;
  select p.id into owner_patient_id from public.patients p where p.auth_user_id=auth.uid() and p.status='active';
  if not found then raise exception 'Authenticated patient required' using errcode='42501'; end if;
  delete from public.patient_lifestyle_resources r using public.patient_lifestyle_plans lp
    where r.id=p_resource_id and r.lifestyle_plan_id=p_plan_id and r.patient_id=owner_patient_id
      and lp.id=r.lifestyle_plan_id and lp.patient_id=owner_patient_id and lp.is_active;
  if not found then raise exception 'Lifestyle resource is unavailable' using errcode='42501'; end if;
end;
$$;

revoke all on function public.save_my_patient_lifestyle_plan(uuid,text,text,text) from public, anon;
revoke all on function public.deactivate_my_patient_lifestyle_plan(uuid) from public, anon;
revoke all on function public.save_my_patient_lifestyle_resource(uuid,uuid,text,text) from public, anon;
revoke all on function public.delete_my_patient_lifestyle_resource(uuid,uuid) from public, anon;
grant execute on function public.save_my_patient_lifestyle_plan(uuid,text,text,text) to authenticated;
grant execute on function public.deactivate_my_patient_lifestyle_plan(uuid) to authenticated;
grant execute on function public.save_my_patient_lifestyle_resource(uuid,uuid,text,text) to authenticated;
grant execute on function public.delete_my_patient_lifestyle_resource(uuid,uuid) to authenticated;

comment on table public.patient_lifestyle_plans is 'Patient-authored lifestyle plans, separate from clinician care plans.';
comment on table public.patient_lifestyle_resources is 'Patient-managed HTTP(S) resources attached to a patient lifestyle plan.';

commit;
