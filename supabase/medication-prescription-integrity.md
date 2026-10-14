# Security Repair 12: Patient Medication to Prescription Item Patient Relationship Integrity

## 1. Exact root cause

`public.patient_medications` was created in `20260820010500_medication.sql:4` with:

```sql
patient_id          uuid not null references public.patients(id)
prescription_item_id uuid        references public.prescription_items(id) on delete restrict
```

Again a **single-column** foreign key. It proves the referenced prescription item
exists, and nothing about *whose* prescription that item belongs to.

The relationship it needed to express is one hop further than the FK could reach:

```
patient_medications.prescription_item_id
  -> prescription_items.id
     -> prescription_items.prescription_id
        -> prescriptions.id
           -> prescriptions.patient_id   (NOT NULL)
```

`prescription_items` (`20260820010500_medication.sql:3`) stores **only**
`prescription_id` — it has no `patient_id` column of its own, and no generated one.
Because ownership lives two joins away, no single-column FK could express the
invariant, and a composite FK would have required adding a denormalized
`patient_id` to `prescription_items`.

Nothing else enforced it either: `20261001090000` (Repair 1) stopped at
prescription↔encounter, and `20261002140000` (Repair 10) explicitly started at
`patient_medications`→`medication_schedules` because "medication_schedules does not
contain patient_id directly". Repair 10's trigger `patient_medications_parent_guard`
covers only the *downward* schedule/event chain — the *upward* prescription link was
left open.

The existing single-column FK also made this a genuine structural hole rather than a
theoretical one: `20260821104000:33-37` revoked all privileges on
`patient_medications` from `anon, authenticated` and granted only column-level SELECT.
So there is no `INSERT`/`UPDATE` RLS policy on the table at all. The only realistic
writer is `service_role` or the table owner — exactly the actor the audit used.

## 2. Previous exploit

```sql
-- service_role, bypassrls
insert into public.patient_medications(patient_id, prescription_item_id, medication_name, ...)
values ('<Patient A>', '<Patient B prescription item>', '...');
```

Result **BEFORE repair: ACCEPTED.** Patient A structurally held a medication whose
entire origin was Patient B's prescription chain. No policy, privilege, or constraint
objected, because nothing had ever compared the two patients.

The reverse direction was equally accepted.

## 3. Verified full prescription → medication ownership chain

Confirmed from the migrations; nothing assumed.

| Table | Ownership columns | Notes |
|---|---|---|
| `care_encounters` | `patient_id` NOT NULL | parent; `care_encounters_id_patient_key` from Repairs 1/8 |
| `prescriptions` | `patient_id` NOT NULL | `prescriptions_encounter_patient_fk` from Repair 1 |
| `prescription_items` | `prescription_id` NOT NULL → `prescriptions(id)` | **no `patient_id`** |
| `patient_medications` | `patient_id` NOT NULL; `prescription_item_id` **NULL** → `prescription_items(id)` | target of this repair |
| `medication_schedules` | `patient_medication_id` NOT NULL | Repair 10 |
| `medication_events` | `patient_id` NOT NULL + `schedule_id` NOT NULL | Repair 10 |

Answering the specific questions:

1. **Does `prescription_items` contain `patient_id`?** No — not as a column, not generated.
2. **How is ownership derived?** Through `prescription_items.prescription_id` → `prescriptions.patient_id`.
3. **Does `prescriptions` contain `patient_id`?** Yes, `NOT NULL`.
4. **Is `prescription_item_id` nullable on `patient_medications`?** Yes.
5. **Can a medication exist without a prescription?** Yes.
6. **Are manual medications supported?** Yes — `supabase/demo/seed_patient_medications.sql:23,34,45`
   inserts three medications with `prescription_item_id` never populated, and
   `20260929140000` and `aiHealthOverview.integration.test.js:78` both create such rows.
7. **Can one item generate multiple medications?** Yes, and legitimately — no unique
   constraint exists and a re-issued course from the same item is normal. Preserved and tested.
8. **Who creates `patient_medications`?** No application or Edge writer exists. Only
   `service_role`/owner, plus the operator-run demo seed. There is **no** INSERT policy
   for `authenticated`.
