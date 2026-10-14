select jsonb_build_object(
 'columns', (select jsonb_agg(jsonb_build_object('name',column_name,'type',udt_name,'nullable',is_nullable,'default',column_default) order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='provider_availability'),
 'constraints', (select jsonb_agg(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.provider_availability'::regclass),
 'triggers', (select coalesce(jsonb_agg(pg_get_triggerdef(oid)),'[]'::jsonb) from pg_trigger where tgrelid='public.provider_availability'::regclass and not tgisinternal),
 'doctor_summary', (select jsonb_agg(jsonb_build_object('name',p.display_name,'verification',p.verification_status,'profile_status',pr.status,'teleconsult',p.teleconsult_enabled,'home_visit',p.home_visit_enabled)) from public.providers p left join public.profiles pr on pr.id=p.profile_id where p.provider_type='doctor'),
 'availability_read_policy', (select jsonb_agg(jsonb_build_object('policy',policyname,'command',cmd,'roles',roles,'expression',qual)) from pg_policies where schemaname='public' and tablename='provider_availability'),
 'authenticated_columns', (select jsonb_agg(column_name) from information_schema.column_privileges where table_schema='public' and table_name='provider_availability' and grantee='authenticated' and privilege_type='SELECT')
) as summary;
