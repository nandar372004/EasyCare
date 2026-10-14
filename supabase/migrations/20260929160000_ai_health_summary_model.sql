begin;
set local lock_timeout = '10s';

alter table public.ai_health_summaries
  add column if not exists overall_status text,
  add column if not exists things_to_watch jsonb,
  add column if not exists recommended_actions jsonb,
  add column if not exists urgency_level public.care_urgency,
  add column if not exists source_data_hash text,
  add column if not exists model_provider text,
  add column if not exists model_name text,
  add column if not exists model_version text,
  add column if not exists prompt_version text,
  add column if not exists generated_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists reviewed_by_profile_id uuid references public.profiles(id) on delete restrict,
  add column if not exists reviewed_at timestamptz,
  add column if not exists superseded_by_id uuid;

-- Creation time is the only historical generation-time evidence available.
-- Do not invent model identifiers, review attribution, hashes, or source data.
update public.ai_health_summaries set generated_at = created_at
where generated_at is null and isfinite(created_at);
alter table public.ai_health_summaries
  alter column generated_at set default statement_timestamp(),
  alter column things_to_watch set default '[]'::jsonb,
  alter column recommended_actions set default '[]'::jsonb,
  alter column urgency_level set default 'unassessed';

alter table public.ai_health_summaries
  add constraint ai_summaries_overall_status_check check (overall_status is null or length(btrim(overall_status)) between 1 and 100),
  add constraint ai_summaries_watch_check check (things_to_watch is null or jsonb_typeof(things_to_watch) = 'array'),
  add constraint ai_summaries_actions_check check (recommended_actions is null or jsonb_typeof(recommended_actions) = 'array'),
  add constraint ai_summaries_hash_check check (source_data_hash is null or
    (source_data_hash ~ '^[a-f0-9]{64}$' and source_snapshot is not null and source_snapshot <> 'null'::jsonb)),
  add constraint ai_summaries_provider_check check (model_provider is null or length(btrim(model_provider)) between 1 and 200),
  add constraint ai_summaries_model_check check (model_name is null or length(btrim(model_name)) between 1 and 200),
  add constraint ai_summaries_model_version_check check (model_version is null or length(btrim(model_version)) between 1 and 200),
  add constraint ai_summaries_prompt_version_check check (prompt_version is null or length(btrim(prompt_version)) between 1 and 200),
  add constraint ai_summaries_generated_check check (generated_at is null or isfinite(generated_at)),
  add constraint ai_summaries_expiry_check check (expires_at is null or
    (isfinite(expires_at) and generated_at is not null and expires_at > generated_at)),
  add constraint ai_summaries_review_pair_check check ((reviewed_by_profile_id is null) = (reviewed_at is null)),
  add constraint ai_summaries_review_time_check check (reviewed_at is null or
    (isfinite(reviewed_at) and (generated_at is null or reviewed_at >= generated_at) and review_status in ('reviewed','hidden'))),
  add constraint ai_summaries_not_self_superseded_check check (superseded_by_id is null or superseded_by_id <> id),
  add constraint ai_summaries_id_patient_key unique (id, patient_id),
  add constraint ai_summaries_superseded_patient_fk foreign key (superseded_by_id, patient_id)
    references public.ai_health_summaries(id, patient_id) on delete restrict deferrable initially immediate;

-- Replace the original all-history uniqueness with current-version uniqueness.
-- Discover its generated name rather than relying on PostgreSQL truncation.
do $$
declare old_key record;
begin
  for old_key in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.ai_health_summaries'::regclass and c.contype = 'u'
      and (select array_agg(a.attname::text order by k.ordinality)
           from unnest(c.conkey) with ordinality k(attnum, ordinality)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
          = array['patient_id','summary_type','period_start','period_end']::text[]
  loop
    execute format('alter table public.ai_health_summaries drop constraint %I', old_key.conname);
  end loop;
end;
$$;
create unique index ai_summaries_current_period_key
  on public.ai_health_summaries(patient_id, summary_type, period_start, period_end)
  where superseded_by_id is null;
create index ai_summaries_patient_generated_idx on public.ai_health_summaries(patient_id, generated_at desc);
create index ai_summaries_superseded_idx on public.ai_health_summaries(superseded_by_id) where superseded_by_id is not null;
create index ai_summaries_reviewer_idx on public.ai_health_summaries(reviewed_by_profile_id) where reviewed_by_profile_id is not null;

comment on table public.ai_health_summaries is
  'Derived AI information, not an authoritative clinical record. Never automatically promote conclusions to patient_conditions. Preserve source/model/prompt provenance and retain old rows when superseding.';
comment on column public.ai_health_summaries.source_snapshot is
  'Generation inputs/provenance; preserve historical JSON unchanged. Trusted producer must include only data belonging to the summary patient and retain source identifiers/times.';
comment on column public.ai_health_summaries.source_data_hash is
  'Optional lowercase SHA-256 of the producer-canonicalized generation input. Hash format is checked; content equivalence must be verified by the producer. Legacy unknown hashes remain NULL.';
comment on column public.ai_health_summaries.overall_status is
  'Optional descriptive model output, not a clinical classification or a threshold rule.';
comment on column public.ai_health_summaries.generated_at is
  'Generation time; historical finite created_at is used as the best available fallback.';

alter table public.ai_health_summaries enable row level security;
-- Preserve existing scoped clinical/family access and hidden-summary exclusion.
-- No browser INSERT/UPDATE/DELETE privileges or policies are introduced.
revoke all on public.ai_health_summaries from public, anon, authenticated;
grant select on public.ai_health_summaries to authenticated;
revoke delete, truncate, references, trigger on public.ai_health_summaries from service_role;
grant select, insert, update on public.ai_health_summaries to service_role;
commit;
