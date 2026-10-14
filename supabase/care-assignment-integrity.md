# Security Repair 14 — Care assignment/appointment patient integrity

## Root cause

`care_assignments` held two independent foreign keys — `care_request_id -> care_requests(id)`
and `appointment_id -> appointments(id)` — and no column of its own carrying a patient.
Nothing proved that the two references resolved to the same person. A service-role or
direct SQL write could therefore attach Patient A's care request to Patient B's
appointment and persist a structurally valid, cross-patient coordinator chain.

This is materially different from a read-metadata mismatch. `assignments_read`
authorizes on `care_requests.patient_id`, `can_access_patient` grants provider access
through `care_assignments -> care_requests`, and `care_requests.patient_id` is the
identity used by the coordinator queue and by Repair 13's appointment link. A broken
assignment chain therefore misroutes a clinical match, not just a listing.

## Verified ownership chain

Verified from `20260820010300_booking.sql`, `20260820010900_ai_security.sql`, Repairs 3,
5 and 13, and every fixture in `src/` that touches the table:

1. `care_assignments` has **no `patient_id`** column — ownership is two hops away.
2. `appointment_id` is **nullable** and there is no table-level NOT NULL.
3. Assignments **without** an appointment are a first-class state: `status` includes
   `suggested`, `assigned`, `rejected`, `cancelled` (no appointment yet), and **every
   existing fixture in the repository inserts assignments with NULL `appointment_id`**
   (11 test files). The coordinator matches a provider first and books afterwards.
4. `care_request_id` is **mandatory** (`not null`, `on delete restrict`).
5. **Multiple assignments per care request** are normal and are the point of the table
   (provider matching); only `status in ('assigned','accepted')` grants access.
6. **Multiple assignments may reference one appointment** — no unique constraint exists
   and none is required by the domain.
7. Creators: `assignments_coordinator_manage` (`for all to authenticated`) for the
   care request's coordinator or a main admin, plus trusted/service-role code.
8. `authenticated` has no `care_request_id`/`appointment_id` limitation, so coordinators
   can set both; `service_role` bypasses RLS entirely.
9. `care_requests.patient_id` is mutable by a coordinator (`care_requests_coordinator_update`);
   `appointments.patient_id` is mutable by `service_role`/direct SQL.
10. Ownership resolves as `care_assignments.care_request_id -> care_requests.patient_id`
    and `care_assignments.appointment_id -> appointments.patient_id`.

## Invariant selected, and why

**Same-patient ownership** (the minimum): when `appointment_id` is not null, the
appointment's `patient_id` must equal the care request's `patient_id`.

The stricter alternative — requiring
`care_assignments(care_request_id, appointment_id) -> appointments(care_request_id, id)`
— was evaluated and **rejected**. It would be expressible as a composite FK, but it
demands that the appointment itself already carries the assignment's `care_request_id`.
Appointments in this application are created standalone with `care_request_id IS NULL`
(no application or Edge Function code ever sets it), so the composite FK would reject
the legitimate coordinator workflow: match a provider to a care request, book the
appointment, then link the two. The stronger invariant is not supported by the observed
domain semantics.

A composite FK is therefore not merely unnecessary but wrong here: the only composite
relationship the child can hold with its parent is `(care_request_id, appointment_id)`
against `(care_requests.id, appointments.id)`, and adding `care_assignments.patient_id`
to enable `(care_request_id, appointment_id, patient_id)` is exactly the denormalization
this repair is told not to introduce.

Enforcement is therefore the smallest safe database-level mechanism that can express
same-patient ownership without denormalization: a `BEFORE` trigger chain that resolves
both parents, consistent with Repairs 2 and 10.

## Changes

Forward migration: `migrations/20261002180000_care_assignment_appointment_patient_integrity.sql`.

- Locks `care_assignments`, `care_requests` and `appointments` in
  `share row exclusive` mode with a 10-second `lock_timeout` while historical
  relationships are inspected. Any assignment whose `appointment_id` no longer resolves,
  or whose request and appointment patients differ, aborts the migration with `23514`
  before enforcement is installed. Nothing is rewritten or deleted.
- Adds `public.check_care_assignment_patient_chain()` — `security definer`,
  `search_path = ''`, fully qualified references, execute revoked from
  `public`/`anon`/`authenticated` — with one branch per table of the chain:
  - `care_assignments`: when `appointment_id` is not null, locks the care request and
    appointment `for share` and raises `23514 Care assignment patient mismatch` if either
    side cannot be resolved or the patients differ. A NULL `appointment_id` returns
    immediately.
  - `care_requests`: a `patient_id` change that would leave any linked assignment
    pointing at an appointment of a different patient raises
    `23514 Care request reassignment would invalidate care assignment patient ownership`.
  - `appointments`: a `patient_id` change that would strand any assignment whose care
    request belongs to a different patient raises
    `23514 Appointment patient reassignment would invalidate care assignment patient ownership`.
- Triggers: `care_assignments_patient_chain` on
  `before insert or update of care_request_id, appointment_id`, plus the two parent
  guards on `update of patient_id`.

`appointment_id` stays nullable and no unique constraint or index is added; the parent
guards are the only mechanism needed, and deletes remain covered by the existing
`on delete restrict` foreign keys.

### Interaction with Repair 13

