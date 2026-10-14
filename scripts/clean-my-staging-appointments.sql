-- Operator template: use only the project-pinned PowerShell wrapper.
-- All identifiers remain inside the database; output contains counts and hashes only.
begin;
create temporary table cleanup_result(summary jsonb);
do $cleanup$
declare
  account_identifier text := convert_from(decode('__ACCOUNT_HEX__','hex'),'UTF8');
  execute_cleanup boolean := __EXECUTE__;
  patient uuid;
  patient_count bigint;
  appointment_ids uuid[];
  slot_ids uuid[];
  dependencies jsonb := '{}'::jsonb;
  fk record;
  join_condition text;
  dependent_count bigint;
  shared_slots bigint;
  summary jsonb;
  fingerprint text;
  deleted_count bigint := 0;
  restored_count bigint := 0;
  other_before text;
  slots_before text;
  providers_before text;
begin
  select count(*), (array_agg(p.id))[1] into patient_count, patient
  from auth.users u join public.profiles pr on pr.id=u.id
  join public.patients p on p.profile_id=pr.id and p.auth_user_id=u.id
  where lower(u.email)=lower(account_identifier) or u.phone=account_identifier or p.primary_phone=account_identifier;
  if patient_count <> 1 then raise exception 'Account must resolve to exactly one matching auth/profile/patient identity. Matched: %', patient_count; end if;

  if execute_cleanup then
    lock table public.appointments, public.provider_availability in share row exclusive mode;
    perform 1 from public.appointments where patient_id=patient for update;
  end if;
  select coalesce(array_agg(id), '{}'::uuid[]), coalesce(array_agg(distinct provider_availability_id) filter(where provider_availability_id is not null), '{}'::uuid[])
  into appointment_ids, slot_ids from public.appointments where patient_id=patient;

  -- Refuse any trigger drift rather than disabling triggers or touching clinical truth.
  if exists(select 1 from pg_trigger t where t.tgrelid='public.appointments'::regclass and not t.tgisinternal and (t.tgtype::integer & 8) <> 0
    and (t.tgname <> 'appointments_audit' or t.tgfoid <> 'public.audit_row_change()'::regprocedure))
    or md5(pg_get_functiondef('public.audit_row_change()'::regprocedure)) <> '029e5060b6835942cc26da810b3eda97'
    or exists(select 1 from pg_trigger t where t.tgrelid='public.provider_availability'::regclass and not t.tgisinternal and (t.tgtype::integer & 16) <> 0)
  then raise exception 'Deletion/slot trigger contract has changed. Re-audit before cleanup.'; end if;

  -- Every dependency blocks cleanup, including CASCADE/SET NULL relationships.
  for fk in select * from pg_constraint where contype='f' and confrelid='public.appointments'::regclass loop
    select string_agg(format('r.%I = a.%I', child.attname, parent.attname), ' and ' order by k.ordinality)
    into join_condition
    from unnest(fk.conkey, fk.confkey) with ordinality k(child_num,parent_num,ordinality)
    join pg_attribute child on child.attrelid=fk.conrelid and child.attnum=k.child_num
    join pg_attribute parent on parent.attrelid=fk.confrelid and parent.attnum=k.parent_num;
    execute format('select count(*) from %s r join public.appointments a on %s where a.id=any($1)', fk.conrelid::regclass, join_condition)
      into dependent_count using appointment_ids;
    if dependent_count > 0 then dependencies := dependencies || jsonb_build_object(fk.conrelid::regclass::text, dependent_count); end if;
  end loop;
  select count(*) into shared_slots from public.provider_availability s where s.id=any(slot_ids)
    and exists(select 1 from public.appointments a where a.provider_availability_id=s.id and a.patient_id <> patient);
  if exists(select 1 from public.appointments a join public.provider_availability s on s.id=a.provider_availability_id
    where a.id=any(appointment_ids) and (a.provider_id <> s.provider_id or a.scheduled_start <> s.start_at or a.scheduled_end <> s.end_at or a.appointment_type <> s.service_type))
  then raise exception 'A linked slot does not match its appointment. Refusing cleanup.'; end if;

  select md5(coalesce((select string_agg(to_jsonb(a)::text, ',' order by a.id) from public.appointments a where a.id=any(appointment_ids)), '') || '|' ||
    coalesce((select string_agg(to_jsonb(s)::text, ',' order by s.id) from public.provider_availability s where s.id=any(slot_ids)), '')) into fingerprint;
  select jsonb_build_object('patient_reference', 'patient-' || substr(md5(patient::text),1,8),
    'total',count(*),'pending',count(*) filter(where status='pending'),'confirmed',count(*) filter(where status='confirmed'),
    'cancelled',count(*) filter(where status='cancelled'),'completed',count(*) filter(where status='completed'),
    'no_show',count(*) filter(where status='no_show'),'rescheduled',count(*) filter(where status='rescheduled'),
    'linked_booked_slots',(select count(*) from public.provider_availability where id=any(slot_ids) and status='booked'),
    'dependencies',dependencies,'shared_slot_reservations',shared_slots,'blocked',dependencies <> '{}'::jsonb or shared_slots > 0,
    'plan_fingerprint',fingerprint) into summary from public.appointments where id=any(appointment_ids);

  if execute_cleanup then
    if summary->>'blocked'='true' then raise exception 'Dependent records/shared reservations block cleanup. No changes committed.'; end if;
    if fingerprint <> '__EXPECTED_PLAN__' then raise exception 'Patient appointments or linked slots changed since preview. Review a new preview.'; end if;
    select md5(coalesce(string_agg(to_jsonb(a)::text, ',' order by id),'')) into other_before from public.appointments a where patient_id <> patient;
    select md5(coalesce(string_agg(to_jsonb(s)::text, ',' order by id),'')) into slots_before from public.provider_availability s where not(id=any(slot_ids));
    select md5(coalesce(string_agg(to_jsonb(p)::text, ',' order by id),'')) into providers_before from public.providers p;
    delete from public.appointments where patient_id=patient and id=any(appointment_ids);
    get diagnostics deleted_count = row_count;
    update public.provider_availability s set status='available' where s.id=any(slot_ids) and s.status='booked'
      and not exists(select 1 from public.appointments a where a.provider_availability_id=s.id);
    get diagnostics restored_count = row_count;
    if other_before <> (select md5(coalesce(string_agg(to_jsonb(a)::text, ',' order by id),'')) from public.appointments a where patient_id <> patient)
      or slots_before <> (select md5(coalesce(string_agg(to_jsonb(s)::text, ',' order by id),'')) from public.provider_availability s where not(id=any(slot_ids)))
      or providers_before <> (select md5(coalesce(string_agg(to_jsonb(p)::text, ',' order by id),'')) from public.providers p)
    then raise exception 'Unrelated data changed; cleanup rolled back.'; end if;
  end if;
  insert into cleanup_result values(summary || jsonb_build_object('executed',execute_cleanup,'appointments_deleted',deleted_count,'slots_restored',restored_count));
end $cleanup$;
commit;
select summary from cleanup_result;
