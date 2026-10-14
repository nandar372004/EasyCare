# Security Repair 11: Monitoring Alert to Vital Reading Patient Relationship Integrity

## 1. Root cause

`public.monitoring_alerts` was created in `20260820010600_coordination.sql:6` with
`vital_reading_id uuid references public.vital_readings(id) on delete restrict`.

That is a **single-column** foreign key. It proves only that the referenced vital
reading *exists*. It says nothing about *whose* vital reading it is. The alert's own
`patient_id` and the vital's `patient_id` were never related by any constraint, check,
trigger, or policy.

`20260929150000_monitoring_alert_metadata.sql` added provenance metadata
(`source_type`, `source_id`) and correctly declined to constrain `source_id`,
documenting at line 32 that "producer must validate source existence and patient
ownership". That deliberate deferral left the legacy `vital_reading_id` path
unconstrained as well.

Result: the patient dimension of the alert-to-vital link was never enforced anywhere
in the system.

## 2. Previous exploit

An authorized, active, verified doctor for Patient A passes every authorization check:

- `alerts_provider_create` — role is `doctor`, `can_access_patient(patient_A,'clinical')` is true.
- `clinical_identity_required` (Repair 3) — provider identity is current.

The doctor then submits:

```
monitoring_alerts.patient_id      = Patient A   (authorized)
monitoring_alerts.vital_reading_id = Patient B's vital reading
```

Both RLS policies evaluate only against `monitoring_alerts.patient_id`, which is
legitimately Patient A. The single-column FK validates only that Patient B's vital
reading exists. **The database accepted the row**, creating a cross-patient clinical
relationship. The reverse direction (Patient B alert → Patient A vital) was equally
accepted.

## 3. Verified ownership chain

Confirmed by inspecting the migrations; nothing was assumed.

```
monitoring_alerts.patient_id       uuid NOT NULL  -> patients(id)
monitoring_alerts.vital_reading_id uuid NULL      -> vital_readings(id)      (single-column only)
vital_readings.patient_id          uuid NOT NULL  -> patients(id)
```

`vital_readings` **does** carry `patient_id` directly and `NOT NULL`
(`20260820010400_clinical.sql:15`). Ownership of the referenced vital is therefore
directly available on the parent row, with no join required. This is the decisive
schema fact: it is the same situation that `vital_readings_encounter_patient_fk`
(Repair 8) and `prescriptions_encounter_patient_fk` (Repair 1) resolved with a
composite foreign key.

Integrity precedent already established in this chain:

- Repairs 1, 4, 5, 6, 8, 9 — composite FK against a reused `*_id_patient_key` unique constraint.
- Repair 10 — triggers, used only because `medication_schedules` has **no** `patient_id`
  and ownership must be derived through `patient_medications`.
- Repair 7 — RPC-level integrity for a computed boolean.

## 4. Are standalone monitoring alerts supported?

**Yes, and they are preserved.**

`vital_reading_id` is declared with no `NOT NULL`, and the insert policy
`alerts_provider_create` places no requirement on it. Standalone alerts are a
supported, first-class state: `monitoring_alerts_source_id_check` and
`monitoring_alerts_vital_source_check` both explicitly permit NULL
`vital_reading_id`, and `monitoring_alerts_source_idx` is a partial index.

The repair therefore uses `MATCH SIMPLE`, which skips the FK check when any
referencing column is NULL. A standalone alert remains valid; only an alert that
*claims* a vital reading must agree on the patient. Covered by the test
"preserves standalone alerts that carry no vital reading".

## 5. Migration created

`supabase/migrations/20261002150000_monitoring_alert_vital_patient_integrity.sql`

```sql
lock table public.monitoring_alerts, public.vital_readings in share row exclusive mode;
-- preflight DO block -> raise 23514 and abort if inconsistent rows exist
alter table public.vital_readings
  add constraint vital_readings_id_patient_key unique (id, patient_id);
alter table public.monitoring_alerts
  add constraint monitoring_alerts_vital_patient_fk
  foreign key (vital_reading_id, patient_id)
  references public.vital_readings(id, patient_id)
  match simple on update restrict on delete restrict;
create index monitoring_alerts_vital_patient_idx
  on public.monitoring_alerts(vital_reading_id, patient_id)
  where vital_reading_id is not null;
```

Supporting constraint `vital_readings_id_patient_key` is required only so the
composite FK has a legal target. Because `vital_readings.id` is already the primary
key, the tuple `(id, patient_id)` is already unique in every possible state: no
existing row can be removed, duplicated, or made to collide by this addition. It is
therefore strictly redundant for data integrity and provably removes nothing.

## 6. Preflight validation created

`supabase/scripts/monitoring_alert_vital_validation.sql` — read-only, run as a trusted
operator so RLS cannot hide rows. Reports, without ever modifying data:

