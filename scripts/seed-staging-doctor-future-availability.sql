-- Operator template: use only through the Staging-pinned PowerShell wrapper.
begin;
create temporary table seed_plan(id uuid primary key, provider_id uuid, service_type public.service_mode, start_at timestamptz, end_at timestamptz, is_new boolean);
create temporary table seed_result(summary jsonb);
do $seed$
declare
  execute_seed boolean := __EXECUTE__;
  seed_day date := greatest(date '2026-10-20',(statement_timestamp() at time zone 'Asia/Yangon')::date + 1);
  doctor record; existing record; slot_id uuid; candidate timestamptz;
  mode public.service_mode; i integer; attempts integer;
  fingerprint text; old_patients text; old_appointments text; old_providers text; old_profiles text; old_slots text;
  inserted integer := 0; eligible integer; planned integer; readable integer;
begin
  if not (select relrowsecurity from pg_class where oid='public.provider_availability'::regclass) then
    raise exception 'Expected availability RLS enabled; refusing seed.';
  end if;
  if execute_seed then
    lock table public.providers,public.profiles,public.patients,public.appointments in share mode;
    lock table public.provider_availability in share row exclusive mode;
  end if;
  if exists(select 1 from pg_trigger where tgrelid='public.provider_availability'::regclass and not tgisinternal) then
    raise exception 'Unexpected availability trigger; refusing seed.';
  end if;
  select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) into old_patients from public.patients t;
  select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) into old_appointments from public.appointments t;
  select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) into old_providers from public.providers t;
  select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) into old_profiles from public.profiles t;
  select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) into old_slots from public.provider_availability t;

  for doctor in
    select p.* from public.providers p left join public.profiles pr on pr.id=p.profile_id
    where p.id in (
        '52000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000002',
        '52000000-0000-4000-8000-000000000003','52000000-0000-4000-8000-000000000004',
        '52000000-0000-4000-8000-000000000005','52000000-0000-4000-8000-000000000006'
      )
      and p.provider_type='doctor' and p.verification_status='verified'
      and p.profile_id is null
      and (p.profile_id is null or pr.status='active')
      and (p.teleconsult_enabled or p.home_visit_enabled)
    order by p.id
  loop
    mode := case when doctor.teleconsult_enabled then 'teleconsultation'::public.service_mode else 'home_visit'::public.service_mode end;
    for i in 1..3 loop
      -- Stable batch identity: reruns never add another set or modify old rows.
      slot_id := md5('easycare-staging-future-v2:' || doctor.id::text || ':' || i)::uuid;
      select * into existing from public.provider_availability where id=slot_id;
      if found then
        if existing.provider_id<>doctor.id or existing.service_type<>mode or existing.status<>'available'
           or existing.start_at<=clock_timestamp() or existing.end_at<=existing.start_at then
          raise exception 'Existing seed slot no longer matches a future available slot; refusing rerun.';
        end if;
        insert into seed_plan values(slot_id,doctor.id,mode,existing.start_at,existing.end_at,false);
      else
        candidate := (seed_day + time '09:00' + (i-1)*interval '1 hour') at time zone 'Asia/Yangon';
        if exists(select 1 from public.provider_availability where provider_id=doctor.id and start_at<candidate+interval '30 minutes' and end_at>candidate)
           or exists(select 1 from seed_plan where provider_id=doctor.id and start_at<candidate+interval '30 minutes' and end_at>candidate) then
          -- Preserve the other preferred starts; only this conflicting slot moves.
          candidate := (seed_day + time '12:00') at time zone 'Asia/Yangon';
          attempts := 0;
          while exists(select 1 from public.provider_availability where provider_id=doctor.id and start_at<candidate+interval '30 minutes' and end_at>candidate)
             or exists(select 1 from seed_plan where provider_id=doctor.id and start_at<candidate+interval '30 minutes' and end_at>candidate)
          loop
            candidate := candidate + interval '30 minutes';
            attempts := attempts+1;
            if attempts>1000 then raise exception 'No safe slot found; refusing seed.'; end if;
          end loop;
        end if;
        if candidate<=clock_timestamp() then raise exception 'Slot is not future.'; end if;
        insert into seed_plan values(slot_id,doctor.id,mode,candidate,candidate+interval '30 minutes',true);
      end if;
    end loop;
  end loop;
  select count(distinct provider_id),count(*) filter(where is_new) into eligible,planned from seed_plan;
  if eligible=0 then raise exception 'No eligible verified doctors; refusing seed.'; end if;
  if exists(select 1 from seed_plan a join seed_plan b on a.provider_id=b.provider_id and a.id<>b.id and a.start_at<b.end_at and a.end_at>b.start_at)
     or exists(select 1 from seed_plan a join public.provider_availability b on a.provider_id=b.provider_id and a.id<>b.id and a.start_at<b.end_at and a.end_at>b.start_at) then
    raise exception 'Seed overlap detected; refusing seed.';
  end if;
  select md5(old_slots || old_providers || old_profiles || seed_day::text || jsonb_agg(to_jsonb(t) order by id)::text) into fingerprint from seed_plan t;
  if execute_seed then
    if '__EXPECTED_PLAN__' !~ '^[a-f0-9]{32}$' or fingerprint<>'__EXPECTED_PLAN__' then raise exception 'State changed since preview; refusing seed.'; end if;
    insert into public.provider_availability(id,provider_id,service_type,start_at,end_at,status)
      select id,provider_id,service_type,start_at,end_at,'available' from seed_plan where is_new;
    get diagnostics inserted = row_count;
    if inserted<>planned then raise exception 'Unexpected insert count.'; end if;
    if old_patients<>(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.patients t)
       or old_appointments<>(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.appointments t)
       or old_providers<>(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.providers t)
       or old_profiles<>(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.profiles t)
       or old_slots<>(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.provider_availability t where not exists(select 1 from seed_plan s where s.is_new and s.id=t.id)) then
      raise exception 'Protected records changed; rolling back.';
    end if;
    if exists(select 1 from seed_plan s left join public.provider_availability a on a.id=s.id where a.id is null or a.status<>'available' or a.start_at<=clock_timestamp()) then
      raise exception 'Post-insert verification failed.';
    end if;
    -- Verify the same columns/role used by Book Care; no service-role browser.
    grant select on seed_plan to authenticated;
    set local role authenticated;
    select count(*) into readable from (
      select id,provider_id,service_type,start_at,end_at,status from public.provider_availability
      where status='available' and start_at>now()
    ) a join seed_plan s on s.id=a.id;
    reset role;
    if readable<>eligible*3 then raise exception 'Authenticated Book Care read verification failed.'; end if;
  end if;
  insert into seed_result select jsonb_build_object(
    'eligible_doctors',eligible,'planned_inserts',planned,'slots_per_doctor',3,
    'doctor_names',(select jsonb_agg(p.display_name order by p.display_name) from public.providers p where p.id in(select provider_id from seed_plan)),
    'slots',(select jsonb_agg(jsonb_build_object('provider_id',provider_id,'service_type',service_type,'start_at',start_at,'end_at',end_at,'new',is_new) order by provider_id,start_at) from seed_plan),
    'plan_fingerprint',fingerprint,'executed',execute_seed,'inserted',inserted,
    'verified_future_available_slots',case when execute_seed then readable else 0 end,
    'protected_rows_unchanged',true,'overlaps',0);
end;
$seed$;
commit;
select summary from seed_result;
