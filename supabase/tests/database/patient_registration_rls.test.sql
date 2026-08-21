-- Future local Supabase/pgTAP verification for the patient registration layer.
-- Run only after the baseline schema and migrations are installed locally.

begin;

select plan(16);

select has_column('public', 'profiles', 'phone_number', 'profiles stores phone number');
select has_column('public', 'profiles', 'created_at', 'profiles has created_at');
select has_column('public', 'profiles', 'updated_at', 'profiles has updated_at');
select has_column('public', 'patients', 'gender', 'patients stores gender');
select has_column('public', 'patients', 'address', 'patients stores address');
select has_column('public', 'patients', 'emergency_contact_name', 'patients stores emergency contact name');
select has_column('public', 'patients', 'emergency_contact_phone', 'patients stores emergency contact phone');
select has_column('public', 'patients', 'created_at', 'patients has created_at');
select has_column('public', 'patients', 'updated_at', 'patients has updated_at');

select policies_are(
  'public',
  'profiles',
  array[
    'patient_profile_insert_boundary',
    'patient_profile_insert_own',
    'patient_profile_read_boundary',
    'patient_profile_read_own',
    'patient_profile_update_boundary',
    'patient_profile_update_own'
  ],
  'profiles exposes only reviewed patient registration policies'
);

select policies_are(
  'public',
  'patients',
  array[
    'patient_record_insert_boundary',
    'patient_record_insert_own',
    'patient_record_read_boundary',
    'patient_record_read_own',
    'patient_record_update_boundary',
    'patient_record_update_own'
  ],
  'patients exposes only reviewed patient registration policies'
);

select is(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  true,
  'RLS is enabled on profiles'
);

select is(
  (select relrowsecurity from pg_class where oid = 'public.patients'::regclass),
  true,
  'RLS is enabled on patients'
);

select is(
  has_table_privilege('anon', 'public.profiles', 'SELECT'),
  false,
  'anonymous role cannot read profiles'
);

select is(
  has_table_privilege('anon', 'public.patients', 'SELECT'),
  false,
  'anonymous role cannot read patients'
);

select is(
  has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE'),
  false,
  'browser users cannot update profile role'
);

select * from finish();
rollback;