1. Alerts whose `patient_id` differs from the referenced vital's `patient_id` — the blocking condition.
2. Alerts whose `vital_reading_id` resolves to nothing — would also be rejected by the new FK.
3. Suspicious polymorphic provenance: `source_type='vital'` with a `source_id` owned by
   another patient. Metadata only; not constrained, but worth operator review.
4. Standalone alert census, to confirm NULL alerts are being preserved.

The migration repeats check 1 inline and raises `23514` with a hint pointing at this
script. Nothing is deleted, inferred, reassigned, or rewritten.

## 7. Database enforcement mechanism

**Declarative PostgreSQL composite foreign key.** No trigger, no RPC, no check
function. `monitoring_alerts_vital_patient_fk` is enforced by the PostgreSQL referential
integrity machinery on every write path, independent of RLS:

| Path | Enforcement |
|---|---|
| INSERT with a foreign vital | `23503` |
| INSERT with a NULL vital | allowed (standalone alert) |
| UPDATE `patient_id` into conflict | `23503` |
| UPDATE `vital_reading_id` to another patient's vital | `23503` |
| `service_role` INSERT / UPDATE | `23503` — FKs are not bypassable by RLS exemption |
| direct SQL, `bypassrls`, superuser | `23503` — cannot be bypassed at all |
| Parent `UPDATE vital_readings.patient_id` while referenced | `23001` (`ON UPDATE RESTRICT`) |
| Parent `DELETE` while referenced | `23001` (`ON DELETE RESTRICT`) |

Because `ON UPDATE RESTRICT` covers the parent side, mutating a vital reading's
`patient_id` to orphan an existing alert is blocked. An *unreferenced* vital remains
freely re-pointable, so legitimate correction of mis-filed readings is not broken.

## 8. RLS changes

**None.** This is deliberate.

`alerts_read`, `alerts_provider_create`, and the already-widened
`alerts_reviewer_update` (which already checks the *new* `patient_id`, fixed in
`20260929150000_monitoring_alert_metadata.sql:43`) are untouched. Repair 3's
restrictive `clinical_identity_required` policy is untouched. No privilege was added,
so no access was broadened.

The full `pg_policies` snapshot is asserted byte-identical before and after the
migration, so any future policy drift fails the suite.

Enforcement is relational, not authorization-based. This matters because RLS is not
merely bypassed by `service_role` — it is *absent* for direct SQL and superuser paths,
which the audit finding explicitly required to be closed.

## 9. Trigger / helper changes

**None.** No new function, trigger, or RPC. The existing single-column
`monitoring_alerts.vital_reading_id` FK is retained (it still carries the
`ON DELETE RESTRICT` delete protection and is harmless alongside the composite key).

## 10. Application / Edge Function changes

**None required, and none were made.** Repository inspection found no writer at all:

- `src/services/repositories/patientDashboardRepository.js:135` — `getActiveAlerts` is read-only.
- `supabase/functions/_shared/health-context.ts:23` — Edge Function reads alerts only.
- `ai-health-guardian`, `ai-health-overview`, `patient-register` — no alert inserts.

No application code, Edge Function, or RPC inserts into `monitoring_alerts`, so no
producer could break. `getActiveAlerts` selects `*` and maps via `rowModel`, so it
surfaces the new constraint's rows without change.

## 11. Tests added

`src/lib/monitoringAlertVitalIntegrity.integration.test.js` — 25 tests.

ALLOW: authorized doctor → own alert/vital; standalone alert; `service_role` linked
and background alert creation; authorized reviewer update and resolution; patient reads
own alert; unreferenced vital still re-pointable.

DENY: authorized doctor cross-patient INSERT (`23503`); reverse direction (`23503`);
`authenticated` and `service_role` direct-SQL cross-patient INSERT; `UPDATE patient_id`;
`UPDATE vital_reading_id`; `service_role` cross-patient UPDATE; parent vital ownership
mutation (`23001`); parent vital deletion (`23001`); unrelated doctor (`42501`);
suspended, inactive, and unverified provider (`42501`); unauthorized patient (`42501`);
anonymous caller (`42501`).

Plus: preservation of historical rows and the complete `pg_policies` snapshot; constraint
`convalidated`/`condeferrable` assertions; Repair 8 and Repair 3 regression guards; the
independent exploit test; and the preflight/abort test.

## 12. Total tests passed / failed

| Run | Suites | Tests | Failed |
|---|---|---|---|
| Before Repair 11 | 62 | 855 | 0 |
| After Repair 11 | 63 | **880** | **0** |

880 = 855 + 25 new. Excluded as instructed: `bookableDoctorSeed`, `phase4DatabaseSchema`,
`phase9AppointmentManagement`, `.kilo/worktrees/**`. Those obsolete suites were not
modified to make them pass.

## 13. Independent exploit BEFORE / AFTER

Isolated rollback transaction, exact audit finding:

**BEFORE — ACCEPTED.** As the active verified doctor for Patient A, inserting
`patient_id = Patient A` with `vital_reading_id` = Patient B's vital reading returned a
row. Confirmed `before.patient_id === patients[0]` and
`before.vital_reading_id === foreign.id`. Zero rows persisted after rollback.

