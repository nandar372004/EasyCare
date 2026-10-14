# Critical Security Repair 5 — Encounter/appointment patient integrity

## Root cause and scope

`encounters_provider_manage` checked the caller's provider identity and appointment
assignment but never compared the encounter patient with the appointment patient.
Separate foreign keys only established that both patients existed. Consequently,
a doctor assigned to A's appointment could create an encounter naming B, then a
prescription naming B that satisfied Repair 1's encounter/patient foreign key.
Repair 2's parent guards only protected encounters with follow-up children.

The migration chain, encounter policies, constraints, triggers, repositories and
Edge Functions were inspected. Repository/Edge encounter usage is read-only;
there is no existing encounter-creation RPC to strengthen. The database is the
appropriate boundary for direct client and service-role writes.

Ordinary clinical writes already require both the caller's unique provider identity
and that provider's appointment assignment. Administrator policies explicitly
allow a different encounter provider; no general transfer workflow was discovered.
This existing administrative exception is preserved rather than introducing a
global provider-equality constraint. Provider differences are reported for review.

## Changes

Forward migration: `migrations/20261002090000_encounter_appointment_integrity.sql`.

- Locks appointments and encounters while checking existing patient relationships,
  with a 10-second lock timeout. Structural mismatches abort the transaction before
  enforcement objects are created. No clinical records are rewritten.
- Adds `appointments_id_patient_key UNIQUE(id, patient_id)` as the referenced key.
- Adds validated, nondeferrable `care_encounters_appointment_patient_fk` from
  `(appointment_id, patient_id)` to `appointments(id, patient_id)`, with RESTRICT
  on parent UPDATE/DELETE. This protects child INSERT/UPDATE and parent mutations
  even when RLS is bypassed. Both child fields already have NOT NULL constraints.
- Reuses the existing unique index on encounter `appointment_id` for child lookups;
  no additional child index or trigger is introduced.
- Adds `can_manage_care_encounter(appointment_id, patient_id, provider_id)`.
  The caller-bound Boolean helper checks active identity, parent patient equality,
  clinical role, verified provider identity and appointment-provider assignment.
  The active administrator exception retains patient equality. It uses SECURITY
  DEFINER and empty search_path because ordinary providers cannot SELECT appointment
  rows under the existing patient-only booking policy. PUBLIC/anon execution is
  revoked; authenticated execution is granted.
- Changes both USING and WITH CHECK on `encounters_provider_manage` to call the
  helper with explicitly qualified encounter columns. Other read policies and
  Repair 3's restrictive policy remain intact. Repairs 1/2 constraints and triggers
  are unchanged. Repair 4's pricing boundary is unchanged.

No application, repository, UI, Edge Function, existing helper or old migration was
modified. No changes were made to payments, notifications or feature tables.

## Preflight and historical data

`scripts/encounter_appointment_validation.sql` is read-only and returns:

1. Missing appointments and mismatched encounter/appointment patients, marked as
   structural blockers; differing providers, marked as review candidates.
2. Downstream prescriptions whose encounter/appointment patient chain is inconsistent.

Existing individual FKs continue to enforce patient/provider record existence.
Only structural patient mismatches block this migration; provider differences alone
do not, because the existing administrator exception is retained.

The normal local fixtures had no preflight findings and survived unchanged. A
deliberately corrupted fixture produced one mismatched encounter and one affected
prescription. Migration execution failed with `23514` and left the clinical rows
unchanged, without partially installing the constraint. These are synthetic test
findings; no hosted dataset was inspected or corrected.

## Validation

New PostgreSQL integration suite: `src/lib/encounterAppointmentIntegrity.integration.test.js`.
**19 passed.** Tests cover valid priced appointment/encounter/prescription/follow-up
flow; authorized patient reads; cross-patient insert and update; appointment swap;
service-role/direct-write enforcement; parent mutation; anonymous/unrelated provider
denial; suspended/inactive helpers and writes; provider substitution; the administrator
exception; preservation of other policies/data; downstream Repairs 1/2 constraints;
and atomic failure on historical inconsistencies.

Widest available non-legacy run: **726 passed, 0 failed across 57 suites**.
Repair 1: 16 passed. Repair 2: 32 passed. Repair 3: 43 passed.
Repair 4: 33 database tests and 1 repository test passed.

Independent exploit retest, outside the new test suite: Patient A booked a slot
with client price zero; the database stored 30,000 MMK. The assigned doctor attempted
an encounter naming B. **Denied at encounter INSERT with `42501`; zero forged
encounters existed afterward.** The downstream forged-prescription stage could not
proceed. Separate integration cases prove the FK rejects structural mismatches with
`23503` even under service-role/direct writes.

Three known legacy suites requiring removed migrations were excluded and not counted
as passing. No unrelated tests were changed. PGlite runs real PostgreSQL constraints
and RLS, with local managed Auth/Storage infrastructure; hosted authentication and
multi-session concurrency were not exercised. Earlier repair tests retain their
phase-specific migration cutoffs; the new suite exercises the combined chain.

## Files and deployment

Four new files only:

- `supabase/migrations/20261002090000_encounter_appointment_integrity.sql`
- `supabase/scripts/encounter_appointment_validation.sql`
- `src/lib/encounterAppointmentIntegrity.integration.test.js`
- `supabase/encounter-appointment-integrity.md`

No hosted deployment was performed. Before deployment, run the preflight as an
authorized administrator, review findings without automatically choosing which
clinical identity to overwrite, and assess lock/index-build time against real table
sizes. Applying the validated FK requires all historical patient pairs to agree.
Live provider differences warrant review but do not alone fail migration. Validate
hosted schema/grants and operational concurrency in staging. Database owners capable
of disabling constraints remain trusted administrators.

Rollback requires a reviewed forward migration; removing the FK/helper policy would
reopen the gap. The previously reported payment relationship and notification-update
findings remain unresolved by explicit scope. Stop after Repair 5.
