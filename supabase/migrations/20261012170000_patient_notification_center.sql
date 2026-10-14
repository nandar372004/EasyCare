begin;
set local lock_timeout = '10s';

-- Extend the existing in-app notification model without replacing historical rows.
alter type public.notification_type add value if not exists 'support_message';
alter type public.notification_type add value if not exists 'care_action';

alter table public.notifications
  add column if not exists created_at timestamptz,
  add column if not exists source_key text,
  add column if not exists source_type text,
  add column if not exists source_id uuid;

update public.notifications
set created_at = coalesce(sent_at, statement_timestamp())
where created_at is null;

alter table public.notifications
  alter column created_at set default statement_timestamp(),
  alter column created_at set not null;

alter table public.notifications
  add constraint notifications_source_identity_check check (
    (source_key is null and source_type is null and source_id is null)
    or (source_key is not null and length(btrim(source_key)) between 1 and 240
      and source_type is not null and length(btrim(source_type)) between 1 and 80
      and source_id is not null)
  );

create unique index notifications_source_key_unique
  on public.notifications(source_key) where source_key is not null;
create index notifications_recipient_created_idx
  on public.notifications(recipient_profile_id, created_at desc, id desc);

-- All browser reads and writes use identity-resolving RPCs. Preserve the
-- existing own-recipient SELECT RLS policy and remove the obsolete broad UPDATE
-- policy; authenticated has no direct table privileges after this migration.
drop policy if exists notifications_mark_read on public.notifications;
revoke all on public.notifications from public, anon, authenticated;

create function public.list_my_notifications(p_limit integer default 30, p_offset integer default 0)
returns table (
  id uuid,
  patient_id uuid,
  type public.notification_type,
  title text,
  body text,
  status public.notification_status,
  created_at timestamptz,
  scheduled_at timestamptz,
  sent_at timestamptz,
  read_at timestamptz,
  source_type text,
  source_id uuid
)
language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null or not exists (
    select 1 from public.profiles profile
    join public.patients patient on patient.auth_user_id = profile.id
    where profile.id = caller and profile.role = 'patient' and profile.status = 'active'
      and patient.status = 'active'
  ) then
    raise exception 'Patient notification access required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 or p_offset > 1000000 then
    raise exception 'Notification page is invalid' using errcode = '22023';
  end if;
  return query
    select n.id, n.patient_id, n.type, n.title, n.body, n.status, n.created_at,
      n.scheduled_at, n.sent_at, n.read_at, n.source_type, n.source_id
    from public.notifications n
    where n.recipient_profile_id = caller and n.channel = 'in_app'
      and n.status in ('sent','delivered','read')
    order by n.created_at desc, n.id desc
    limit p_limit offset p_offset;
end;
$$;

create function public.get_my_unread_notification_count()
returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := auth.uid(); result bigint;
begin
  if caller is null or not exists (
    select 1 from public.profiles profile
    join public.patients patient on patient.auth_user_id = profile.id
    where profile.id = caller and profile.role = 'patient' and profile.status = 'active'
      and patient.status = 'active'
  ) then
    raise exception 'Patient notification access required' using errcode = '42501';
  end if;
  select count(*) into result from public.notifications n
  where n.recipient_profile_id = caller and n.channel = 'in_app'
    and n.status in ('sent','delivered') and n.read_at is null;
  return result;
end;
$$;

-- Retains the established RPC name while fixing Staging's missing-function drift.
create or replace function public.mark_notification_read(target_notification_id uuid)
returns public.notifications
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); result public.notifications;
begin
  if caller is null or not exists (
    select 1 from public.profiles profile
    join public.patients patient on patient.auth_user_id = profile.id
    where profile.id = caller and profile.role = 'patient' and profile.status = 'active'
      and patient.status = 'active'
  ) then
    raise exception 'Notification unavailable' using errcode = '42501';
  end if;
  update public.notifications n
  set read_at = coalesce(n.read_at, statement_timestamp()), status = 'read'
  where n.id = target_notification_id and n.recipient_profile_id = caller
    and n.channel = 'in_app' and n.status in ('sent','delivered','read')
  returning n.* into result;
  if not found then raise exception 'Notification unavailable' using errcode = '42501'; end if;
  return result;
end;
$$;

create function public.mark_all_my_notifications_read()
returns integer
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); changed integer;
begin
  if caller is null or not exists (
    select 1 from public.profiles profile
    join public.patients patient on patient.auth_user_id = profile.id
    where profile.id = caller and profile.role = 'patient' and profile.status = 'active'
      and patient.status = 'active'
  ) then
    raise exception 'Patient notification access required' using errcode = '42501';
  end if;
  update public.notifications n
  set read_at = coalesce(n.read_at, statement_timestamp()), status = 'read'
  where n.recipient_profile_id = caller and n.channel = 'in_app'
    and n.status in ('sent','delivered') and n.read_at is null;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.list_my_notifications(integer, integer) from public, anon;
