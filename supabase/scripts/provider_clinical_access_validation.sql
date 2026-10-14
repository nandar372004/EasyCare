-- Read-only: run as an authorized database administrator. Contains identity IDs.
-- No provider.status or suspended clinic_staff enum exists in this schema.
select p.id as profile_id, p.role, p.status as profile_status,
       pr.id as provider_id, pr.verification_status
from public.providers pr left join public.profiles p on p.id=pr.profile_id
where p.status is distinct from 'active' or pr.verification_status is distinct from 'verified'
   or p.role is null or p.role not in ('doctor','nurse','caregiver');

select cs.id, cs.profile_id, cs.provider_id, cs.clinic_id, cs.clinic_role,
       cs.status as staff_status, p.status as profile_status
from public.clinic_staff cs left join public.profiles p on p.id=cs.profile_id
where cs.status is distinct from 'active' or p.status is distinct from 'active';

select cc.id, cc.profile_id, cc.status, p.status as profile_status, p.role
from public.care_coordinators cc left join public.profiles p on p.id=cc.profile_id
where cc.status is distinct from 'active' or p.status is distinct from 'active'
   or p.role is distinct from 'coordinator';

-- Review candidates, not a claim that every returned policy is vulnerable.
select schemaname,tablename,policyname,permissive,cmd,qual,with_check
from pg_policies where schemaname in ('public','storage')
  and (coalesce(qual,'') || coalesce(with_check,'')) ~
      '(provider|coordinator|clinic_staff|current_profile_role|can_access_patient|can_manage_follow_up|clinical_identity)'
order by schemaname,tablename,policyname;

select p.proname,pg_get_functiondef(p.oid) as definition,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef order by p.proname;
