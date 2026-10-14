begin;
set local lock_timeout = '10s';

-- Explicit routing configuration. It intentionally starts empty; an active
-- administrator must designate the support recipient through the RPC below.
create table public.support_routing_settings (
  singleton boolean primary key default true check (singleton),
  support_profile_id uuid not null references public.profiles(id) on delete restrict,
  updated_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default statement_timestamp()
);

create table public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  assigned_support_profile_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create unique index support_conversations_one_active_per_patient
  on public.support_conversations(patient_id) where status='active';
create index support_conversations_assignee_updated_idx
  on public.support_conversations(assigned_support_profile_id, updated_at desc);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  sender_profile_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (
    char_length(regexp_replace(body,'^[[:space:]]+|[[:space:]]+$','','g')) between 1 and 4000
    and body=regexp_replace(body,'^[[:space:]]+|[[:space:]]+$','','g')
  ),
  created_at timestamptz not null default statement_timestamp(),
  read_at timestamptz
);

create index support_messages_conversation_created_idx
  on public.support_messages(conversation_id, created_at, id);

alter table public.support_routing_settings enable row level security;
alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;

-- Browser access goes only through the checked RPCs. No direct table read or
-- write grants are introduced for anon/authenticated.
revoke all on public.support_routing_settings, public.support_conversations, public.support_messages
  from public, anon, authenticated;

create function public.admin_set_designated_support_profile(p_support_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or not public.is_main_admin() then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id=p_support_profile_id
      and p.status='active'
      and p.role in ('admin','main_admin')
  ) then
    raise exception 'Support recipient must be an active administrator' using errcode='22023';
  end if;

  insert into public.support_routing_settings(singleton, support_profile_id, updated_by_profile_id)
  values (true, p_support_profile_id, caller)
  on conflict (singleton) do update
    set support_profile_id=excluded.support_profile_id,
        updated_by_profile_id=excluded.updated_by_profile_id,
        updated_at=statement_timestamp();

  -- Keep existing open conversations assigned to the explicitly configured
  -- support account when the administrator changes the routing target.
  update public.support_conversations
    set assigned_support_profile_id=p_support_profile_id,
        updated_at=statement_timestamp()
    where status='active'
      and assigned_support_profile_id is distinct from p_support_profile_id;
end
$$;

