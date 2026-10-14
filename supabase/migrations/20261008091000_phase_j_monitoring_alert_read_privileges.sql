begin;

-- Refuse a grant if the inspected row-security contract has drifted.
do $$
begin
  if not (select relrowsecurity from pg_class where oid='public.monitoring_alerts'::regclass)
    or (select rolbypassrls from pg_roles where rolname='authenticated')
    or (select count(*) from pg_policies where schemaname='public' and tablename='monitoring_alerts'
      and permissive='PERMISSIVE' and cmd in ('SELECT','ALL')
      and roles && array['authenticated','public']::name[]) <> 1
    or not exists (select 1 from pg_policies where schemaname='public' and tablename='monitoring_alerts'
      and policyname='alerts_read' and cmd='SELECT' and permissive='PERMISSIVE'
      and roles=array['authenticated']::name[]
      and regexp_replace(replace(qual,'public.',''),'\s','','g')=
        'can_access_patient(patient_id,''alerts''::text)') then
    raise exception 'Phase J alert privilege repair requires the existing scoped alerts_read RLS contract';
  end if;
end $$;

-- Phase J projection plus patient_id for its WHERE filter. No table-wide
-- privilege, provenance fields, reviewer fields, writes, or RLS changes.
grant select (id, patient_id, alert_type, severity, status, title, message, detected_at, created_at)
  on public.monitoring_alerts to authenticated;

commit;
