select jsonb_build_object(
 'database',current_database(),
 'migration_history',(select jsonb_agg(version) from supabase_migrations.schema_migrations where version in ('20261013090000','20261013091000')),
 'wellness_type',exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='notification_type' and e.enumlabel='wellness_check'),
 'functions',(select jsonb_agg(p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_my_login_wellness_notification','patient_required_medication_actions','generate_patient_notification_reminders','withdraw_changed_appointment_reminders')),
 'notification_rls',(select jsonb_build_object('enabled',c.relrowsecurity,'forced',c.relforcerowsecurity,'acl',c.relacl::text) from pg_class c where c.oid='public.notifications'::regclass),
 'notification_policies',(select jsonb_agg(jsonb_build_object('name',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check) order by policyname) from pg_policies where schemaname='public' and tablename='notifications'),
 'columns',(select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',udt_name,'required',is_nullable='NO','default',column_default) order by table_name,ordinal_position) from information_schema.columns where table_schema='public' and table_name in ('profiles','patients','providers','patient_medications','medication_schedules','medication_events','patient_medication_check_ins','appointments')),
 'constraints',(select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid))) from pg_constraint where conrelid in ('public.profiles'::regclass,'public.patients'::regclass,'public.providers'::regclass,'public.patient_medications'::regclass,'public.medication_schedules'::regclass,'public.medication_events'::regclass,'public.patient_medication_check_ins'::regclass,'public.appointments'::regclass)),
 'triggers',(select jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'definition',pg_get_triggerdef(oid))) from pg_trigger where not tgisinternal and tgrelid in ('public.patients'::regclass,'public.profiles'::regclass,'public.appointments'::regclass,'public.patient_medications'::regclass)),
 'extensions',(select jsonb_agg(extname) from pg_extension where extname in ('pg_cron','pg_net'))
) as preflight;
