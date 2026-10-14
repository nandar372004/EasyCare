# Critical Security Repair 3 — suspended provider clinical access

## Findings and canonical identity

The latest schema has no `providers.status`. Provider authorization uses
`providers.verification_status = 'verified'`. Pending, rejected and suspended
records are not verified. `profiles.status = 'active'` is the profile gate.
Doctor, nurse and caregiver are the clinical profile roles; `nurse_aide` is a
provider type, not a profile role. This repair does not invent a type/role mapping.
Missing profiles, missing provider relationships and unknown authentication fail
closed. Existing NOT NULL constraints already prohibit NULL status values.

`can_access_patient` checked verification and an appointment or accepted/assigned
care assignment, but not profile status or a clinical profile role. Its coordinator
branch ignored profile role/status and coordinator status. Its clinic branch
checked both clinic memberships' active status but omitted profile role/status.
`is_appointment_provider` checked only appointment ownership by a provider ID
linked to the caller. Those SECURITY DEFINER helpers bypass table RLS internally,
so adding a check only to tables would not repair callable helper results.

`current_profile_role` already excludes inactive profiles and is unchanged.
`can_manage_follow_up` already requires a clinical/coordinator role and a patient
relationship; it now inherits the strengthened patient helper. Its definition,
Repair 2 policies and parent guards remain unchanged.

The direct permissive `encounters_provider_manage` ALL policy allowed suspended
owners to read/update/delete encounters independently of `can_access_patient`.
`care_requests_coordinator_update` and `assignments_coordinator_manage` also
accepted linked staff identities without role/status checks. These three policies
now explicitly require the appropriate role while retaining their relationships.

Other affected policies include `*_read` policies using `can_access_patient`,
`visit_events_provider_create` using `is_appointment_provider`, and the clinical
write policies `clinical_notes_assigned_create`, `conditions_doctor_create`,
`allergies_provider_create`, `vitals_assigned_create`,
`prescriptions_doctor_create`, `prescription_items_doctor_create`,
`alerts_provider_create`, `alerts_reviewer_update`, and the follow-up staff policies.
Some already checked active profile role but depended on an indirect verification
check. The new restrictive gate ensures all require a current identity.

## Implementation

New forward migration: `migrations/20261001110000_suspended_provider_clinical_access.sql`.

Creates `clinical_identity_is_current()`, strengthens `can_access_patient` and
`is_appointment_provider`, and adds a RESTRICTIVE ALL policy named
`clinical_identity_required` to 27 clinical/relationship tables. These policies
AND with existing permissive policies; they cannot grant access. SELECT and DELETE
check the existing row; UPDATE checks both old and new rows; INSERT checks the new
row. No table, record, constraint, status, index or applied migration is rewritten.

The central gate also requires coordinator status `active`. Both `inactive` and
`unavailable` fail this active-status test: unavailable is not silently treated as
active. Review existing unavailable coordinator accounts during preflight because
the old policies did not enforce this distinction. Main administrators must have
active profiles. Clinic administrators need an active sub-admin membership and
active profiles, plus the existing same-clinic patient relationship. An inactive
clinic membership revokes that clinic-based route, not an independent provider's
appointment/assignment route. No global clinic-status revocation rule is added.

Patient/family profile roles retain their existing owner/consent permissions and
status behavior. Clinical-role accounts cannot use a secondary family relationship
to evade the clinical identity gate. Active staff still need the existing patient,
appointment, encounter or assignment relationship. The patient-only medication and
appointment read policies stay patient-only; this repair does not expand access.

Helper functions are stable SECURITY DEFINER, use an empty search_path, bind the
caller through `auth.uid()`, and expose only Boolean answers. PUBLIC/anon execution
is revoked; authenticated execution is granted. No unguarded renamed helper remains.
Existing identity-protection triggers prevent users changing their own role/status
or provider verification/profile binding.

Repository/service review found client-scoped database queries: enforcement belongs
at the database boundary, so no application code changed. The guardian Edge Function
already checks active profile status; health overview uses active patient identity,
owner authorization and user-scoped context reads. Its service-role cache operations
are not provider authorization endpoints. Patient registration and medication-event
self-confirmation RPCs retain their explicit patient ownership/service boundaries.
No new provider service-role path is introduced.

## Read-only preflight and deployment

Run `scripts/provider_clinical_access_validation.sql` as an authorized database
administrator. It reports non-active/unverified/mismatched provider profiles,
inactive clinic memberships, non-active coordinators, relevant policy definitions
and all public SECURITY DEFINER definitions. Results are review candidates, not
automatic clinical-data corrections. No live dataset was accessed or status repaired.

Apply only after reviewing those results and the unavailable-coordinator effect.
No hosted deployment was performed. PostgreSQL owners/BYPASSRLS/service_role remain
trusted boundaries; this migration cannot restrict a service key. Validate hosted
PostgREST JWT behavior and actual grants in staging before deployment. Existing
appointments of any lifecycle status still establish relationships, as before;
changing that authorization model is outside Repair 3. Queries already running under
an older transaction snapshot are not forcibly terminated by profile suspension.

Rollback must be a reviewed forward authorization migration; simply removing the
gate would reopen the vulnerability. There is no data rollback because this migration
changes only authorization objects. Repairs 1/2 integrity constraints remain intact.

## Validation

Final targeted run: **422 passed, 0 failed across 20 suites**. Repair 3 has
43 passing tests; Repair 1 has 16 and Repair 2 has 32. The run also covers
identity/registration, clinical RLS, medications, labs, documents, monitoring,
vitals, patient health profiles, conditions/allergies, appointment contracts,
provider directory, authentication and dashboard repositories. Initial development
validation caught a SQL delimiter error in the new migration; it was corrected
before this final run. No legacy failure was changed to obtain these results.

`src/lib/suspendedProviderClinicalAccess.integration.test.js` executes the full
migration chain in real PostgreSQL via PGlite. Managed Auth/Storage infrastructure
is represented locally; clinical authorization results are not mocked. It reproduces
the old suspended encounter read before repair and denies it afterward without
changing encounter data. It exercises active related staff CRUD, unrelated access,
all invalid provider verification states, profile suspension/inactivity, helper RPCs,
clinic membership, nurse/caregiver assignments, identity manipulation, patient/family
reads, anonymous denial, and Repair 1/2 constraints after Repair 3.

Earlier phase integration suites intentionally stop at their own migration; the new
Repair 3 suite is the full-chain test. Existing pgTAP files under `tests/database`
target obsolete schema (`address_city`, `address`, role `admin`) and require a separate
managed Auth/pgTAP setup. They were inspected but not executed or repaired. Three
known unrelated legacy Vitest files requiring missing old migrations were excluded
from this targeted run, not counted as passing.

Only four new files belong to this repair: the migration, read-only preflight,
integration test, and this report. All earlier working-tree changes were preserved.
