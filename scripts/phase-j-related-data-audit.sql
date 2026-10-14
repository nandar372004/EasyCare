-- Read-only clinical audit. Temporary result rows contain only aggregate counts.
-- No patient IDs, names, clinical text, credentials, or tokens are returned.
begin;
create temporary table phase_j_audit_results(label text,result jsonb) on commit drop;
do $$
declare actor record; target record; summary jsonb; permissions jsonb; groups jsonb; plans jsonb;
  member_index integer:=0; scope_index integer; app_count integer; alert_count integer;
  document_count integer; fact_count integer; eligible_count integer;
  sample_group uuid; sample_member uuid; denied boolean; leaks integer;
begin
  select m.family_group_id,m.id into sample_group,sample_member
    from public.family_group_members m where m.status='active' order by m.id limit 1;
  for actor in
    select p.auth_user_id,p.id,
      exists(select 1 from public.family_group_members m where m.patient_id=p.id and m.status='active') as in_family
    from public.patients p join public.profiles pr on pr.id=p.profile_id
    where p.status='active' and pr.status='active' and pr.role='patient'
      and p.date_of_birth <= (current_date-interval '18 years')::date
    order by in_family desc,p.id
  loop
    member_index:=member_index+1;
    perform set_config('request.jwt.claim.sub',actor.auth_user_id::text,true);
    execute 'set local role authenticated';
    select coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) into groups from public.get_my_family_groups() g;
    plans:=public.list_my_care_plan_summaries();
    select count(*) into app_count from public.appointments where patient_id=actor.id
      and status in ('pending','confirmed','completed')
      and (status<>'completed' or updated_at>=statement_timestamp()-interval '30 days');
    select count(*) into alert_count from public.monitoring_alerts where patient_id=actor.id
      and status in ('open','acknowledged','escalated');
    select count(*) into document_count from public.clinical_documents where patient_id=actor.id
      and status='active' and source='patient_upload';
    select count(*),count(*) filter (where plain_language_explanation is not null)
      into fact_count,eligible_count from public.document_extracted_facts where patient_id=actor.id
      and review_status='needs_review';
    summary:=jsonb_build_object('family_member',actor.in_family,'groups',jsonb_array_length(groups),
      'own_appointments',app_count,'own_active_alerts',alert_count,'own_uploaded_documents',document_count,
      'own_pending_facts',fact_count,'own_pending_facts_with_explanation',eligible_count,
      'plan_summaries',jsonb_array_length(plans),'shared_members','[]'::jsonb);
    select count(*) into leaks from public.appointments
      where not public.can_access_patient(patient_id,'appointments');
    summary:=summary||jsonb_build_object('unauthorized_appointment_rows',leaks);
    if not actor.in_family and sample_group is not null then
      denied:=false;
      begin
        perform public.get_family_care_plan_readout(sample_group,sample_member);
      exception when insufficient_privilege then denied:=true;
      end;
      summary:=summary||jsonb_build_object('foreign_family_care_plan_rpc_denied',denied);
    end if;
    scope_index:=0;
    for target in select h.*,(g->>'id')::uuid as audit_group from jsonb_array_elements(groups) g
      cross join lateral public.get_family_health_members((g->>'id')::uuid) h where not h.is_self
    loop
      scope_index:=scope_index+1;
      permissions:=target.authorization;
      select count(*) into app_count from public.appointments where patient_id=target.patient_id
        and status in ('pending','confirmed','completed')
        and (status<>'completed' or updated_at>=statement_timestamp()-interval '30 days');
      select count(*) into alert_count from public.monitoring_alerts where patient_id=target.patient_id
        and status in ('open','acknowledged','escalated');
      select count(*) into document_count from public.clinical_documents where patient_id=target.patient_id
        and status='active' and source='patient_upload';
      select count(*) into fact_count from public.document_extracted_facts where patient_id=target.patient_id
        and review_status='needs_review';
      summary:=jsonb_set(summary,'{shared_members}',(summary->'shared_members')||jsonb_build_array(jsonb_build_object(
        'member',scope_index,'authorization_status',permissions->>'status','records',permissions->'records',
        'appointments',permissions->'appointments','alerts',permissions->'alerts','care_plans',permissions->'care_plans',
        'returned_appointments',app_count,'returned_alerts',alert_count,'returned_documents',document_count,
        'returned_pending_facts',fact_count,
        'family_care_plan_readout',case when permissions->>'status'='active' and permissions->>'care_plans'='true'
          then jsonb_array_length(public.get_family_care_plan_readout(target.audit_group,target.member_id)) else null end)));
    end loop;
    execute 'reset role';
    insert into phase_j_audit_results values ('Account '||member_index,summary);
  end loop;
end $$;
select coalesce(jsonb_agg(jsonb_build_object('account',label,'readout',result) order by label),'[]'::jsonb) as redacted_authenticated_reads
from phase_j_audit_results;
rollback;
