begin;
-- The legacy Guardian calls a limiter absent from the migration chain. Keep
-- this endpoint self-contained with a fixed, service-only request budget.
create table public.ai_overview_request_limits (
  patient_id uuid primary key references public.patients(id) on delete restrict,
  window_start timestamptz not null,
  attempts integer not null check(attempts between 1 and 60)
);
alter table public.ai_overview_request_limits enable row level security;
revoke all on public.ai_overview_request_limits from public, anon, authenticated;
grant select, insert, update on public.ai_overview_request_limits to service_role;
create function public.consume_ai_overview_request(p_patient_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare accepted uuid;
begin
  insert into public.ai_overview_request_limits(patient_id,window_start,attempts)
  values(p_patient_id,clock_timestamp(),1)
  on conflict(patient_id) do update
    set window_start=case when public.ai_overview_request_limits.window_start <= clock_timestamp()-interval '15 minutes' then clock_timestamp() else public.ai_overview_request_limits.window_start end,
        attempts=case when public.ai_overview_request_limits.window_start <= clock_timestamp()-interval '15 minutes' then 1 else public.ai_overview_request_limits.attempts+1 end
    where public.ai_overview_request_limits.window_start <= clock_timestamp()-interval '15 minutes' or public.ai_overview_request_limits.attempts<60
  returning patient_id into accepted;
  return accepted is not null;
end;
$$;
revoke all on function public.consume_ai_overview_request(uuid) from public,anon,authenticated;
grant execute on function public.consume_ai_overview_request(uuid) to service_role;
-- Operational leases only, never clinical facts. No browser access.
create table public.ai_overview_leases (
  patient_id uuid primary key references public.patients(id) on delete restrict,
  token uuid not null,
  lease_until timestamptz not null,
  retry_after timestamptz not null
);
alter table public.ai_overview_leases enable row level security;
revoke all on public.ai_overview_leases from public, anon, authenticated;
grant select, insert, update on public.ai_overview_leases to service_role;

create function public.claim_ai_overview(p_patient_id uuid, p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare claimed uuid;
begin
  insert into public.ai_overview_leases(patient_id,token,lease_until,retry_after)
  values(p_patient_id,p_token,clock_timestamp()+interval '90 seconds',clock_timestamp()+interval '2 minutes')
  on conflict(patient_id) do update set token=excluded.token,lease_until=excluded.lease_until,retry_after=excluded.retry_after
  where public.ai_overview_leases.lease_until <= clock_timestamp() and public.ai_overview_leases.retry_after <= clock_timestamp()
  returning token into claimed;
  return claimed is not null;
end;
$$;

-- Atomic version replacement; a stale worker cannot save after its lease expires.
create function public.save_ai_overview(p_patient_id uuid,p_token uuid,p_summary jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid := gen_random_uuid(); start_at timestamptz; end_at timestamptz;
begin
  perform 1 from public.ai_overview_leases where patient_id=p_patient_id and token=p_token
    and lease_until > clock_timestamp() for update;
  if not found then raise exception 'Overview lease unavailable' using errcode='42501'; end if;
  start_at := (p_summary->>'period_start')::timestamptz;
  end_at := (p_summary->>'period_end')::timestamptz;
  set constraints public.ai_summaries_superseded_patient_fk deferred;
  update public.ai_health_summaries set superseded_by_id=new_id
    where patient_id=p_patient_id and summary_type='daily' and period_start=start_at and period_end=end_at and superseded_by_id is null;
  insert into public.ai_health_summaries(id,patient_id,period_start,period_end,summary_type,overall_status,summary_text,
    things_to_watch,recommended_actions,urgency_level,source_snapshot,source_data_hash,model_provider,model_name,model_version,prompt_version,generated_at,expires_at)
  values(new_id,p_patient_id,start_at,end_at,'daily',p_summary->>'overall_status',p_summary->>'summary_text',
    p_summary->'things_to_watch',p_summary->'recommended_actions',(p_summary->>'urgency_level')::public.care_urgency,
    p_summary->'source_snapshot',p_summary->>'source_data_hash',p_summary->>'model_provider',p_summary->>'model_name',
    p_summary->>'model_version',p_summary->>'prompt_version',(p_summary->>'generated_at')::timestamptz,(p_summary->>'expires_at')::timestamptz);
  set constraints public.ai_summaries_superseded_patient_fk immediate;
  update public.ai_overview_leases set lease_until=clock_timestamp(),retry_after=clock_timestamp()+interval '2 minutes'
    where patient_id=p_patient_id and token=p_token;
  return new_id;
end;
$$;
revoke all on function public.claim_ai_overview(uuid,uuid), public.save_ai_overview(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_ai_overview(uuid,uuid), public.save_ai_overview(uuid,uuid,jsonb) to service_role;
commit;
