begin;
set local lock_timeout = '10s';

-- Supporting composite key: prevents a lab order from pairing an encounter
-- with a different patient. No encounter data or policies are changed.
alter table public.care_encounters
  add constraint care_encounters_id_patient_key unique (id, patient_id);

create table public.lab_orders (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  encounter_id uuid,
  ordered_by_provider_id uuid not null references public.providers(id) on delete restrict,
  order_code text not null unique default ('LAB-' || upper(replace(gen_random_uuid()::text, '-', ''))),
  status text not null default 'ordered',
  laboratory_name text,
  ordered_at timestamptz not null default statement_timestamp(),
  collected_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint lab_orders_id_patient_key unique (id, patient_id),
  constraint lab_orders_encounter_patient_fk foreign key (encounter_id, patient_id)
    references public.care_encounters(id, patient_id) on delete restrict,
  constraint lab_orders_code_check check (length(btrim(order_code)) between 1 and 100),
  constraint lab_orders_status_check check (status in ('ordered', 'collected', 'processing', 'completed', 'cancelled')),
  constraint lab_orders_laboratory_name_check check (laboratory_name is null or length(btrim(laboratory_name)) between 1 and 200),
  constraint lab_orders_ordered_at_check check (isfinite(ordered_at)),
  constraint lab_orders_collected_at_check check (collected_at is null or (isfinite(collected_at) and collected_at >= ordered_at)),
  constraint lab_orders_completed_at_check check (completed_at is null or
    (isfinite(completed_at) and completed_at >= ordered_at and (collected_at is null or completed_at >= collected_at))),
  constraint lab_orders_completion_check check ((status = 'completed') = (completed_at is not null)),
  constraint lab_orders_collection_check check (status <> 'collected' or collected_at is not null)
);

create table public.lab_results (
  id uuid primary key default gen_random_uuid(),
  lab_order_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  test_code text,
  test_name text not null,
  value_numeric numeric,
  value_text text,
  unit text,
  reference_low numeric,
  reference_high numeric,
  abnormal_flag text not null default 'unknown',
  result_status text not null default 'pending',
  observed_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint lab_results_order_patient_fk foreign key (lab_order_id, patient_id)
    references public.lab_orders(id, patient_id) on delete restrict,
  constraint lab_results_test_code_check check (test_code is null or length(btrim(test_code)) between 1 and 100),
  constraint lab_results_test_name_check check (length(btrim(test_name)) between 1 and 200),
  constraint lab_results_value_text_check check (value_text is null or length(btrim(value_text)) > 0),
  constraint lab_results_unit_check check (unit is null or length(btrim(unit)) between 1 and 64),
  constraint lab_results_numeric_check check (value_numeric is null or (value_numeric > '-Infinity'::numeric and value_numeric < 'Infinity'::numeric)),
  constraint lab_results_reference_low_check check (reference_low is null or (reference_low > '-Infinity'::numeric and reference_low < 'Infinity'::numeric)),
  constraint lab_results_reference_high_check check (reference_high is null or (reference_high > '-Infinity'::numeric and reference_high < 'Infinity'::numeric)),
  constraint lab_results_reference_order_check check (reference_low is null or reference_high is null or reference_low <= reference_high),
  constraint lab_results_abnormal_flag_check check (abnormal_flag in ('unknown', 'normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal')),
  constraint lab_results_status_check check (result_status in ('pending', 'preliminary', 'final', 'corrected', 'cancelled')),
  constraint lab_results_value_required_check check (result_status in ('pending', 'cancelled') or value_numeric is not null or value_text is not null),
  constraint lab_results_observed_at_check check (observed_at is null or isfinite(observed_at)),
  constraint lab_results_verified_at_check check (verified_at is null or
    (isfinite(verified_at) and (observed_at is null or verified_at >= observed_at))),
  constraint lab_results_verification_check check ((result_status in ('final', 'corrected')) = (verified_at is not null))
);

comment on table public.lab_orders is
  'Laboratory orders. Authenticated clients read scoped records; trusted service code manages laboratory workflow.';
comment on table public.lab_results is
  'Laboratory observations linked to an order and the same patient. Final/corrected results require a verification timestamp. Trusted service code controls writes.';
comment on column public.lab_results.value_text is
  'Qualitative result or interpretation. May accompany value_numeric; pending/cancelled results may have neither.';
comment on column public.lab_results.test_code is
  'Optional laboratory test identifier. Not globally unique: an order can contain repeated observations.';

create index lab_orders_patient_ordered_idx on public.lab_orders(patient_id, ordered_at desc);
create index lab_orders_provider_ordered_idx on public.lab_orders(ordered_by_provider_id, ordered_at desc);
create index lab_orders_encounter_idx on public.lab_orders(encounter_id) where encounter_id is not null;
create index lab_results_patient_observed_idx on public.lab_results(patient_id, observed_at desc nulls last);
create index lab_results_order_idx on public.lab_results(lab_order_id);

create trigger lab_orders_updated_at before update on public.lab_orders
for each row execute function public.set_updated_at();
create trigger lab_results_updated_at before update on public.lab_results
for each row execute function public.set_updated_at();

alter table public.lab_orders enable row level security;
alter table public.lab_results enable row level security;

create policy lab_orders_patient_read on public.lab_orders for select to authenticated
using (exists (select 1 from public.patients p where p.id = lab_orders.patient_id and p.profile_id = auth.uid()));
create policy lab_results_patient_read on public.lab_results for select to authenticated
using (exists (select 1 from public.patients p where p.id = lab_results.patient_id and p.profile_id = auth.uid()));

-- Reuse care-relationship checks but do not turn a generic family authorization
-- or clinical role alone into access to another patient's laboratory data.
create policy lab_orders_clinical_read on public.lab_orders for select to authenticated
using (public.current_profile_role() in ('doctor', 'nurse', 'main_admin')
  and public.can_access_patient(patient_id, 'clinical'));
create policy lab_results_clinical_read on public.lab_results for select to authenticated
using (public.current_profile_role() in ('doctor', 'nurse', 'main_admin')
  and public.can_access_patient(patient_id, 'clinical'));

revoke all on table public.lab_orders, public.lab_results from public, anon, authenticated;
grant select on table public.lab_orders, public.lab_results to authenticated;
-- Service writes bypass RLS but still obey all FK/CHECK constraints. No browser
-- INSERT/UPDATE/DELETE policies exist, including for verified laboratory data.
grant select, insert, update on table public.lab_orders, public.lab_results to service_role;

commit;
