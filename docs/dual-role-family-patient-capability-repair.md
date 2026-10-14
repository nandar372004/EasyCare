# Dual-role family patient capability repair

Historical record: 20261008093000 is applied to Staging. A user-requested
rollback is prepared in 20261008094000_revert_dual_role_family_patient_capability.sql
but has not been applied. The original apply script has been retired.
See dual-role-family-rollback.md for current instructions.

## Confirmed Staging cause

The UI calls familyService.createFamilyJoinCode, then familyRepository calls
create_family_join_code with no patient or provider identifier argument.
The RPC resolves auth.uid() through require_family_patient.

A redacted identity audit found two active adult patient accounts with verified
nurse provider identities. Each patient auth_user_id and profile_id points to
the same profiles.id/auth.users.id. No identity remapping is required.

Authenticated Staging reproduction returned 42501, "An active adult patient
account is required", for both accounts. get_my_provider_identity succeeded.
The reproduction transaction was rolled back; no codes or data were retained.

require_family_patient incorrectly requires pr.role='patient'. Family health
member enumeration and the family care-plan target lookup contain the same
exclusive-role assumption.

## Prepared repair

20261008093000_dual_role_family_patient_capability.sql replaces only those three
family functions. Eligibility resolves the caller's active adult patient row,
active profile and matching auth/profile identity. Provider-only accounts have
no matching patient and remain denied. Existing membership, consent, scope,
expiry, revocation and clinical authorization checks are retained.

No RLS policy, clinical authorization helper, provider RPC, identity mapping,
clinical rows, browser credentials or application runtime code is changed.
The private require_family_patient helper remains inaccessible directly to
public, anon and authenticated. Existing public RPC ACLs remain preserved.

## Verification

157 focused tests passed across the final runs, including 9 new database
regressions. These reproduce the prior rejection, exercise patient-only and
dual-role invitations, deny provider-only/underage/inactive/suspended accounts,
verify membership and directory visibility, explicit sharing and denial after
revocation/expiry/removal, unrelated invitation denial and care-plan scope
isolation. Migration replay twice preserves all RLS policies, provider rows,
vital rows and the can_access_patient definition. Provider identity is tested
through its intended RPC. Auth workspace and provider regression suites pass.
Build passes with the existing large-bundle warning.

The original repair was tested locally with PostgreSQL semantics and later
applied to Staging by the operator. No deployment or Phase K work was performed
by this agent.

Operator command from the repository root:

Retired: use the rollback instructions in dual-role-family-rollback.md.

The script pins the linked project to Staging, applies only the new migration,
and records that exact migration version after successful commit.
