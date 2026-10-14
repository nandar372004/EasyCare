# Security Repair 13 — Appointment/care-request patient integrity

## Root cause and existing workflow

`appointments` carried an independent `care_request_id -> care_requests(id)` foreign key
plus its own `patient_id -> patients(id)` foreign key. Each proved existence only. A
service-role or direct SQL write could therefore persist Patient A's appointment while
pointing at Patient B's care request, and the row was internally FK-valid.

The practical effect was worse than a read-metadata mismatch. The coordinator queue,
`care_assignments`, `visit_status_events` and coordinator authorization all resolve the
patient *through* `care_requests`, while `appointments_patient_read` authorizes on
`appointments.patient_id`. A cross-patient link lets an appointment be visible to one
patient yet attached to another patient's coordinator record.

## Verified care-request → appointment ownership chain

Verified from `20260820010300_booking.sql`, `20260821102000_patient_appointment_booking.sql`,
Repairs 3–12, the booking/care-request application code and the existing suites:

1. `care_requests.patient_id` — **yes**, `not null references patients(id) on delete
   restrict`, owned directly.
2. `appointments.care_request_id` — **nullable**, `on delete restrict`.
3. Appointments **without** a care request are fully supported: `care_request_id` is
   nullable, no policy or trigger requires it, and the application never sets it —
   the only `care_request` references in `src/` and `supabase/functions/` are in test
   fixtures. Every real patient and doctor booking is standalone.
4. **One care request may produce many appointments** — there is no unique constraint on
   `appointments.care_request_id`.
5. Care requests are created by `care_requests_create` (patient self-service, status
   `new`, urgency `unassessed`) or by service-role/coordinator code.
6. Appointments are created by `appointments_patient_create` (patient booking) or by
   trusted/service-role scheduling code; neither sets `care_request_id`.
7. `authenticated` has **no column grant** for `appointments.care_request_id`
   (`20260821102000` grants insert on a fixed column list), so a client can never supply
   the link. `service_role` and direct SQL can, which is exactly the audit finding.
8. `care_requests.patient_id` **can** be changed — `care_requests_coordinator_update`
   allows a coordinator or main admin to update the row, `patient_id` included.
9. `appointments.patient_id` can be changed only by `service_role`/direct SQL; no
   authenticated UPDATE policy or grant exists.
10. Downstream: `care_encounters.appointment_id` is already protected by Repair 5's
    `care_encounters_appointment_patient_fk`; `care_assignments` references both
    `care_request_id` and (nullable) `appointment_id` and is **not** protected — see
    the observations section.

## Changes

Forward migration: `migrations/20261002170000_appointment_care_request_patient_integrity.sql`.

- Locks `appointments` and `care_requests` in `share row exclusive` mode with a
  10-second `lock_timeout` while historical relationships are inspected. Any appointment
  whose `care_request_id` no longer resolves, or whose care request belongs to a
  different patient, aborts the migration with `23514` before enforcement is installed.
  Nothing is rewritten and no appointment is deleted.
- Adds `care_requests_id_patient_key unique (id, patient_id)` — the only supporting
  object required, and it adds no duplicated patient ownership column.
- Adds `appointments_care_request_patient_fk`, a validated composite foreign key
  `(care_request_id, patient_id) references care_requests(id, patient_id)` with
  `on update restrict on delete restrict`.

Declarative enforcement is the right mechanism here and no trigger is used. `care_requests`
carries `patient_id` directly, so the composite relationship needs no denormalization,
and a non-deferrable FK protects INSERT, UPDATE, `patient_id` mutation, `care_request_id`
mutation, `service_role` and direct SQL identically.

**Parent mutation protection** is inherent to the FK: re-parenting a care request that is
referenced by an appointment is rejected with `restrict_violation` (`23001`) from
`appointments_care_request_patient_fk`, and so is deleting a referenced care request.

**Null semantics.** Default `MATCH SIMPLE` means an appointment with
`care_request_id IS NULL` is not checked at all, so standalone doctor and patient
booking stays valid and `care_request_id` remains nullable. When `care_request_id` is
present, `patient_id` (not null) must equal the care request's patient. One care request
may still back many appointments.

RLS changes: none. Authorization is deliberately not broadened or narrowed — patients
keep `appointments_patient_read` and the availability-checked insert policy, no
authenticated UPDATE path exists, `can_access_patient` provider/family rules are
untouched, and Repair 3's `clinical_identity_required` policies still block
suspended/inactive/unverified providers. Helper/RPC changes: none. Grants: unchanged.

Application/Edge Function changes: none. No application code sets or updates
`care_request_id`, and no Edge Function writes appointments.

## Read-only preflight

`scripts/appointment_care_request_validation.sql` reports, without modifying anything:

