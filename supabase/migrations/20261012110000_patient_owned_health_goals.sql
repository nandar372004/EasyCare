begin;
set local lock_timeout = '10s';

create table public.patient_health_goals (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  title text not null check (char_length(regexp_replace(title, '^[[:space:]]+|[[:space:]]+$', '', 'g')) between 1 and 200),
  is_completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint patient_health_goals_completion_consistent
    check (is_completed = (completed_at is not null))
);

create index patient_health_goals_owner_order_idx
  on public.patient_health_goals(patient_id, created_at, id);

alter table public.patient_health_goals enable row level security;
revoke all on public.patient_health_goals from public, anon, authenticated;
grant select on public.patient_health_goals to authenticated;

create policy patient_health_goals_read_own
  on public.patient_health_goals for select to authenticated
  using (exists (
    select 1 from public.patients p
    where p.id = patient_health_goals.patient_id
      and p.auth_user_id = (select auth.uid())
  ));

create function public.create_my_patient_health_goal(p_title text)
returns public.patient_health_goals
language plpgsql security definer set search_path = '' as $$
declare
  owner_patient_id uuid;
  result public.patient_health_goals;
  normalized_title text;
begin
  if auth.uid() is null then
    raise exception 'Authenticated patient required' using errcode = '42501';
  end if;
  normalized_title := regexp_replace(coalesce(p_title, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if char_length(normalized_title) < 1 or char_length(normalized_title) > 200 then
    raise exception 'Goal must contain 1 to 200 characters' using errcode = '22023';
  end if;

  select p.id into owner_patient_id
  from public.patients p
  where p.auth_user_id = auth.uid() and p.status = 'active'
  for key share;
  if not found then
    raise exception 'Authenticated patient required' using errcode = '42501';
  end if;

  insert into public.patient_health_goals(patient_id, title)
  values (owner_patient_id, normalized_title)
  returning * into result;
  return result;
end;
$$;

create function public.set_my_patient_health_goal_completion(p_goal_id uuid, p_is_completed boolean)
returns public.patient_health_goals
language plpgsql security definer set search_path = '' as $$
declare
  owner_patient_id uuid;
  result public.patient_health_goals;
begin
  if auth.uid() is null then
    raise exception 'Authenticated patient required' using errcode = '42501';
  end if;
  if p_goal_id is null or p_is_completed is null then
    raise exception 'A goal and completion state are required' using errcode = '22023';
  end if;
  select p.id into owner_patient_id
  from public.patients p
  where p.auth_user_id = auth.uid() and p.status = 'active';
  if not found then
    raise exception 'Authenticated patient required' using errcode = '42501';
  end if;

  update public.patient_health_goals g
  set is_completed = p_is_completed,
      completed_at = case when p_is_completed then statement_timestamp() else null end,
      updated_at = statement_timestamp()
  where g.id = p_goal_id and g.patient_id = owner_patient_id
  returning g.* into result;
  if not found then
    raise exception 'Goal is unavailable to authenticated patient' using errcode = '42501';
  end if;
  return result;
end;
$$;

create function public.delete_my_patient_health_goal(p_goal_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  owner_patient_id uuid;
begin
  if auth.uid() is null or p_goal_id is null then
    raise exception 'Authenticated patient goal required' using errcode = '42501';
  end if;
  select p.id into owner_patient_id
  from public.patients p
  where p.auth_user_id = auth.uid() and p.status = 'active';
  if not found then
    raise exception 'Authenticated patient required' using errcode = '42501';
  end if;

  delete from public.patient_health_goals g
  where g.id = p_goal_id and g.patient_id = owner_patient_id;
  if not found then
    raise exception 'Goal is unavailable to authenticated patient' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.create_my_patient_health_goal(text) from public, anon;
revoke all on function public.set_my_patient_health_goal_completion(uuid, boolean) from public, anon;
revoke all on function public.delete_my_patient_health_goal(uuid) from public, anon;
grant execute on function public.create_my_patient_health_goal(text) to authenticated;
grant execute on function public.set_my_patient_health_goal_completion(uuid, boolean) to authenticated;
grant execute on function public.delete_my_patient_health_goal(uuid) to authenticated;

comment on table public.patient_health_goals is
  'Personal health goals created and managed by the owning patient; separate from clinician-authored care plan goals.';
comment on function public.create_my_patient_health_goal(text) is
  'Creates a personal health goal for the patient resolved from auth.uid(); clients cannot choose the owner.';
comment on function public.set_my_patient_health_goal_completion(uuid, boolean) is
  'Completes or reopens a personal health goal owned by the authenticated patient.';
comment on function public.delete_my_patient_health_goal(uuid) is
  'Deletes only a personal health goal owned by the authenticated patient.';

commit;
