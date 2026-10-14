begin;
-- Ownership RLS does not restrict writable fields. Recipients get one operation.
drop policy notifications_mark_read on public.notifications;
revoke update on public.notifications from public,anon,authenticated;
-- Table revocation alone does not remove separately granted column UPDATE rights.
do $$
declare columns_sql text;
begin
  select string_agg(quote_ident(attname),', ' order by attnum) into columns_sql
  from pg_attribute where attrelid='public.notifications'::regclass
    and attnum>0 and not attisdropped;
  execute format('revoke update (%s) on public.notifications from public, anon, authenticated',columns_sql);
end;
$$;
create function public.mark_notification_read(target_notification_id uuid)
returns public.notifications language plpgsql security definer set search_path = '' as $$
declare result public.notifications;
begin
  if auth.uid() is null then
    raise exception 'Notification unavailable' using errcode='42501';
  end if;
  update public.notifications n
  set read_at=coalesce(n.read_at,statement_timestamp()),status='read'
  where n.id=target_notification_id and n.recipient_profile_id=auth.uid()
  returning n.* into result;
  if not found then
    raise exception 'Notification unavailable' using errcode='42501';
  end if;
  return result;
end;
$$;
revoke all on function public.mark_notification_read(uuid) from public,anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;
-- SELECT ownership, service_role grants and system delivery updates are unchanged.
-- No data backfill, arbitrary timestamps, content parameters or mark-unread path.
commit;
