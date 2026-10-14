# Security Repair 6 — Payment/appointment patient ownership

## Discovery and root cause

Payments store a non-null patient and payer profile, optional appointment and
subscription references, amount, currency, status, transaction reference and
processing timestamps. At least one appointment or subscription reference is
required; both are allowed. There is no uniqueness constraint on appointment_id,
so multiple payment records per appointment are supported. Transaction references
are separately unique. The payment patient was caller-supplied, not derived.

`payments_create` required payer_profile_id=auth.uid(), patient authorization via
`can_access_patient(patient_id,'payments')`, pending status, and no paid/refunded
timestamps. It never checked the referenced appointment's patient. Thus A could
insert a payment under A while referring to B's appointment. Separate FKs checked
existence but not patient agreement. `payments_read` permits the payer or someone
authorized for the payment patient. No client UPDATE or DELETE policy exists.

Profiles/patients, appointments, subscriptions/packages, catalog/pricing rules,
payment policies, audit triggers and repository/Edge paths were inspected. Family
members with active can_make_payments authorization are legitimate payers; the
existing helper also controls other authorized roles. Family payment permission
does not necessarily grant appointment SELECT access. No implemented payment
gateway, webhook, payment RPC or real payment-creation repository was found.
Demo payment choices do not implement settlement. Trusted database/service-role
writes are supported by the schema, not evidence of a working external processor.

## Changes and enforcement

Forward migration: `migrations/20261002100000_payment_appointment_integrity.sql`.

The migration locks appointments/payments with a 10-second lock timeout and checks
all appointment-linked payments. Missing appointments or mismatched patients abort
with `23514` before enforcement is installed. Financial records are not rewritten.

It adds validated, nondeferrable `payments_appointment_patient_fk` on
`(appointment_id,patient_id)` referencing `appointments(id,patient_id)`, reusing
Repair 5's unique key. RESTRICT protects parent UPDATE/DELETE. INSERT and UPDATE
are enforced even for service-role/direct writes. Default MATCH SIMPLE preserves
NULL appointment_id for subscription-only payments; the existing at-least-one-parent
CHECK remains. A partial child index supports appointment-linked FK lookups without
indexing subscription-only rows. No table, old migration or existing trigger changes.

New helper: `can_create_payment_for_appointment(uuid,uuid)`. It first requires the
caller's existing payment-patient authorization, then checks appointment/patient
agreement when an appointment is supplied. It is stable SECURITY DEFINER with an
empty search_path, fully qualified references, and Boolean output only. PUBLIC and
anon execution are revoked; authenticated execution is granted. This permits the
existing family payment flow without expanding appointment read access.

`payments_create` now calls that helper with explicitly qualified outer columns.
Payer identity, pending status, paid_at and refunded_at restrictions remain.
SELECT visibility is unchanged. No UPDATE or DELETE policy is added. Clients cannot
claim a paid/refunded transaction through the creation policy. Financial amounts,
currencies, statuses and external references are not silently changed.

Application/Edge Function changes: none. Existing helpers and Repairs 1–5 are
unchanged. No notification or feature work was performed.

## Preflight and historical data

`scripts/payment_appointment_validation.sql` is a read-only administrator query.
It reports appointment orphans, cross-patient links, currency differences and
payment amounts differing from the appointment's authoritative price. Structural
issues are marked as blockers. Amount/currency discrepancies are review candidates,
not automatically corrected or presumed fraudulent. Multiple payments are allowed,
but installment/retry/refund allocation semantics are not defined; exact per-payment
amount equality cannot safely be inferred from this schema.

Normal local fixtures had no preflight findings. A deliberately corrupted historical
fixture produced one cross-patient payment. The migration aborted, preserving all
original financial fields and leaving no partial FK installation. These are synthetic
test findings; no hosted or persistent financial dataset was inspected.

## Tests and results

New suite: `src/lib/paymentAppointmentIntegrity.integration.test.js` — **28 passed**.
Real PostgreSQL/PGlite tests cover own creation/read, both directions of cross-patient
creation, forged patient identity, direct/service-role INSERT/UPDATE, parent mutation
without encounters, client UPDATE/DELETE denial, authorized/revoked family payers,
anonymous denial, subscription-only payments, multiple payments, status/timestamp
forgery denial, trusted direct processing, preserved historical fields/policies,
preflight and atomic abort, and Repairs 4/5 after Repair 6.

An initial test-fixture failure omitted revoked_at when revoking family permission.
The fixture was corrected to satisfy the existing CHECK; database rules were not
weakened. Final widest non-legacy run: **754 passed, 0 failed across 58 suites**.

- Repair 1: 16 passed.
- Repair 2: 32 passed.
- Repair 3: 43 passed.
- Repair 4: 33 database + 1 repository passed.
- Repair 5: 19 passed.

Exact independent exploit retest, outside the new suite: A attempted a pending
payment under A referencing B's appointment. The pre-Repair-6 database ACCEPTED
it; after migration the same INSERT was denied with **42501**. Both attempts were
rolled back; zero payment rows remained. Separate tests verify structural mismatch
rejection with **23503** under direct/service-role writes.

Three known legacy suites referring to removed migrations were excluded and not
counted as passing. No unrelated tests were modified. Earlier repair suites retain
their phase migration cutoffs; the new suite exercises the chain through Repair 6.
Managed Auth/Storage infrastructure is local; hosted grants/JWTs and concurrent
multi-session behavior were not verified.

## Files and operational considerations

Four new files only:

- `supabase/migrations/20261002100000_payment_appointment_integrity.sql`
- `supabase/scripts/payment_appointment_validation.sql`
- `src/lib/paymentAppointmentIntegrity.integration.test.js`
- `supabase/payment-appointment-integrity.md`

Nothing was deployed. Before deployment, run preflight as an authorized operator,
review historical financial mismatches manually, and assess locking/index-build
duration against production table sizes. The migration requires Repair 5's parent
unique key. Valid historical rows and pending/paid processing fields remain intact.
Any hosted-only webhook or import must supply a consistent patient/appointment pair.

This repair does not validate payment amount/currency against settlement rules,
implement a gateway, or add subscription-patient composite enforcement. Existing
subscription-only semantics remain; an appointment reference, when present, must
always match its patient. The notification update finding remains unresolved by
explicit scope. Database owners capable of disabling constraints remain trusted.
Rollback requires a reviewed forward migration; removing enforcement reopens the gap.

Stopped after Repair 6.
