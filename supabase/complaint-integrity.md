# Security Repair 15 — Complaint/appointment patient integrity

## Root cause

`complaints` carried two independent foreign keys — `patient_id -> patients(id)` and
`appointment_id -> appointments(id)` — and both columns are nullable. Each FK proved
existence only, so any submitter could persist a complaint whose `patient_id` and
appointment's `patient_id` disagreed, including a patient filing a complaint against
another patient's appointment.

## Verified complaint ownership model

Verified from `20260820010800_governance.sql`, `20260820010900_ai_security.sql`,
Repairs 3/5/13/14, and a repository-wide search of `src/` and `supabase/functions/`:

1. `complaints.patient_id` — **exists directly** but is **nullable**.
2. `complaints.appointment_id` — **nullable**.
3. Standalone complaints are legitimate: a complaint may have a patient and no
   appointment, no patient and no appointment (a general service complaint), and the
   `complaints_create` policy explicitly permits `patient_id is null`.
4. Submitters: `complaints_create` requires `submitted_by_profile_id = auth.uid()`, so any
   authenticated caller may submit one; the policy only adds
   `patient_id is null or can_access_patient(patient_id,'view')`.
5. **Family/caregiver submission is supported and legitimate.** `can_access_patient(...,'view')`
   is granted to an active `family_authorizations` row with `can_view_records`, so an
   authorized family member may file a complaint *for* the patient. The submitter is
   therefore deliberately **not** required to be the patient's own profile.
6. Staff/admin: there is no staff insert policy; main admins may submit like any caller
   (`submitted_by_profile_id = auth.uid()`), and `service_role` writes are unconstrained
   by RLS. `complaints_read` is `submitted_by_profile_id = auth.uid() or is_main_admin()`.
7. `complaints.patient_id` and `complaints.appointment_id` are **not** mutable by any
   authenticated client — there is no UPDATE policy and no UPDATE grant. Only
   `service_role`/direct SQL can change them.
8. `appointments.patient_id` is mutable by `service_role`/direct SQL.
9. `submitted_by_profile_id` is "any authorized submitter": the patient themselves, an
   authorized family member/caregiver with view access, a main admin, or a trusted
   service-role process. It never denotes the provider.

No application or Edge Function code writes `complaints`; the only `complaint`-named
match in the codebase is `care_encounters.chief_complaint`, an unrelated free-text field.

## Invariant

When `complaints.appointment_id` is not null, `complaints.patient_id` must equal
`appointments.patient_id`. Submitter authorization is a separate concern handled
unchanged by RLS.

## Changes

Forward migration: `migrations/20261002190000_complaint_appointment_patient_integrity.sql`.

- Locks `complaints` and `appointments` in `share row exclusive` mode with a
  10-second `lock_timeout` while historical relationships are inspected. Any complaint
  whose `appointment_id` no longer resolves, or whose patient differs from the
  appointment's patient, aborts the migration with `23514` before enforcement is
  installed. Nothing is deleted or rewritten.
- Adds `complaints_appointment_patient_fk`,
  `foreign key (appointment_id, patient_id) references appointments(id, patient_id)
  on update restrict on delete restrict`. **Repair 5's existing
  `appointments_id_patient_key unique (id, patient_id)` is reused as the target — no
  duplicate unique constraint or index was created** (asserted in the suite: exactly one
  `(id, patient_id)` unique constraint exists on `appointments`).
- Default `MATCH SIMPLE` is used, as the null-preserving semantics this relationship
  requires: a complaint with `appointment_id IS NULL` (general or patient-only complaint)
  is not checked, and `complaints.patient_id` remains nullable. When `appointment_id` is
  present, `patient_id` must match the appointment's patient.
- Adds `public.check_complaint_appointment_patient_chain()` (`security definer`,
  `search_path = ''`, fully qualified, execute revoked) and trigger
  `appointments_complaint_guard` on `before update of patient_id`.

### Parent mutation protection

The composite foreign key covers INSERT and UPDATE of `patient_id`/`appointment_id` on
`complaints`, and `ON UPDATE RESTRICT`/`ON DELETE RESTRICT` on the appointment side.

One path is not covered by the foreign key alone: a **standalone** appointment
(`care_request_id IS NULL`) is skipped by both Repair 13's composite FK and this one,
because `MATCH SIMPLE` does not evaluate a key with a NULL column. Its `patient_id`
could therefore be re-parented and orphan a compliant complaint link.
`check_complaint_appointment_patient_chain()` closes exactly that path and nothing
more — it fires only when `new.patient_id is distinct from old.patient_id` and only
complaints that actually name a patient are considered.

RLS changes: **none**. `complaints_read`, `complaints_create`, `can_access_patient`,
patient isolation, family authorization and Repair 3's provider restrictions are all
untouched; no access was broadened. Trigger/helper changes: one function and one trigger.
Application/Edge Function changes: none required.

## Read-only preflight

`scripts/complaint_appointment_validation.sql` reports, without modifying anything:

