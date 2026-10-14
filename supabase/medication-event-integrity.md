# Security Repair 10 — Medication event/schedule patient integrity

## Root cause and existing workflow

`medication_events` carried two independent foreign keys: `schedule_id ->
medication_schedules(id)` and `patient_id -> patients(id)`. Each proved existence, never
that the two references described the same person. A service-role or direct structural
write could therefore persist Patient A's medication event against Patient B's schedule.
The row was internally FK-valid, so `medication_events_read` authorized on `patient_id`
would show the event to Patient A while the underlying schedule, medication and
prescription chain belonged to Patient B. Adherence is computed from
`medication_events.status`, so the mismatch silently corrupted Patient A's adherence
signal.

## Actual ownership chain (verified, not assumed)

`medication_schedules` has no `patient_id` column. Ownership is derived:

```
patients -> patient_medications.patient_id
patient_medications -> medication_schedules.patient_medication_id
medication_schedules -> medication_events.schedule_id
medication_events.patient_id  (independent FK to patients)
```

Verified from `20260820010500_medication.sql`, `20260821104000_patient_medication_read_model.sql`
and `20260929140000_medication_schema_improvements.sql`:

1. `medication_events.patient_id` exists — yes.
2. `medication_events.schedule_id` exists — yes, NOT NULL, `on delete restrict`.
3. `medication_schedules.patient_id` — no.
4. Schedule ownership is derived through `patient_medications.patient_id`.
5. Standalone events are not supported: `schedule_id` is NOT NULL.
6. Patients cannot insert events. Only `grant select` exists for `authenticated`; the
   single patient write surface is the `security definer` RPC
   `record_medication_event_status`, restricted to `taken`/`skipped`.
7. Service role / trusted scheduling code creates events; no Edge Function or
   repository writes events. `patientDashboardRepository` and
   `functions/_shared/health-context.ts` only read.
8. `medication_event_status` = `pending`, `taken`, `missed`, `skipped`, `unknown` —
   unchanged by this repair.
9. Yes, events drive adherence (`taken / (taken + missed + skipped)`), today's
   medications and history.

Because `medication_schedules` has no `patient_id`, a composite FK
`(schedule_id,patient_id) -> medication_schedules(id,patient_id)` is impossible
without adding a denormalized ownership column to a clinical table. The repair
therefore enforces the invariant with a database trigger instead of duplicating
patient ownership.

## Changes

Forward migration: `migrations/20261002140000_medication_event_patient_integrity.sql`.

- Locks `patient_medications`, `medication_schedules` and `medication_events` in
  `share row exclusive` mode, with a 10-second `lock_timeout`, while historical
  relationships are inspected. Any event whose schedule or patient_medication is
  missing, or whose event patient differs from the schedule's patient, aborts the
  migration with `23514` before enforcement is installed. No history is rewritten
  and no inconsistent event is deleted.
- Adds `public.check_medication_event_patient_chain()`, a `security definer`
  trigger function with `search_path = ''` and fully qualified references. Its
  branches are keyed on `tg_table_name`.
  - `medication_events`: resolves the schedule's patient through
    `medication_schedules -> patient_medications`, locking both parent rows
    `for share`, and raises `23514 Medication event patient mismatch` when the
    event patient differs or the chain cannot be resolved.
  - `medication_schedules`: an `UPDATE` of `patient_medication_id` that would leave
    an existing event pointing at a different patient raises
    `23514 Medication schedule reassignment ...`.
  - `patient_medications`: an `UPDATE` of `patient_id` that would strand any
    existing event/schedule chain raises
    `23514 Patient medication reassignment ...`.
- Installs `medication_events_parent_chain` on `before insert or update of
  schedule_id, patient_id`, so status-only updates (the mark-as-taken /
  mark-as-skipped RPC path) never pay the lookup cost and never change behavior.
- Parent `DELETE` is already covered by the existing `on delete restrict` FKs; a
  schedule referenced by an event cannot be deleted (`23001`).
- Execute rights revoked from `public`, `anon`, `authenticated`.