revoke all on function public.get_my_unread_notification_count() from public, anon;
revoke all on function public.mark_notification_read(uuid) from public, anon;
revoke all on function public.mark_all_my_notifications_read() from public, anon;
grant execute on function public.list_my_notifications(integer, integer) to authenticated;
grant execute on function public.get_my_unread_notification_count() to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_my_notifications_read() to authenticated;

-- The support-message RPC remains the writer and authorization boundary. This
-- trigger converts only a reply from the currently designated assignee into a
-- minimal patient notification; the chat body is never copied into it.
create function public.create_support_reply_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_patient uuid; target_profile uuid;
begin
  select conversation.patient_id, patient.auth_user_id
    into target_patient, target_profile
  from public.support_conversations conversation
  join public.patients patient on patient.id = conversation.patient_id
  join public.profiles patient_profile on patient_profile.id = patient.auth_user_id
  join public.profiles support_profile on support_profile.id = conversation.assigned_support_profile_id
  join public.support_routing_settings setting on setting.singleton = true
    and setting.support_profile_id = conversation.assigned_support_profile_id
  where conversation.id = new.conversation_id
    and conversation.assigned_support_profile_id = new.sender_profile_id
    and patient.status = 'active' and patient_profile.role = 'patient' and patient_profile.status = 'active'
    and support_profile.role in ('admin','main_admin') and support_profile.status = 'active';
  if target_profile is null then return new; end if;

  insert into public.notifications
    (recipient_profile_id, patient_id, type, channel, title, body, status, sent_at,
      source_key, source_type, source_id)
  values
    (target_profile, target_patient, 'support_message', 'in_app',
      'New message from Care Coordinator', 'You have a new message.', 'sent', statement_timestamp(),
      'support-message:' || new.id::text, 'support_message', new.id)
  on conflict (source_key) where source_key is not null do nothing;
  return new;
end;
$$;
revoke all on function public.create_support_reply_notification() from public, anon, authenticated;
drop trigger if exists support_reply_notification_after_insert on public.support_messages;
create trigger support_reply_notification_after_insert
  after insert on public.support_messages for each row
  execute function public.create_support_reply_notification();

-- A clinician-created, explicitly open/escalated alert can produce one generic
-- patient care action. This does not infer risk or expose alert text.
create function public.create_monitoring_alert_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_profile uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if new.status::text not in ('open','escalated') then return new; end if;
  select patient.auth_user_id into target_profile
  from public.patients patient join public.profiles profile on profile.id = patient.auth_user_id
  where patient.id = new.patient_id and patient.status = 'active'
    and profile.role = 'patient' and profile.status = 'active';
  if target_profile is null then return new; end if;

  insert into public.notifications
    (recipient_profile_id, patient_id, type, channel, title, body, status, sent_at,
      source_key, source_type, source_id)
  values
    (target_profile, new.patient_id, 'care_action', 'in_app',
      'A care item needs your attention', 'Please review your health dashboard.', 'sent', statement_timestamp(),
      'monitoring-alert:' || new.id::text, 'monitoring_alert', new.id)
  on conflict (source_key) where source_key is not null do nothing;
  return new;
end;
$$;
revoke all on function public.create_monitoring_alert_notification() from public, anon, authenticated;
drop trigger if exists monitoring_alert_notification_after_change on public.monitoring_alerts;
create trigger monitoring_alert_notification_after_change
  after insert or update of status on public.monitoring_alerts for each row
  execute function public.create_monitoring_alert_notification();

-- Private per-profile notification refresh channel. No notification content is
-- broadcast; the patient reloads canonical RPC data after receiving a hint.
create function public.can_receive_my_notification_topic(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and p_topic = 'notifications:' || auth.uid()::text
    and exists (
      select 1 from public.profiles profile
      join public.patients patient on patient.auth_user_id = profile.id
      where profile.id = auth.uid() and profile.role = 'patient'
        and profile.status = 'active' and patient.status = 'active'
    )
$$;
revoke all on function public.can_receive_my_notification_topic(text) from public, anon, authenticated;
grant execute on function public.can_receive_my_notification_topic(text) to authenticated;

create function public.broadcast_notification_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.channel = 'in_app' and new.recipient_profile_id is not null then
    begin
      perform realtime.send(
        jsonb_build_object('event','notification_changed'),
        'notification_changed',
        'notifications:' || new.recipient_profile_id::text,
        true
      );
    exception when others then
      -- Persisted notifications remain authoritative if Broadcast is offline.
      null;
    end;
  end if;
  return new;
end;
$$;
revoke all on function public.broadcast_notification_changed() from public, anon, authenticated;
drop trigger if exists notification_broadcast_after_insert on public.notifications;
create trigger notification_broadcast_after_insert
  after insert on public.notifications for each row
  execute function public.broadcast_notification_changed();

create policy patient_notification_private_broadcast_read
  on realtime.messages for select to authenticated
  using (
    extension = 'broadcast'
    and topic = (select realtime.topic())
    and public.can_receive_my_notification_topic((select realtime.topic()))
  );

commit;