Repair 13's `appointments_care_request_patient_fk` is a no-action-to-restrict composite FK
on `(care_request_id, patient_id)`. It is untouched and still blocks re-pointing an
appointment at another patient's care request. It deliberately does **not** fire for an
appointment with `care_request_id IS NULL`, which is precisely the standalone appointment
a coordinator links to an assignment — this repair fills that gap without weakening
Repair 13, and a standalone appointment linked to a same-patient assignment is allowed
and asserted. Assignments whose request is Patient A may reference a Patient A
standalone appointment; only the patient identity is required.

### Interaction with Repair 5

`care_encounters.appointment_id` remains guarded by
`care_encounters_appointment_patient_fk`. The full chain
`Patient -> Care Request -> Care Assignment -> Appointment -> Care Encounter` now holds
at every repaired boundary, and preflight query 4 reports any encounter that disagrees
with the assignment chain rather than silently trusting it.

## RLS / authorization

No RLS, policy or grant change. Access is not broadened: patients still cannot manage
`care_assignments`, coordinators still require ownership of the care request or
`is_main_admin()`, `assignments_read` still resolves through `can_access_patient`, and
Repair 3's `clinical_identity_required` still blocks suspended/inactive/unverified
providers. Structural integrity holds for `service_role` and direct SQL because the
trigger function is `security definer` and is not bypassed by RLS.

Note for correct expectations: for `INSERT`, PostgreSQL evaluates `BEFORE` row triggers
before the RLS `WITH CHECK` policy, so a coordinator's cross-patient attempt is refused
at the relational boundary (`23514`) rather than at the policy (`42501`). Both are
refusals; the tests assert each precisely.

## Read-only preflight

`scripts/care_assignment_validation.sql` reports, without modifying anything:

1. **Blocking** — assignments whose appointment is `missing_care_request`,
   `missing_appointment` or `patient_mismatch`.
2. Assignments still awaiting an appointment (legitimate coordinator state).
3. Appointments referenced by several assignments, for coordinator review.
4. Encounters under an assignment's appointment that disagree on the patient
   (Repair 5 confirmation across the whole chain).

Local fixtures produced no findings and every historical assignment was preserved. A
deliberately corrupted fixture produced exactly one `patient_mismatch`; the migration
failed atomically, the row stayed byte-identical, and `check_care_assignment_patient_chain`
was not created.

## Validation

`src/lib/careAssignmentAppointmentIntegrity.integration.test.js` adds 26 PostgreSQL/PGlite
tests over the real chain (Repairs 1–13 applied, Repair 14 last).

ALLOW — service-role Patient A request → Patient A appointment; the real coordinator
flow (match with NULL `appointment_id`, book, then link); assignments with NULL
`appointment_id` kept alongside an existing appointment; several assignments per one
care request; several same-patient assignments on one appointment; a coordinator
inserting a valid assignment; status/`responded_at` updates on an assignment; parent
ownership moves when nothing links the two sides; encounter creation after a valid
assignment chain.

DENY — the exact audit exploit; Patient B request → Patient A appointment; service-role
and superuser (`role postgres`) cross-patient INSERT; `UPDATE appointment_id` to another
patient's appointment; `UPDATE care_request_id` to another patient's request; a patient
managing an assignment; anonymous creation; moving `care_requests.patient_id` or a
standalone `appointments.patient_id` while a linked assignment disagrees; deleting a
referenced care request or appointment.

Also asserted — the three triggers and the function exist; historical assignment rows and
the full `pg_policies` snapshot are unchanged; Repair 5, Repair 13 and Repair 4 all still
reject their respective violations; Repair 3 still denies a suspended provider.

Independent exploit retest in an isolated rollback transaction: `service_role` inserting
a Patient A care request assignment against Patient B's appointment. Before migration:
**ACCEPTED**. After: **`23514 Care assignment patient mismatch`**. Both rolled back, zero
cross-patient assignment rows remained.

## Files and operational considerations

Four new files only:

- `supabase/migrations/20261002180000_care_assignment_appointment_patient_integrity.sql`
- `supabase/scripts/care_assignment_validation.sql`
- `src/lib/careAssignmentAppointmentIntegrity.integration.test.js`
- `supabase/care-assignment-integrity.md`

Nothing was deployed. No earlier migration, policy, grant, repository or Edge Function
was modified. No application or Edge Function code writes `care_assignments`, so no client
change was needed.

Before deployment, run the preflight as an authorized operator. Any structurally
inconsistent historical assignment blocks this migration by design and must be resolved by
coordinator/clinical review, not silent rewriting. The migration takes table locks on
three tables; assess lock duration on real table sizes. Two extra row triggers on
`care_requests`/`appointments` run only on `patient_id` updates, and the assignment
trigger only on insert or on `care_request_id`/`appointment_id` updates, so booking and
confirmation paths are unaffected. Hosted schema/grants and coordinator tooling outside
this repository need staging verification. Owners able to drop triggers remain trusted
administrators.

Remaining risks: the invariant is same-patient, not same-care-flow, so a coordinator may
still attach Patient A's appointment to Patient A's *other* care request — intentional
and reported by preflight query 3 rather than forbidden; the same-patient check resolves
two parents on every assignment write and is a small cost on the coordinator path;
`care_assignments` still has no index supporting `appointment_id` lookups (pre-existing).

The `complaints ↔ appointments` LOW finding remains unrepaired by design. Stopped after
Repair 14; Database V2, Family Health, Dashboard, Care Plan, Health Story, I Need Care
and AI Health Guardian remain untouched.