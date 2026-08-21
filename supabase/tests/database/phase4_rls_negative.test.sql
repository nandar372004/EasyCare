-- Negative authorization checks. Requires the guarded synthetic seed.
-- Supabase Auth identities are managed externally and are never created here.

begin;
select plan(9);

-- Patient JWT: sees only own profile, patient record, appointment and event.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select is((select count(*)::integer from public.profiles), 1, 'patient sees only own profile');
select is((select count(*)::integer from public.patients), 1, 'patient sees only own patient record');
select is((select count(*)::integer from public.appointments), 1, 'patient sees only own appointment');

select is(
  (
    with changed as (
      update public.patients
      set address_city = 'Forbidden cross-patient update'
      where profile_id = '20000000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::integer from changed
  ),
  0,
  'patient cannot update another patient record'
);

select throws_like(
  $$update public.profiles set role = 'admin' where id = '10000000-0000-4000-8000-000000000001'$$,
  '%permission denied%',
  'patient cannot elevate profile role'
);

-- Assigned provider JWT: sees assigned appointment but no patient medical row.
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select is((select count(*)::integer from public.appointments), 1, 'assigned provider sees assigned appointment');
select is((select count(*)::integer from public.patients), 0, 'provider cannot read patient medical profile table');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_like(
  $$select * from public.patients$$,
  '%permission denied%',
  'anonymous user cannot read patients'
);
select is(
  (select count(*)::integer from public.availability_slots),
  1,
  'anonymous user sees only the available public slot'
);

select * from finish();
rollback;
