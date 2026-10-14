# Phase J Staging schema drift repair

Prepared 2026-10-08. Target: `xyprybspwrtthvhnumdp` (Staging).
Only SELECT catalog queries were executed remotely. No migration, deployment,
clinical-data change, or migration-history repair was executed.

## Confirmed causes

Appointments use direct authenticated table reads. The applied
`20260821102000_patient_appointment_booking.sql` deliberately revokes table-wide
SELECT and grants a column list that excludes `updated_at`. Phase J selects and
filters that column. Live catalog inspection returned RLS enabled and
`has_column_privilege('authenticated', …, 'updated_at', 'SELECT') = false`.
Both expected policies are present: patient ownership through `auth.uid()` and
the patient-role family policy through `can_access_patient(patient_id,'appointments')`.
Grant only `SELECT (updated_at)`; it cannot bypass RLS. The new migration aborts
if RLS is disabled, the authenticated role bypasses RLS, either scoped policy
differs, or another applicable permissive SELECT policy exists.

`get_family_care_plan_readout(uuid,uuid)` is published by
`20261003140000_family_care_plan_read_projection.sql`, but the Staging function
catalog contains no such RPC and its migration history has no such version.
This is an absent function, not just a stale PostgREST cache. Its arguments are
`p_group_id` and `p_member_id`. It is STABLE SECURITY DEFINER with empty
search_path. It requires an active adult patient viewer, current clinical
identity, accepted group membership, an active adult patient target in that
same group, a different patient from the viewer, and an explicit live
`care_plans` scope. The scope helper verifies revocation, expiry, consent and
both source-group memberships. Anonymous execution remains denied.

Staging also lacks `get_care_plan_occurrences(uuid)` and
`list_my_care_plan_summaries()`: migration `20261003120000` is absent from its
history. Its existing detail RPC is the earlier SECURITY INVOKER version.
Installing only the family wrapper would still fail and would retain the
older source-encounter projection. Restore the three published authorized,
source-masked read projections needed by the complete overview. Leave
`care_plan_occurrence_is_complete`, `get_care_plan_progress`, reconciliation,
lifecycle functions, triggers, raw-table privileges and RLS unchanged.

`monitoring_alerts.title` and `detected_at` are intended nullable metadata in
`20260929150000_monitoring_alert_metadata.sql`. Staging has only the original
ten columns, and that migration is absent from history. `message` remains the
existing descriptive fallback; this is not a nonexistent-column frontend bug.
Restore only these two consumed nullable fields and their published validation
constraints. Do not replay provenance backfills, timestamps, source columns,
indexes, or reviewer-write policy changes. Legacy NULL fields remain NULL.

Other unapplied migrations were observed, including the restrictive clinical
identity policy migration. This repair preserves the inspected Staging policies
and does not attempt to reconcile the entire migration history. Do not mark
those historical migrations applied or use a general `db push` for this task.

## Files and validation

One new migration:
`supabase/migrations/20261008090000_phase_j_staging_read_contract_repair.sql`.
No already-applied migration was edited. No application-code change is needed.

155 focused tests passed across 11 files, including 53 real local PostgreSQL
integration tests. Coverage includes drift reproduction and replay, unchanged
RLS/completion functions and appointment rows, refusal when RLS is disabled,
column-only privilege, own and explicitly shared appointments, unrelated
patients, missing scopes, revoked/expired/removed/withdrawn access, care-plan
source masking, alert metadata/readout, complete overview assembly, routes,
refresh/expiry clearing, and browser secret/service-role rejection.
The production build passed with the existing bundle-size warning.
Post-repair live authenticated acceptance remains unexecuted: Staging was not
modified, so local passing tests are not a claim that its live page is repaired.

## Operator command — prepared, not executed

From the repository root in PowerShell:

```powershell
& .\scripts\apply-phase-j-staging-repair.ps1
```

The script validates the linked project is Staging, applies only the new SQL
file through the explicitly targeted CLI, and records only version
`20261008090000` after success. The schema transaction notifies PostgREST to
reload. If history recording fails after SQL commits, the script reports that
specific state; do not record other missing versions. CLI credentials must
allow Staging schema and migration-history changes.

Read-only inspection can be repeated before/after operator application:

```powershell
node node_modules/supabase/dist/supabase.js db query --linked --project-ref xyprybspwrtthvhnumdp --file scripts/phase-j-staging-schema-inspection.sql
```

No deployment or Phase K work was started.