RLS changes: none. Authorization is unchanged and deliberately not broadened —
patients keep read-only access plus the scoped confirmation RPC, clinical staff
keep `can_access_patient(patient_id,'medications')`, Repair 3's
`clinical_identity_required` policies continue to block suspended/inactive
providers, and no new write policy or grant was added. Trigger enforcement covers
`anon`, `authenticated`, `service_role` and direct SQL equally; the function is
`security definer` so it is not bypassed by RLS.

Application/Edge Function changes: none required — nothing in the application
writes `medication_events` or reassigns `patient_medications.patient_id`.

## Read-only preflight

`scripts/medication_event_validation.sql` reports, without modifying anything:

1. Events with a missing schedule, a missing patient_medication, or an event
   patient different from the schedule's patient, labelled `missing_schedule`,
   `missing_patient_medication` or `patient_mismatch`.
2. Patient medications whose `prescription_item_id` points at a missing item or
   prescription, or whose prescription patient differs from the medication
   patient, labelled for operator review.

The second query is advisory: the prescription -> `prescription_items` ->
`patient_medications` link is already enforced by Repair 1 and was not broadened
here. Adherence/reminder impact follows from the event rows themselves, so no
downstream record is rewritten or inferred. Local fixtures had no findings; a
deliberately corrupted fixture produced one `patient_mismatch` and the migration
failed atomically with the original row intact. These are synthetic findings —
hosted data was not inspected.

## Validation

`src/lib/medicationEventIntegrity.integration.test.js` adds 20 PostgreSQL/PGlite
tests:

ALLOW — service-role creation of a valid Patient A event for a Patient A schedule;
patient reads of their own events with cross-patient reads invisible;
`record_medication_event_status` mark-as-taken and mark-as-skipped; adherence
calculation unchanged (33.3% across taken/skipped/missed/pending fixtures).

DENY — Patient A event on Patient B's schedule and the reverse; direct and
service-role mismatched INSERT; service-role `UPDATE` of `schedule_id` or of
`patient_id` to a conflicting value; patient direct INSERT (`42501`); anon
SELECT/INSERT; patient confirming another patient's event; reassigning a schedule
to another patient's medication; reassigning a patient's medication to another
patient; deleting a schedule that still has events (`23001`).

Also asserted: historical events and the full `pg_policies` snapshot are byte-identical
before and after migration, the validation script returns no rows on healthy data,
and the migration abort leaves no `check_medication_event_patient_chain` behind.

Independent exploit retest in an isolated rollback transaction: `service_role`
inserting a Patient A event against Patient B's schedule. Before migration:
**ACCEPTED**. After: **23514 `Medication event patient mismatch`**. Both attempts
rolled back; `select id from public.medication_events` returned zero corrupt rows
afterwards. Enforcement is relational, not an authorization filter.

## Files and operational considerations

Four new files only:

- `supabase/migrations/20261002140000_medication_event_patient_integrity.sql`
- `supabase/scripts/medication_event_validation.sql`
- `src/lib/medicationEventIntegrity.integration.test.js`
- `supabase/medication-event-integrity.md`

Nothing was deployed and no earlier migration, RLS policy, RPC, repository or Edge
Function was modified.

Before deployment, run the preflight as an authorized operator. Any structurally
inconsistent historical event makes this migration abort by design; resolve it by
clinical review, not by silent rewriting. The migration takes table locks on three
clinical tables, so assess lock duration on real table sizes and schedule it
accordingly. Hosted schema/grants and ingestion paths outside this repository need
staging verification. Owners able to drop triggers remain trusted administrators.

Remaining known limitation, reported rather than silently redesigned: the trigger
resolves ownership through a two-hop join, so it is correct but not a single
composite FK; adding `medication_schedules.patient_id` (or a unique
`(id, patient_id)` view) would allow a declarative FK if a future migration
decides that denormalization is worth it. Three known obsolete suites requiring
removed migrations are excluded from the non-legacy run and are not counted as
passing. Stopped after Repair 10; no patient_health_profiles or Database V2 work
was started.