**AFTER — DENIED.** The identical statement now fails with:
```
23503  constraint: monitoring_alerts_vital_patient_fk
```

The suite asserts the BEFORE acceptance explicitly, so the test genuinely proves the
repair rather than merely asserting the constraint exists.

Corrupt-row check after the denied attempt:
```sql
select count(*) from monitoring_alerts a
join vital_readings v on v.id = a.vital_reading_id
where a.patient_id is distinct from v.patient_id;   -- 0
```
Expected alert count is unchanged at 1 (the original valid fixture). **Zero corrupt
rows.**

## 14. Repairs 1–10 regression status

**Intact.** Full suite green at 880/880. Targeted re-run of the security suites:
**185 tests across 7 files, all passing** — `monitoringAlerts`,
`vitalEncounterIntegrity` (21), `medicationEventIntegrity` (20),
`prescriptionPatientIntegrity`, `vitalReadingsDashboard`,
`suspendedProviderClinicalAccess`, and the new Repair 11 suite (25).

Repair 8 is additionally asserted inside the Repair 11 suite
("Repair 8 vital/encounter integrity and Repair 3 identity guard still hold"), and
Repair 3's `clinical_identity_required` policy on `monitoring_alerts` is asserted present.

One interaction worth noting: `vital_encounter_validation.sql:19-40` already reported
inconsistent alert/vital rows as an informational aside, explicitly noting "this repair
does not rewrite or constrain alerts". Repair 11 is what closes that gap.

## 15. Historical inconsistencies found

**None.** The migration's preflight ran clean on the baseline data, and the validation
script returns empty result sets.

The abort path is nevertheless proven by test: with a deliberately corrupted alert in
place, the validation script reports exactly 1 row, the migration raises
`23514 'Monitoring alert relationship repair stopped'`, and after the failed migration
both the vital reading and the alert are byte-identical to their originals, with
`monitoring_alerts_vital_patient_fk` and `vital_readings_id_patient_key` both confirmed
absent. The migration fails safely and preserves all original data.

## 16. Files created

- `supabase/migrations/20261002150000_monitoring_alert_vital_patient_integrity.sql`
- `supabase/scripts/monitoring_alert_vital_validation.sql`
- `src/lib/monitoringAlertVitalIntegrity.integration.test.js`
- `supabase/monitoring-alert-vital-integrity.md` (this document)

No existing file was modified.

## 17. Remaining risks

1. **Lock duration on large tables.** `vital_readings_id_patient_key` builds a unique
   index, requiring a full scan under `ACCESS EXCLUSIVE`. `lock_timeout` is set to 10s
   so the migration fails fast rather than queueing behind long clinical transactions.
   Because `id` is already the primary key, this index could equivalently be created
   `CONCURRENTLY` outside the transaction if a future dataset proves large.
2. **`source_id` remains unconstrained.** Deliberately preserved from
   `20260929150000_monitoring_alert_metadata.sql`. An alert may still record
   `source_type='vital'` with a `source_id` owned by a different patient. This is
   non-clinical metadata with no alert routing or display logic, but validation query 3
   surfaces such rows. Worth a future decision.
3. **No application producer exists yet.** When alert-generation features are built,
   they must populate `vital_reading_id` from a vital they have already verified belongs
   to the same patient. The FK now makes any mistake fail loudly rather than silently.
4. **`source_id` non-`vital` polymorphism.** Future `lab`, `medication`, and `appointment`
   sources will need their own ownership constraints; this repair deliberately does not
   preempt them.
5. **Historical rows are not retroactively re-verified.** No pre-existing data was
   checked for clinical plausibility — only for the ownership mismatch being fixed.

## 18. Hosted deployment considerations

Nothing was deployed. The Supabase CLI is not available in this workspace; all
verification ran against PGlite with real PostgreSQL constraint and RLS semantics,
simulating only managed Auth and Storage.

For hosted Supabase:

1. **Run the validation script first, as a trusted operator**, so RLS cannot hide
   inconsistent rows. Abort and investigate manually if it returns any rows — the
   migration will refuse anyway, but this surfaces the data beforehand.
2. `supabase db reset` for local verification, then `supabase db lint`, then
   `supabase test db` for the pgTAP suites.
3. Apply via `supabase db push` or the dashboard migration runner. Do not paste
   constraint DDL manually — the migration is a single transaction and is designed to
   be all-or-nothing.
4. `lock_timeout = 10s` may cause a failure under heavy write load. That is the
   intended safe behavior; retry during a quieter window rather than raising it.
5. No Edge Function or client changes are needed, so redeploying functions is
   unnecessary. No new environment variables, grants, or secrets.
6. Confirm the composite FK is live after deployment:
   `select conname, convalidated from pg_constraint where conname = 'monitoring_alerts_vital_patient_fk';`