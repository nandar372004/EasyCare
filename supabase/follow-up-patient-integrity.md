# Follow-up patient ownership: Critical Security Repair 2

## Root cause and inspected paths

`follow_ups_assignee_manage` was a permissive `FOR ALL` policy. A patient could
submit another patient's `patient_id` and `encounter_id`, set
`assigned_to_profile_id = auth.uid()`, and pass the policy. Its SELECT/UPDATE/
DELETE permissions also bypassed the separate patient-scoped read policy.
The schema's actual field is `assigned_to_profile_id`, not `assigned_profile_id`.
Independent foreign keys did not establish patient/encounter correspondence.

Inspected follow-ups, encounters, appointments, patients, profiles, providers,
coordinators, role/access helpers and all follow-up policies. No production
follow-up repository/service/Edge caller or dedicated existing follow-up test
was found. Runtime application code therefore remains unchanged.

## Preflight and deployment

Run `scripts/follow_up_relationship_validation.sql` with trusted full-table
visibility before deployment. Its first result set identifies structural
patient/encounter/appointment mismatches and missing parents. The second reports
non-staff assignments, missing assignees and absent current staff/patient links.
It returns identifiers, not clinical content. A suspicious assignment is not
proof of misconduct: a historical patient-assigned reminder can be legitimate.

`20261001100000_follow_up_patient_integrity.sql` repeats the structural preflight
under write-conflicting locks and aborts with a count if it finds inconsistencies.
It never deletes or rewrites a clinical row. Review suspicious assignments before
deployment; the old assignment alone will no longer authorize management. The
read-only report is not a complete retrospective authorization audit and cannot
prove who originally created each record.

No hosted database was contacted or migrated by this repair. Live preflight
results remain unknown. Do not deploy until structural findings are reviewed and
resolved through an approved clinical process; do not silently reassign patients.

## Enforcement and policy matrix

- Reuses the existing encounter `(id, patient_id)` UNIQUE key; adds a validated
  composite FK on follow-ups and a supporting child index. This protects both
  INSERT/UPDATE and referenced encounter changes, including RLS-bypassing writes.
- Retains the original individual FKs, NOT NULL columns and completion CHECK.
- A follow-up-specific trigger checks the existing encounter/appointment patient
  chain, locking parent rows. Scoped guards reject encounter/appointment changes
  that would invalidate follow-ups. No appointment column or feature table is
  added to follow-ups; unrelated encounter inconsistencies are not backfilled.
- Replaces the vulnerable ALL policy with separate SELECT, INSERT, UPDATE and
  DELETE policies. UPDATE checks both the old and proposed patient/assignee.
- `can_manage_follow_up` requires main-admin authority, or self-assignment plus
  an existing clinical role and independent patient access. Doctor/nurse/caregiver
  use `can_access_patient(..., 'clinical')`; coordinator uses the established
  `view` permission for linked patients. Assignment never grants a staff role.
- Preserves the original clinical/family SELECT policy. A patient may read their
  authorized records, including patient-assigned reminders, but cannot mutate
  records merely by being the assignee. Staff-assignee SELECT remains available
  for coordinators, whose ordinary helper does not grant `clinical` permission.
- Main admins retain reassignment and management. Staff retain their existing
  self-assigned management model; this repair does not introduce staff delegation.

| Actor | Read | Create / update / delete |
|---|---|---|
| Patient | Existing authorized patient scope | No staff rights from assignment |
| Authorized family | Existing clinical-read authorization | No |
| Linked clinical staff | Existing clinical scope | Self-assigned records within authorized patient scope |
| Linked coordinator | Authorized assigned records | Self-assigned records within existing view scope |
| Main admin | Existing admin scope | Yes, subject to relationship integrity |
| Anonymous | No | No |
| Service role | Trusted access | Cannot bypass relational constraints simply by bypassing RLS |

## Helpers and scope

Two new scoped functions: `can_manage_follow_up` and the trigger-only
`check_follow_up_parent_chain`. Both pin search_path; the authorization helper is
authenticated-only, and direct public/client execution of the trigger helper is
revoked. Shared `can_access_patient`, `current_profile_role`, `is_main_admin` and
all Repair 1 files remain unchanged. Using the existing active-role helper does
not repair the broader suspended-provider access finding; that remains deferred.
Pricing, notifications, other clinical data and feature work are untouched.

## Tests and remaining risks

The integration suite replays the actual preceding migrations, including Repair 1,
in PostgreSQL/PGlite. Managed Auth/Storage scaffolding is simulated; row policies
and constraints are executed, not mocked. Tests cover role-based create/read/
update/delete, old/new UPDATE boundaries, malicious self-assignment, anonymous
denial, service-role FK checks, parent-chain guards, historical-row preservation,
preflight abort/rollback and unchanged Repair 1/shared policies and helpers.

Local validation: **259 passed, 0 failed across 10 suites**, including 32 new
follow-up cases and all 16 Repair 1 prescription cases. The other suites cover
identity, medications, laboratory data, clinical documents, monitoring alerts,
baseline migration checks and both repository test suites. There were no existing
dedicated follow-up tests to run. `git diff --check` also passed.

Deployment scans/builds an index and locks appointments, encounters and follow-ups.
Use a suitable maintenance window; lock acquisition times out after 10 seconds.
Parent locking can cause contention or transaction retries. Hosted concurrency,
non-default transaction isolation and managed Auth/PostgREST have not been tested.
The composite patient FK is database-native; trigger-based appointment-chain
checks require those deployment-level concurrency checks as well. Do not assume
local tests certify live records or every concurrency schedule.