9. **Can `service_role`/background jobs create them?** Yes — and that is the exact gap closed.
10. **Can parent mutation create a mismatch later?** Yes, three ways: changing
    `patient_medications.patient_id`, changing `prescription_items.prescription_id`,
    or changing `prescriptions.patient_id`. All three are now guarded.

## 4. Are manual/standalone patient medications supported?

**Yes, and preserved.** `prescription_item_id` is nullable and the demo seed, the
metadata migration, and the AI-overview fixtures all create NULL-item medications.
`prescription_item_id` was **not** made `NOT NULL`. The trigger returns immediately when
it is NULL, so manual medications keep working and still support the Repair 10
schedule/event chain underneath them — verified by the test
"Repair 10 medication event chain integrity is not weakened", which drives Repair 10's
rejection through a manual medication precisely so Repair 12 cannot mask it.

## 5. Migration created

`supabase/migrations/20261002160000_medication_prescription_patient_integrity.sql`

```
lock table patient_medications, prescription_items, prescriptions in share row exclusive mode;
-- preflight DO block -> raise 23514 and abort on inconsistent rows
create function public.check_medication_prescription_patient_chain() ...
create trigger patient_medications_prescription_guard  before insert or update of prescription_item_id, patient_id
create trigger prescription_items_prescription_guard  before update of prescription_id
create trigger prescriptions_medication_guard         before update of patient_id
create index patient_medications_prescription_item_idx on patient_medications(prescription_item_id) where not null
```

No column added, no existing constraint, policy, privilege, or trigger altered.
`revoke all on function ... from public, anon, authenticated`, matching Repair 10.

## 6. Preflight validation created

`supabase/scripts/medication_prescription_validation.sql` — read-only, trusted operator:

1. Blocking condition: medication patient vs. owning prescription patient.
2. Missing referenced prescription item.
3. Broken chain above the boundary: item whose prescription disagrees with its encounter (Repair 1 territory, reported only).
4. Suspicious cross-patient relationship via `prescribing_provider_id`.
5. Manual-medication census, confirming NULL-item rows are being preserved.

## 7. Database enforcement mechanism

**Trigger-based chain validation**, chosen because the schema does not permit the
declarative alternative.

A composite FK `patient_medications(prescription_item_id, patient_id) →
prescription_items(id, patient_id)` would require adding `patient_id` to
`prescription_items` and keeping it in sync with `prescriptions` forever — a
denormalized copy of ownership that can silently drift, and exactly what the task
forbade. Since `prescription_items` has no ownership column, triggers are the
smallest correct mechanism, and they match the precedent Repair 10 already set for
the identical situation one level down.

`check_medication_prescription_patient_chain()` is `security definer`,
`set search_path = ''`, fully schema-qualified, locks the consulted rows
`for share`, and raises `23514`.

Two deliberate deferrals keep existing error codes stable:

- Missing prescription item → `return new`, so the pre-existing FK still reports `23503`.
- Unknown target patient/prescription → `return new`, so Repair 1's FK and the patients
  FK still report `23503`.

| Path | Enforcement |
|---|---|
| INSERT with a foreign patient's item | `23514` |
| INSERT with NULL item | allowed (manual medication) |
| `service_role` / `bypassrls` / direct SQL INSERT | `23514` — triggers always run |
| UPDATE `patient_id` | `23514` |
| UPDATE `prescription_item_id` | `23514` |

## 8. Parent mutation protection

All three parent-side paths are guarded, closing the question-10 gaps:

- `prescription_items` `UPDATE OF prescription_id` → `23514`
  ("Prescription item reassignment would invalidate patient medication patient ownership").
- `prescriptions` `UPDATE OF patient_id` → `23514`
  ("Prescription patient reassignment would invalidate patient medication patient ownership").

Repair 1 is **not** weakened or duplicated. `prescriptions_encounter_patient_fk` remains
the authority on prescription↔encounter. The test
"an unreferenced prescription item still lets Repair 1 be the only authority on patient
moves" proves Repair 12 does not over-block: with no medication referencing the
prescription, the rejection comes from Repair 1's FK (`23503`), not from the new guard.

An *unreferenced* prescription item remains freely re-pointable, and a manual
medication with no prescription remains freely re-ownable.

## 9. RLS changes

