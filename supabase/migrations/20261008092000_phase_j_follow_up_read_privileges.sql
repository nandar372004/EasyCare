begin;

-- Column privileges do not bypass RLS. Preserve the existing clinical read
-- and staff/assignee authorization policies; refuse unexpected permissive reads.
do $$
begin
  if not (select relrowsecurity from pg_class where oid='public.follow_ups'::regclass)
    or (select rolbypassrls from pg_roles where rolname='authenticated')
    or (select rolsuper from pg_roles where rolname='authenticated')
    or (select relowner=(select oid from pg_roles where rolname='authenticated')
      from pg_class where oid='public.follow_ups'::regclass)
    or not exists (select 1 from pg_policies where schemaname='public' and tablename='follow_ups'
      and policyname='follow_ups_read' and cmd='SELECT' and permissive='PERMISSIVE'
      and roles=array['authenticated']::name[]
      and regexp_replace(replace(qual,'public.',''),'\s','','g')=
        'can_access_patient(patient_id,''clinical''::text)')
    or exists (
      select 1 from pg_policies where schemaname='public' and tablename='follow_ups'
        and permissive='PERMISSIVE' and cmd in ('SELECT','ALL')
        and roles && array['authenticated','public']::name[]
        and not coalesce((roles=array['authenticated']::name[] and (
          (policyname='follow_ups_read' and cmd='SELECT'
            and regexp_replace(replace(qual,'public.',''),'\s','','g')=
              'can_access_patient(patient_id,''clinical''::text)')
          or (policyname='follow_ups_assignee_manage' and cmd='ALL'
            and regexp_replace(replace(qual,'public.',''),'\s','','g')=
              '((assigned_to_profile_id=auth.uid())ORis_main_admin())')
          or (policyname='follow_ups_staff_read' and cmd='SELECT'
            and regexp_replace(replace(replace(qual,'public.',''),'follow_ups.',''),'\s','','g')=
              'can_manage_follow_up(patient_id,assigned_to_profile_id)')
        )),false)
    ) then
    raise exception 'Phase J follow-up privilege repair requires the existing authorized follow-up RLS contract';
  end if;
end $$;

grant select (id, patient_id, follow_up_type, due_at, status, completed_at)
  on public.follow_ups to authenticated;

commit;
