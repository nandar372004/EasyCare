# Security Repair 8 — Vital-reading/encounter patient integrity

## Root cause and existing workflow

The original separate foreign keys checked that a patient and encounter existed,
but not that they belonged together. `vitals_assigned_create` required the caller's
recorded_by identity, a clinical role and patient authorization. It did not compare
the encounter patient. An authorized doctor could therefore insert a vital for A
referencing B's encounter. RLS filtering the resulting row did not correct this
structural mismatch.

The vital, encounter, appointment, patient/provider schema, policies, grants,
constraints, helpers, triggers, tests, repositories and Edge references were
inspected. encounter_id is nullable and standalone vitals are supported. patient_id
is supplied by writers. Existing provider authorization is patient-based through an
appointment or assigned/accepted care assignment, not a requirement that the caller
personally created the encounter. Repair 3 additionally requires active authorized
clinical identity. These semantics remain unchanged.

Patient self-entry is not currently allowed: the INSERT policy requires doctor,
nurse or caregiver. Patients can read authorized vitals. No client UPDATE/DELETE
policy exists. Device is a supported source enum; trusted direct/service-role writes
are possible, but no device-ingestion RPC, importer or vital-writing Edge/repository
path was found. Current dashboard/context code reads vitals. This repair does not
invent self-entry or ingestion features.

## Changes

Forward migration: `migrations/20261002120000_vital_encounter_integrity.sql`.

- Locks encounters/vitals while inspecting historical relationships, with a
  10-second lock timeout. Missing or mismatched non-null encounter links abort
  migration with `23514` before enforcement is installed.
- Adds validated, nondeferrable `vital_readings_encounter_patient_fk` from
  `(encounter_id,patient_id)` to `care_encounters(id,patient_id)`, reusing the existing
  `care_encounters_id_patient_key`.
- Uses RESTRICT for parent UPDATE/DELETE. INSERT and UPDATE are enforced even for
  service-role/direct writes. Default MATCH SIMPLE retains valid NULL encounter_id
  standalone vitals; patient_id remains NOT NULL.
- Adds a partial `(encounter_id,patient_id)` index for linked-vital FK lookups. The
  existing patient/time query index serves a different purpose and remains intact.

RLS changes: none. Helper/RPC/trigger changes: none. Grants: unchanged.
Application/Edge changes: none. All new SQL references are explicitly qualified.
No old migrations, clinical measurements, generated aliases, authorization rules,
downstream records or Repairs 1–7 were modified.

## Read-only preflight

`scripts/vital_encounter_validation.sql` reports:

1. Non-null encounter links with missing encounters or different patient IDs.
2. Monitoring alerts linked to those inconsistent vitals, missing vital references,
   or independent alert/vital patient differences requiring review.

Monitoring alerts are the direct FK-linked downstream table. Free-form AI source
snapshots are not rewritten or inferred from this query. Only vital/encounter
structural mismatches block this migration; no alert relationship repair is made.

Normal local fixtures had no findings and existing measurements were preserved.
A deliberately corrupted historical fixture produced one inconsistent vital and one
affected alert. Migration failed atomically and preserved both rows, without partial
FK installation. These are synthetic test findings; hosted data was not inspected.

## Validation

`src/lib/vitalEncounterIntegrity.integration.test.js` adds 20 PostgreSQL/PGlite tests:
valid provider insertion and patient reads; standalone provider/service writes;
device-source writes; patient self-entry remaining denied; the exact exploit;
direct/service-role INSERT and UPDATE; attaching a standalone reading to the wrong
encounter; parent patient changes/deletion; unchanged RLS and historical values;
unrelated, suspended, inactive, unverified and anonymous denial; and preflight/abort
behavior with an affected alert.

Independent exploit retest outside the suite: the assigned doctor inserted Patient
A's vital against Patient B's encounter. Before migration: **ACCEPTED**. After:
**23503**, constraint `vital_readings_encounter_patient_fk`. Both attempts were
rolled back; zero audit vital rows remained. Enforcement is relational, not merely
an authorization filter.

## Files and operational considerations

Four new files only:

- `supabase/migrations/20261002120000_vital_encounter_integrity.sql`
- `supabase/scripts/vital_encounter_validation.sql`
- `src/lib/vitalEncounterIntegrity.integration.test.js`
- `supabase/vital-encounter-integrity.md`

Nothing was deployed. Before deployment, run the preflight as an authorized operator
and review existing mismatches without automatically choosing a replacement patient
or encounter. Assess lock and index-build time on real table sizes. Existing separate
FKs remain; any structurally inconsistent historical row prevents this validated FK
from being added. Hosted schema/grants, ingestion paths outside this repository and
multi-session concurrency require staging verification. Owners capable of disabling
constraints remain trusted administrators.

Three known obsolete suites requiring removed migrations are excluded from the
non-legacy run, not counted as passing. Tests use real PostgreSQL enforcement with
local managed Auth/Storage infrastructure. Earlier suites retain their phase cutoffs;
the new suite exercises all repairs through Repair 8.

Subscription-payment and medication-event relationship findings remain out of scope.
No feature work was started. Rollback requires a reviewed forward migration; simply
removing this constraint would reopen the gap. Stopped after Repair 8.