1. **Blocking** — complaints whose appointment is `missing_appointment` or
   `patient_mismatch`.
2. **Reported, not blocking** — complaints linked to an appointment but carrying no
   `patient_id` (structurally incomplete link rather than a cross-patient one; see
   residual findings).
3. A count by complaint shape (`general_complaint`, `patient_complaint_without_appointment`,
   `appointment_complaint`) so existing legitimate shapes are auditable.
4. **Repair 5 confirmation** — encounters under a complained-about appointment that
   disagree on the patient.

Local fixtures produced no findings and every historical complaint was preserved. A
deliberately corrupted fixture produced exactly one `patient_mismatch`; the migration
failed atomically, the complaint row stayed byte-identical, and
`complaints_appointment_patient_fk` was not installed.

## Validation

`src/lib/complaintAppointmentIntegrity.integration.test.js` adds 29 PostgreSQL/PGlite
tests over the real chain (Repairs 1–14 applied, Repair 15 last).

ALLOW — patient complaint about their own appointment; standalone general complaint
(neither patient nor appointment); patient complaint about a patient without an
appointment; authorized family member submitting for an authorized patient; service-role
complaint on a patient's behalf; complaint reads limited to the submitter and main
admins; unrelated complaint workflow columns (`status`, `resolved_at`, `resolution`)
updating; appointment ownership moving when no complaint names a patient; cross-patient
family member denied; impersonating another submitter denied.

DENY — the exact audit exploit (Patient A complaint → Patient B appointment); Patient B
complaint → Patient A appointment; service-role cross-patient INSERT; direct superuser
(`role postgres`) cross-patient INSERT; `UPDATE appointment_id` to another patient's
appointment; `UPDATE patient_id` to conflict with the appointment; standalone
appointment ownership moving while a complaint disagrees; unauthorized family member;
anonymous creation; deleting an appointment referenced by a complaint (`23001`).

Also asserted — the composite FK exists with `confmatchtype='s'` and `r/r` update/delete
actions; exactly one `(id, patient_id)` unique constraint exists on `appointments` (no
duplicate key created); the parent guard trigger exists; historical complaints and the
full `pg_policies` snapshot are unchanged; Repair 5, Repair 13, Repair 14 and Repair 4
all still reject their respective violations; Repair 3 still denies a suspended provider.

Independent exploit retest in an isolated rollback transaction: Patient A authenticated,
`patient_id` = Patient A, `appointment_id` = Patient B's appointment,
`submitted_by_profile_id` = Patient A's own profile. Before migration: **ACCEPTED**.
After: **`23503`**, constraint `complaints_appointment_patient_fk`. Both rolled back;
zero cross-patient complaint rows remained.

## Files and operational considerations

Four new files only:

- `supabase/migrations/20261002190000_complaint_appointment_patient_integrity.sql`
- `supabase/scripts/complaint_appointment_validation.sql`
- `src/lib/complaintAppointmentIntegrity.integration.test.js`
- `supabase/complaint-integrity.md`

Nothing was deployed. No earlier migration, policy, grant, repository or Edge Function
was modified.

Before deployment, run the preflight as an authorized operator. Any cross-patient
complaint blocks this migration by design and must be resolved by governance/complaints
review, not silent rewriting. The migration takes table locks on `complaints` and
`appointments`; assess lock duration on real table sizes. The added FK reuses Repair 5's
existing unique key, so no new index is built; the one new trigger fires only on
`appointments.patient_id` updates. Hosted schema/grants and complaints tooling outside
this repository need staging verification. Owners able to drop constraints/triggers
remain trusted administrators.

## Remaining known security findings (reported, not fixed)

**Appointment-linked complaint with a NULL `patient_id`.** *Severity: LOW.*
*Affected relationship: `complaints.appointment_id -> appointments.id`.* `MATCH SIMPLE`
does not evaluate the composite key when any child column is NULL, so a complaint with
`appointment_id` set and `patient_id` NULL still inserts. **Evidence:** preflight query 2
lists such rows by design; the suite asserts one can be created and that it does not
block appointment re-parenting. *Exploitability:* low — `complaints_read` restricts
visibility to the submitter and main admins, so this is a structurally incomplete
governance link (a complaint about an appointment that names no patient) rather than a
cross-patient disclosure or a bypass of the repaired mismatch invariant. Closing it
would require forcing `patient_id` NOT NULL whenever `appointment_id` is present, a
tightening beyond the audited finding. **Not fixed in this task.**

No other table carries both a `patient_id` and an appointment link, so no further
appointment-scoped patient relationship is outstanding: `feedback`, `visit_status_events`
and `teleconsultation_sessions` reference `appointments(id)` only and have no
`patient_id` column, so no cross-patient relationship can be expressed for them.

Stopped after Repair 15. Database V2, Family Health, Dashboard, Care Plan, Health Story,
I Need Care and AI Health Guardian remain untouched, and nothing was deployed.
