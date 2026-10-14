begin;
set local lock_timeout = '10s';

-- Realtime subscription authorization uses auth.uid() and the requested
-- private topic. It returns only a boolean; message content remains RPC-only.
create or replace function public.can_receive_support_realtime_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or p_topic is null then
    return false;
  end if;

  if p_topic = 'support:admin:' || caller::text then
    return exists (
      select 1
      from public.support_routing_settings setting
      join public.profiles profile on profile.id = setting.support_profile_id
      where setting.singleton = true
        and setting.support_profile_id = caller
        and profile.status = 'active'
        and profile.role in ('admin', 'main_admin')
    );
  end if;

  return exists (
    select 1
    from public.support_conversations conversation
    where p_topic = 'support:' || conversation.id::text
      and (
        (
          conversation.assigned_support_profile_id = caller
          and exists (
            select 1
            from public.support_routing_settings setting
            join public.profiles profile on profile.id = setting.support_profile_id
            where setting.singleton = true
              and setting.support_profile_id = caller
              and profile.status = 'active'
              and profile.role in ('admin', 'main_admin')
          )
        )
        or exists (
          select 1
          from public.patients patient
          join public.profiles profile on profile.id = patient.auth_user_id
          where patient.id = conversation.patient_id
            and patient.auth_user_id = caller
            and profile.role = 'patient'
            and profile.status = 'active'
        )
      )
  );
end;
$$;

revoke all on function public.can_receive_support_realtime_topic(text) from public, anon, authenticated;
grant execute on function public.can_receive_support_realtime_topic(text) to authenticated;

-- Private broadcast read authorization only. Clients receive a notification
-- and must use their existing RPC for the actual message history. No insert
-- policy is granted, so clients cannot publish their own chat events.
create policy support_chat_private_broadcast_read
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'broadcast'
    and topic = (select realtime.topic())
    and public.can_receive_support_realtime_topic((select realtime.topic()))
  );

create or replace function public.broadcast_support_message_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  support_profile uuid;
  event_payload jsonb := jsonb_build_object(
    'conversation_id', new.conversation_id::text,
    'event', 'message_changed'
  );
begin
  select conversation.assigned_support_profile_id
    into support_profile
    from public.support_conversations conversation
    where conversation.id = new.conversation_id;

  if support_profile is null then
    return new;
  end if;

  begin
    perform realtime.send(
      event_payload,
      'message_changed',
      'support:' || new.conversation_id::text,
      true
    );
  exception when others then
    -- Realtime is only a hint; failure must not block the durable RPC write.
    null;
  end;

  begin
    perform realtime.send(
      event_payload,
      'message_changed',
      'support:admin:' || support_profile::text,
      true
    );
  exception when others then
    -- Realtime is only a hint; the RPC remains the source of truth.
    null;
  end;

  return new;
end;
$$;

revoke all on function public.broadcast_support_message_changed() from public, anon, authenticated;

drop trigger if exists support_message_broadcast_after_insert on public.support_messages;
create trigger support_message_broadcast_after_insert
  after insert on public.support_messages
  for each row execute function public.broadcast_support_message_changed();

commit;