create function public.get_or_create_my_support_conversation()
returns table(conversation_id uuid, conversation_status text, created_at timestamptz, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  patient uuid;
  support_profile uuid;
begin
  if caller is null or not exists (
    select 1 from public.profiles p where p.id=caller and p.role='patient' and p.status='active'
  ) then
    raise exception 'Patient authentication required' using errcode='42501';
  end if;
  select p.id into patient
    from public.patients p where p.auth_user_id=caller;
  if not found then
    raise exception 'Patient identity is unavailable' using errcode='42501';
  end if;
  select s.support_profile_id into support_profile
    from public.support_routing_settings s
    join public.profiles admin_profile on admin_profile.id=s.support_profile_id
    where s.singleton=true and admin_profile.status='active'
      and admin_profile.role in ('admin','main_admin');
  if not found then
    raise exception 'Care Coordinator messaging is not configured' using errcode='55000';
  end if;

  select c.id,c.status,c.created_at,c.updated_at
    into conversation_id,conversation_status,created_at,updated_at
    from public.support_conversations c
    where c.patient_id=patient and c.status='active';
  if found then
    return next;
    return;
  end if;

  insert into public.support_conversations as inserted(patient_id, assigned_support_profile_id)
    values (patient,support_profile)
    on conflict (patient_id) where status='active' do nothing
    returning inserted.id,inserted.status,inserted.created_at,inserted.updated_at
      into conversation_id,conversation_status,created_at,updated_at;
  if not found then
    select c.id,c.status,c.created_at,c.updated_at
      into conversation_id,conversation_status,created_at,updated_at
      from public.support_conversations c
      where c.patient_id=patient and c.status='active';
  end if;
  return next;
end
$$;

create function public.list_my_support_messages(p_conversation_id uuid)
returns table(message_id uuid, body text, sender_is_patient boolean, created_at timestamptz, read_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or not exists (
    select 1 from public.support_conversations c
    join public.patients p on p.id=c.patient_id
    join public.profiles profile on profile.id=caller and profile.role='patient' and profile.status='active'
    where c.id=p_conversation_id and p.auth_user_id=caller
  ) then
    raise exception 'Conversation is not available' using errcode='42501';
  end if;
  return query
    select m.id,m.body,(m.sender_profile_id=caller),m.created_at,m.read_at
    from public.support_messages m
    where m.conversation_id=p_conversation_id
    order by m.created_at,m.id;
end
$$;

create function public.send_my_support_message(p_conversation_id uuid, p_body text)
returns table(message_id uuid, body text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  patient uuid;
  new_message public.support_messages%rowtype;
  clean_body text := regexp_replace(coalesce(p_body,''),'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if caller is null or not exists (
    select 1 from public.profiles p where p.id=caller and p.role='patient' and p.status='active'
  ) then
    raise exception 'Patient authentication required' using errcode='42501';
  end if;
  if clean_body is null or char_length(clean_body) not between 1 and 4000 then
    raise exception 'Message must contain 1 to 4000 characters' using errcode='22023';
  end if;
  select p.id into patient from public.patients p where p.auth_user_id=caller;
  if not found then
    raise exception 'Patient identity is unavailable' using errcode='42501';
  end if;

  update public.support_conversations c
    set updated_at=statement_timestamp()
    where c.id=p_conversation_id and c.patient_id=patient and c.status='active'
      and exists (
        select 1 from public.profiles support_profile
        where support_profile.id=c.assigned_support_profile_id
          and support_profile.status='active'
          and support_profile.role in ('admin','main_admin')
      );
  if not found then
    raise exception 'Conversation is not available' using errcode='42501';
  end if;

  insert into public.support_messages(conversation_id,sender_profile_id,body)
    values (p_conversation_id,caller,clean_body)
    returning * into new_message;
  return query select new_message.id,new_message.body,new_message.created_at;
end
$$;

create function public.admin_list_support_conversations()
returns table(conversation_id uuid, patient_id uuid, patient_name text, status text,
  created_at timestamptz, updated_at timestamptz, latest_message text, latest_message_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or not public.is_main_admin() or not exists (
    select 1 from public.support_routing_settings s
    where s.singleton=true and s.support_profile_id=caller
  ) then
    raise exception 'Designated support administrator access required' using errcode='42501';
  end if;
  return query
    select c.id,c.patient_id,profile.full_name,c.status,c.created_at,c.updated_at,
      latest.body,latest.created_at
    from public.support_conversations c
    join public.patients patient on patient.id=c.patient_id
    left join public.profiles profile on profile.id=patient.auth_user_id
    left join lateral (
      select m.body,m.created_at from public.support_messages m
      where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1
    ) latest on true
    where c.assigned_support_profile_id=caller
    order by coalesce(latest.created_at,c.updated_at) desc,c.id;
end
$$;

create function public.admin_list_support_messages(p_conversation_id uuid)
returns table(message_id uuid, body text, sender_is_support boolean, created_at timestamptz, read_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or not public.is_main_admin() or not exists (
    select 1 from public.support_conversations c
    where c.id=p_conversation_id and c.assigned_support_profile_id=caller
  ) then
    raise exception 'Conversation is not available' using errcode='42501';
  end if;
  return query
    select m.id,m.body,(m.sender_profile_id=caller),m.created_at,m.read_at
    from public.support_messages m
    where m.conversation_id=p_conversation_id
    order by m.created_at,m.id;
end
$$;

create function public.admin_send_support_reply(p_conversation_id uuid, p_body text)
returns table(message_id uuid, body text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  clean_body text := regexp_replace(coalesce(p_body,''),'^[[:space:]]+|[[:space:]]+$','','g');
  new_message public.support_messages%rowtype;
begin
  if caller is null or not public.is_main_admin() then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  if clean_body is null or char_length(clean_body) not between 1 and 4000 then
    raise exception 'Message must contain 1 to 4000 characters' using errcode='22023';
  end if;

  update public.support_conversations c
    set updated_at=statement_timestamp()
    where c.id=p_conversation_id and c.assigned_support_profile_id=caller and c.status='active';
  if not found then
    raise exception 'Conversation is not available' using errcode='42501';
  end if;

  insert into public.support_messages(conversation_id,sender_profile_id,body)
    values (p_conversation_id,caller,clean_body)
    returning * into new_message;
  return query select new_message.id,new_message.body,new_message.created_at;
end
$$;

revoke all on function public.admin_set_designated_support_profile(uuid) from public,anon,authenticated;
revoke all on function public.get_or_create_my_support_conversation() from public,anon,authenticated;
revoke all on function public.list_my_support_messages(uuid) from public,anon,authenticated;
revoke all on function public.send_my_support_message(uuid,text) from public,anon,authenticated;
revoke all on function public.admin_list_support_conversations() from public,anon,authenticated;
revoke all on function public.admin_list_support_messages(uuid) from public,anon,authenticated;
revoke all on function public.admin_send_support_reply(uuid,text) from public,anon,authenticated;

grant execute on function public.admin_set_designated_support_profile(uuid) to authenticated;
grant execute on function public.get_or_create_my_support_conversation() to authenticated;
grant execute on function public.list_my_support_messages(uuid) to authenticated;
grant execute on function public.send_my_support_message(uuid,text) to authenticated;
grant execute on function public.admin_list_support_conversations() to authenticated;
grant execute on function public.admin_list_support_messages(uuid) to authenticated;
grant execute on function public.admin_send_support_reply(uuid,text) to authenticated;

commit;
