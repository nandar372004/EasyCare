begin;
set local lock_timeout='10s';
create temporary table wellness_verification(result jsonb);
do $$
declare owner_id uuid; first_count integer; second_count integer; before_count bigint; after_count bigint;
  list_count integer; day text := (statement_timestamp() at time zone 'Asia/Yangon')::date::text;
  other_id uuid; own_notice uuid; foreign_notice uuid; denial boolean;
begin
  select p.auth_user_id into owner_id from public.patients p join public.profiles f on f.id=p.auth_user_id
    where p.id='2d329d5b-9093-45ca-a980-97466d2a71eb' and p.status='active' and f.role='patient' and f.status='active';
  if owner_id is null then raise exception 'Existing presentation patient identity unavailable'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  before_count:=public.get_my_unread_notification_count();
  first_count:=public.create_my_daily_cervical_wellness_notifications();
  second_count:=public.create_my_daily_cervical_wellness_notifications();
  after_count:=public.get_my_unread_notification_count();
  select count(*) into list_count from public.list_my_notifications(100,0)
    where source_type in ('cervical_wellness','cervical_wellness_medication') and (created_at at time zone 'Asia/Yangon')::date::text=day;
  if second_count<>0 or list_count<>10 or after_count-before_count<>first_count then raise exception 'Daily persistence/count/list verification failed'; end if;
  select id into own_notice from public.list_my_notifications(100,0) where source_type='cervical_wellness' limit 1;
  denial:=false;
  begin execute 'insert into public.notifications(title) values (''forbidden verification write'')';
  exception when insufficient_privilege then denial:=true; end;
  if not denial then raise exception 'Direct notification writes unexpectedly allowed'; end if;
  execute 'reset role';
  if (select count(*) from public.notifications where source_key like 'cervical-wellness:2d329d5b-9093-45ca-a980-97466d2a71eb:'||day||':%')<>10 then raise exception 'Wrong daily source set'; end if;
  if exists(select 1 from public.notifications where source_key like 'cervical-wellness:2d329d5b-9093-45ca-a980-97466d2a71eb:'||day||':%'
    and (recipient_profile_id<>owner_id or patient_id<>'2d329d5b-9093-45ca-a980-97466d2a71eb'::uuid or type<>'wellness_check' or title<>body)) then raise exception 'Recipient/type/copy mismatch'; end if;
  select p.auth_user_id into other_id from public.patients p join public.profiles f on f.id=p.auth_user_id
    where p.id<>'2d329d5b-9093-45ca-a980-97466d2a71eb' and p.status='active' and f.role='patient' and f.status='active' limit 1;
  if other_id is null then raise exception 'No second active patient for isolation verification'; end if;
  perform set_config('request.jwt.claim.sub',other_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  denial:=false;
  begin perform public.create_my_daily_cervical_wellness_notifications(); exception when insufficient_privilege then denial:=true; end;
  if not denial then raise exception 'Other patient writer access allowed'; end if;
  if exists(select 1 from public.list_my_notifications(100,0) where source_id='2d329d5b-9093-45ca-a980-97466d2a71eb') then raise exception 'Cross-patient list leak'; end if;
  denial:=false;
  begin perform public.mark_notification_read(own_notice); exception when insufficient_privilege then denial:=true; end;
  if not denial then raise exception 'Cross-patient read mutation allowed'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  execute 'set local role anon';
  denial:=false;
  begin perform public.create_my_daily_cervical_wellness_notifications(); exception when insufficient_privilege then denial:=true; end;
  if not denial then raise exception 'Anonymous writer execution allowed'; end if;
  execute 'reset role';
  insert into wellness_verification values(jsonb_build_object('first_created',first_count,'second_created',second_count,'local_day',day,'daily_rows',list_count,'unread_increase',after_count-before_count,'patient_isolation','PASS','anonymous','DENIED','direct_writes','DENIED'));
end $$;
select result from wellness_verification;
commit;

-- Validate read/read-all persistence in a transaction that rolls back, so the
-- patient's real notification history is not marked read by verification.
begin;
do $$
declare owner_id uuid; notice uuid; unread_before bigint;
begin
  select auth_user_id into owner_id from public.patients where id='2d329d5b-9093-45ca-a980-97466d2a71eb';
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  unread_before:=public.get_my_unread_notification_count();
  select id into notice from public.list_my_notifications(100,0) where source_type='cervical_wellness' and read_at is null limit 1;
  if notice is not null then
    perform public.mark_notification_read(notice);
    if public.get_my_unread_notification_count()<>unread_before-1 then raise exception 'Mark-one count failed'; end if;
  end if;
  perform public.mark_all_my_notifications_read();
  if public.get_my_unread_notification_count()<>0 then raise exception 'Mark-all failed'; end if;
  perform public.create_my_daily_cervical_wellness_notifications();
  if public.get_my_unread_notification_count()<>0 then raise exception 'Retry reset read state'; end if;
  execute 'reset role';
end $$;
select 'PASS (read state verified; changes rolled back)' as read_state;
rollback;

select jsonb_build_object('writer',to_regprocedure('public.create_my_daily_cervical_wellness_notifications()')::text,
 'authenticated',has_function_privilege('authenticated','public.create_my_daily_cervical_wellness_notifications()','execute'),
 'anonymous',has_function_privilege('anon','public.create_my_daily_cervical_wellness_notifications()','execute'),
 'rls',(select jsonb_build_object('enabled',relrowsecurity,'forced',relforcerowsecurity,'acl',relacl::text) from pg_class where oid='public.notifications'::regclass),
 'policies',(select jsonb_agg(jsonb_build_object('name',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check) order by policyname) from pg_policies where schemaname='public' and tablename='notifications'),
 'broadcast_trigger',exists(select 1 from pg_trigger where tgrelid='public.notifications'::regclass and tgname='notification_broadcast_after_insert' and tgenabled='O')) as security;