1. **Blocking** — appointments whose linked care request is missing
   (`missing_care_request`) or belongs to a different patient (`patient_mismatch`).
2. Care requests with no linked appointment (informational).
3. **Reported, not repaired** — `care_assignments` whose care request and appointment
   describe different patients.
4. Encounters that disagree with their appointment patient (Repair 5 confirmation, so
   the full `Patient → Care Request → Appointment → Care Encounter` chain is auditable).

Local fixtures produced no findings and every existing appointment was preserved. A
deliberately corrupted fixture produced exactly one `patient_mismatch`; the migration
failed atomically, left the row byte-identical, and installed neither the unique key nor
the foreign key. These are synthetic findings — hosted data was not inspected.

## Care-assignment observations (reported, not fixed)

`care_assignments` holds both `care_request_id` (not null) and a nullable
`appointment_id`, and nothing proves the appointment — or even the assigned provider's
relationship to it — belongs to the care request's patient. A service-role insert can
therefore attach a care assignment for Patient A's care request to Patient B's
appointment. `care_assignments_read` authorizes through `care_requests.patient_id` while
assignment `provider_id` is trusted from the row, so this is a structural gap of the
same family. It is a **separate confirmed finding** and is deliberately not repaired
here; query 3 of the preflight surfaces it.

The `complaints ↔ appointments` LOW finding is also untouched.

## Validation

`src/lib/appointmentCareRequestIntegrity.integration.test.js` adds 25 PostgreSQL/PGlite
tests over the real migration chain (Repairs 1–12 applied, Repair 13 last).

ALLOW — service-role Patient A appointment for Patient A care request; two appointments
from one care request; a NULL-`care_request_id` service-role appointment; direct patient
booking without a care request (still priced by Repair 4); changing `patient_id` on an
appointment that has no care request; clearing `care_request_id` back to NULL; changing
`care_requests.patient_id` when nothing references it; encounter creation after a
care-request-backed appointment.

DENY — the exact audit exploit; service-role cross-patient INSERT both directions;
superuser (direct SQL, `role postgres`) cross-patient INSERT, `care_request_id` UPDATE and
`patient_id` UPDATE; moving a care request's patient while an appointment references it
(`23001`); deleting a referenced care request (`23001`); a patient supplying any
`care_request_id` at all; a patient booking for another patient; anonymous SELECT and
INSERT (`42501`); patient reads isolated to their own appointments.

Also asserted — the repair is a constraint, not a trigger (`pg_constraint` shows
`contype='f'`, `confmatchtype='s'`, `confupdtype/confdeltype='r'`, and no
`appointments_care_request_patient_fk` trigger exists); the full `pg_policies` snapshot
and every historical appointment row are unchanged; the validation script returns no
rows on healthy data; Repair 4 still reprices a service-role booking and still blocks
`fee_amount` updates; Repair 5 still blocks encounter/appointment patient mismatch;
Repair 3 still denies a suspended provider.

Independent exploit retest in an isolated rollback transaction: `service_role` updating
Patient A's appointment to Patient B's care request. Before migration: **ACCEPTED**
(patient_id Patient A, care_request_id Patient B). After: **`23503`**, constraint
`appointments_care_request_patient_fk`. Both attempts rolled back, the original link was
restored, and the cross-patient join count was **0**.

## Files and operational considerations

Four new files only:

- `supabase/migrations/20261002170000_appointment_care_request_patient_integrity.sql`
- `supabase/scripts/appointment_care_request_validation.sql`
- `src/lib/appointmentCareRequestIntegrity.integration.test.js`
- `supabase/appointment-care-request-integrity.md`

Nothing was deployed. No earlier migration, policy, grant, repository or Edge Function
was modified.

Before deployment, run the preflight as an authorized operator. Any structurally
inconsistent historical appointment blocks this migration by design and must be resolved
by clinical review, not silent rewriting. The migration takes table locks on
`appointments` and `care_requests`; assess lock duration on real table sizes. The added
unique key is a small extra index on an existing table. Hosted schema/grants and any
ingestion path outside this repository need staging verification. Owners able to drop
constraints remain trusted administrators.

Remaining risks: the preflight's care-assignment query reports a real unrepaired gap (see
above); parent-side violations surface as `23001` rather than `23503`, so error handling
in trusted scheduling code should treat both as "rejected"; existing single-column
`appointments_care_request_id_fkey` remains in place and is redundant but harmless.

Three known obsolete suites (`bookableDoctorSeed`, `phase4DatabaseSchema`,
`phase9AppointmentManagement`) and `.kilo/worktrees/**` duplicates are excluded from the
non-legacy run and are not counted as passing. Stopped after Repair 13; complaints,
Database V2, Family Health, Dashboard, Care Plan, Health Story, I Need Care and AI
Health Guardian remain untouched.