-- Read-only administrator audit; state differences are review candidates, not proof of abuse.
select * from pg_policies where schemaname='public' and tablename='notifications';
select * from information_schema.table_privileges
where table_schema='public' and table_name='notifications';
select * from information_schema.column_privileges
where table_schema='public' and table_name='notifications' and privilege_type='UPDATE';
select pg_get_triggerdef(oid) as definition from pg_trigger
where tgrelid='public.notifications'::regclass and not tgisinternal;
select p.proname,p.proacl,p.proconfig,pg_get_functiondef(p.oid) as definition
from pg_proc p where p.pronamespace='public'::regnamespace
and (p.proname ilike '%notification%' or pg_get_functiondef(p.oid) ilike '%public.notifications%')
and p.prokind='f';
select id,status,read_at,sent_at,scheduled_at,
  case when status='read' and read_at is null then 'read_status_without_timestamp'
       when status<>'read' and read_at is not null then 'timestamp_without_read_status'
       when read_at>statement_timestamp() then 'future_read_timestamp'
       when read_at<sent_at then 'read_before_sent' end as review_reason
from public.notifications
where (status='read' and read_at is null) or (status<>'read' and read_at is not null)
   or read_at>statement_timestamp() or read_at<sent_at;
