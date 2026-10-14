-- SELECT-only, one result because the Management API returns the final result.
select jsonb_build_object(
  'appointments', (select jsonb_build_object('rls',c.relrowsecurity,
    'authenticated_bypassrls',(select rolbypassrls from pg_roles where rolname='authenticated'),
    'table_select',has_table_privilege('authenticated',c.oid,'SELECT'),
    'updated_at_select',has_column_privilege('authenticated',c.oid,'updated_at','SELECT'))
    from pg_class c where c.oid='public.appointments'::regclass),
  'policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p
    where schemaname='public' and tablename in ('appointments','monitoring_alerts')),
  'alert_columns',(select jsonb_agg(jsonb_build_object('name',column_name,'type',data_type))
    from information_schema.columns where table_schema='public' and table_name='monitoring_alerts'),
  'read_functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
    'arguments',p.proargnames,'security_definer',p.prosecdef,'settings',p.proconfig,
    'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'definition',pg_get_functiondef(p.oid)))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('get_family_care_plan_readout','get_care_plan_detail','get_care_plan_occurrences',
      'list_my_care_plan_summaries','can_access_patient','clinical_identity_is_current','require_family_patient')),
  'migration_history',(select jsonb_agg(to_jsonb(m)) from
    (select version,name from supabase_migrations.schema_migrations
      where version in ('20260821102000','20260929150000','20261001110000','20261003100000',
        '20261003120000','20261003140000','20261008090000') order by version) m)
) as inspection;
