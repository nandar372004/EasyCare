# Prescription-to-patient integrity repair

Scope: Critical Security Repair 1 only.

The previous INSERT policy compared `e.patient_id = patient_id`. PostgreSQL
resolved the unqualified name inside the subquery, making it a self-comparison.
The existing independent FKs only established that both rows existed.

## Before deployment

Run `scripts/prescription_relationship_validation.sql` as a trusted operator
with visibility of all prescriptions. The first query reports mismatched or
missing encounter/patient relationships; the second reports provider attribution
that differs from the existing browser prescribing rule. Review results privately
with the responsible clinical operator. Do not automatically rewrite or delete
clinical rows. This repository change does not assert that deployed rows are clean.

Migration `20261001090000_prescription_patient_integrity.sql` repeats the patient
preflight while holding write-conflicting locks. If inconsistencies exist, it
raises an error with their count and rolls back without changing records or
policies. The separate attribution report requires operator review; it is not a
new structural provider-equality constraint or retrospective role inference.

## Enforcement

- Reuses the existing encounter `(id, patient_id)` UNIQUE key.
- Adds a validated, non-deferrable composite FK from prescriptions. The existing
  NOT NULL encounter/patient columns prevent null bypass. INSERTs, UPDATEs,
  service-role writes and referenced parent-patient changes are covered.
- Retains all existing individual FKs and rows. Adds a supporting child index
  for parent-reference checks, not a second parent UNIQUE key.
- Corrects INSERT RLS using qualified outer columns. The actor must be a doctor,
  own the prescribing provider identity, and be the encounter's provider.
  Existing provider-directory/encounter visibility rules still apply.
- Leaves patient SELECT and prescription-item policies unchanged. No browser
  UPDATE policy is introduced; trusted updates are subject to the composite FK.

No runtime application edits are needed: the repository only lists prescriptions;
no production prescription creation service/Edge flow was found. The presentation
prescription page remains outside this repair.

## Operational limits

The migration scans prescriptions and builds a child index while blocking writes
to prescriptions/encounters. Use an appropriate deployment window for large tables;
the 10-second lock timeout causes a safe abort if locks cannot be acquired. No live
database migration is run by these tests. Service-role attribution remains trusted,
as before; the new patient FK cannot be bypassed merely by bypassing RLS. A database
owner can still deliberately disable constraints, outside the application threat
model. Do not roll back to the vulnerable policy; remedy deployment issues forward.

Tests use real PostgreSQL via PGlite and the full preceding migration chain, with
minimal managed Auth/Storage fixtures. They do not certify hosted Auth/PostgREST.
