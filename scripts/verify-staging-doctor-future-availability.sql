begin;
create temporary table verified_seed_ids as
select p.display_name, p.id as provider_id,
  md5('easycare-staging-future-v1:' || p.id::text || ':' || i)::uuid as slot_id
from public.providers p left join public.profiles pr on pr.id=p.profile_id
cross join generate_series(1,3) i
where p.provider_type='doctor' and p.verification_status='verified'
  and (p.profile_id is null or pr.status='active')
  and (p.teleconsult_enabled or p.home_visit_enabled);
create temporary table verification_result(summary jsonb);
insert into verification_result select jsonb_build_object(
  'seed_overlaps',(select count(*) from verified_seed_ids s
    join public.provider_availability a on a.id=s.slot_id
    join public.provider_availability b on b.provider_id=a.provider_id and b.id<>a.id and a.start_at<b.end_at and a.end_at>b.start_at),
  'rls_enabled',(select relrowsecurity from pg_class where oid='public.provider_availability'::regclass));
grant select on verified_seed_ids,verification_result to authenticated;
set local role authenticated;
select v.summary || jsonb_build_object('authenticated_book_care_read',
  (select jsonb_agg(to_jsonb(t) order by display_name) from (
    select s.display_name,count(a.id) as future_available_slots,
      min(a.start_at) at time zone 'Asia/Yangon' as first_slot_myanmar,
      max(a.end_at) at time zone 'Asia/Yangon' as last_slot_end_myanmar
    from verified_seed_ids s left join public.provider_availability a
      on a.id=s.slot_id and a.status='available' and a.start_at>now()
    group by s.display_name
  ) t)) as summary from verification_result v;
reset role;
commit;