**None.** No policy, role, or grant was changed or added. `patient_medications_read_own`
and the `prescription_items` policies are untouched, Repair 3's restrictive
`clinical_identity_required` policies remain in force on all three tables, and
`patient_medications` still has **no** INSERT/UPDATE policy for `authenticated`.
The full `pg_policies` snapshot is asserted byte-identical before and after.

Separately verified still denied: unauthorized patient (`42501`), anonymous caller
(`42501`), unrelated/suspended/inactive/unverified provider (`42501`).

## 10. Trigger/helper changes

One new trigger function, `public.check_medication_prescription_patient_chain()`
(three-table dispatch, mirroring Repair 10's style), plus three triggers. It is a
guard only: it contains no `insert`, `update`, or `delete`, so it cannot write.
`revoke all ... from public, anon, authenticated`.

Repair 10's `check_medication_event_patient_chain()` and its three triggers are
untouched and still fire. The test asserts both triggers coexist on
`patient_medications` and asserts their exact set.

## 11. Application / Edge Function changes

**None required, none made.** There is no writer anywhere in `src/` or
`supabase/functions/` — the only medication reads are
`supabaseRepository.js:120`, `patientDashboardRepository.js:54`,
`_shared/health-context.ts:18`, and `fixtureRepository.js:106`. The only writer in the
repo is the operator-run demo seed, which never populates `prescription_item_id`.
No RPC or security-definer function writes these tables.

## 12. Tests added

`src/lib/medicationPrescriptionIntegrity.integration.test.js` — 27 tests.

ALLOW: Patient A medication from Patient A item; patient reads own medication;
other patient cannot; manual medication with no item; one item generating multiple
medications; schedule then event after a valid medication; legitimate discontinuation
metadata update; valid `service_role` creation.

DENY: exact audit exploit; reverse exploit; `authenticated` and `service_role`
direct-SQL cross-patient INSERT; `UPDATE patient_id`; `UPDATE prescription_item_id`;
parent prescription-item re-point; parent prescription patient move; unauthorized
patient; anonymous caller; suspended/inactive/unverified provider.

Plus: historical-row and full-`pg_policies` preservation, unknown-item still `23503`,
Repair 1 and Repair 10 non-regression, the independent exploit test, and the
preflight/abort test.

## 13. Total tests passed / failed

| Run | Suites | Tests | Failed |
|---|---|---|---|
| Before Repair 12 | 63 | 880 | 0 |
| After Repair 12 | 64 | **907** | **0** |

907 = 880 + 27 new. Excluded as instructed and left unmodified:
`bookableDoctorSeed`, `phase4DatabaseSchema`, `phase9AppointmentManagement`,
`.kilo/worktrees/**`.

Re-verification 2026-10-10 (workspace later received unrelated feature work):
Repair 12 suite 27/27; targeted Repairs 1/3/10/11 medication & prescription
re-run 195/195 across 8 files; widest non-legacy suite 1995 passed / 4 failed
across 160 suites (2017 total minus the 18 excluded obsolete tests). The 4
failures — `patientProfileIdentity`, `RegistrationSessionFlow`,
`WorkspaceSwitcher`, `ProviderAppointmentsPage` — fail **identically with all
four Repair 12 files moved out of the repository**, and none loads
`20261002160000` (their migration/UI cutoffs predate it), so they are
pre-existing failures in unrelated in-flight work, not Repair 12 regressions.

## 14. Independent exploit BEFORE / AFTER

**BEFORE — ACCEPTED.** In an isolated transaction, `service_role` inserted
`patient_medications.patient_id = Patient A` with `prescription_item_id` = Patient B's
item; the row was returned with both values as submitted. Rolled back, count 0.

**AFTER — DENIED.** The identical statement fails with:
```
23514  Patient medication prescription mismatch: medication patient <A> does not match prescription item patient <B>
```

Post-check confirms **zero corrupt rows**: the join-count of medications whose patient
differs from their owning prescription's patient is `0`, and the table holds no row
from the failed attempt.

## 15. Repairs 1–11 regression status

**Intact.** Widest non-legacy suite: **907 passed / 0 failed across 64 suites**.
Targeted medication, prescription, and security re-run: **172 passed / 8 files** —
`medicationPrescriptionIntegrity` (27), `medicationSchema`, `medicationEventIntegrity`,
`prescriptionPatientIntegrity` (Repair 1), `monitoringAlertVitalIntegrity` (Repair 11),
`suspendedProviderClinicalAccess` (Repair 3), `patientMedicationReadModelMigration`,
`medicationBackendContract`.

Notably `medicationSchema.integration.test.js:180-186` asserts `23503` for
`patient_medications.prescription_item_id` and for `prescriptions.patient_id`. Because
the trigger defers on unknown targets, those codes are unchanged — confirmed by the
dedicated "unknown prescription item still reports the pre-existing foreign key error" test.

## 16. Repair 10 medication-chain regression status

**Intact and explicitly verified.** Both guards are present and independently
effective on `patient_medications`:

- Repair 10's `patient_medications_parent_guard` still raises
  `Patient medication reassignment…` — tested through a **manual** medication
  (no prescription item) so Repair 12 cannot mask it.
- Repair 10's `medication_events_parent_chain` still raises
  `Medication event patient mismatch`.
- The test asserts the exact trigger set on `patient_medications` is
  `['patient_medications_parent_guard', 'patient_medications_prescription_guard']`.

The chain is now structurally closed end to end:
Patient → Encounter → Prescription → Prescription Item → Patient Medication →
Medication Schedule → Medication Event, with no cross-patient hop possible.

## 17. Historical inconsistencies found

**None.** The migration preflight ran clean and the validation script returns empty
result sets. The abort path is proven by test: with a deliberately corrupted
medication, validation reports exactly 1 row, the migration raises
`23514 'Medication prescription relationship repair stopped'`, and after the failed
migration the original row is still present and intact with neither the trigger nor
the function installed.

## 18. Files created

- `supabase/migrations/20261002160000_medication_prescription_patient_integrity.sql`
- `supabase/scripts/medication_prescription_validation.sql`
- `src/lib/medicationPrescriptionIntegrity.integration.test.js`
- `supabase/medication-prescription-integrity.md` (this document)

No existing file was modified.

## 19. Remaining risks

1. **Trigger cost on every prescribed-medication write.** Each insert/update performs
   a two-table join with `FOR SHARE`. Acceptable at current volumes; the new partial
   index on `prescription_item_id` keeps the lookup cheap. A very large deployment
   should watch lock contention against concurrently-written prescriptions.
2. **`prescribing_provider_id` is still unconstrained against the prescription.**
   Validation query 4 surfaces cross-patient combinations, but nothing blocks them.
   Out of scope here; worth a later decision.
3. **`prescriptions.patient_id` updates now have two guards.** Repair 1's FK and the
   new trigger both apply. Overlap is intentional, not duplicated logic, and the test
   proves Repair 12 does not fire when no medication is involved.
4. **No application producer exists yet.** Any future feature creating medications
   must pass the correct `prescription_item_id`, or leave it NULL for a manual entry.
   Mismatches will now fail loudly rather than silently.
5. **`FOR SHARE` in a BEFORE trigger.** Consistent with Repair 10, but it means a
   concurrent transaction holding a conflicting lock on the same prescription will
   block rather than fail fast. Standard behavior, not a defect.

## 20. Hosted deployment considerations

Nothing was deployed. The Supabase CLI is unavailable in this workspace; all
verification ran against PGlite with real PostgreSQL constraint, trigger, and RLS
semantics, simulating only managed Auth and Storage.

For hosted Supabase:

1. Run `supabase/scripts/medication_prescription_validation.sql` first as a trusted
   operator. If query 1 returns rows, the migration will abort — investigate
   manually; do not auto-repair clinical data.
2. `supabase db reset`, then `supabase db lint`, then `supabase test db`.
3. Apply with `supabase db push` or the dashboard migration runner. Do not paste the
   `create function` / `create trigger` DDL manually — the migration is a single
   transaction and is designed to be all-or-nothing.
4. `lock_timeout = 10s` may fail under heavy write load; that is intended safe
   behavior. Retry in a quieter window rather than raising the timeout.
5. No Edge Function or client redeploy is required. No new environment variables,
   grants, or secrets.
6. Verify after deployment:
   ```sql
   select tgname from pg_trigger
   where tgrelid = 'public.patient_medications'::regclass and not tgisinternal;
   -- expect patient_medications_parent_guard and patient_medications_prescription_guard
   ```