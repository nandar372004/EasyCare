# Dual-role family rollback

Staging history confirms 20261008093000 is applied. Its applied SQL file is
retained unchanged. The rollback is prepared but NOT applied.

## Exact changes being undone

- require_family_patient: originally required active adult patient, active
  profile and pr.role='patient'. The repair replaced the role condition with
  matching patient/profile/auth identity. Prior definition source:
  20261003090000_family_foundation.sql.
- get_family_health_members: originally enumerated active adult accepted
  members with patient-role profiles. The repair admitted matching dual-role
  patient identities. Prior definition source:
  20261003110000_clinical_smart_care_plans.sql.
- get_family_care_plan_readout: originally required a patient-role target
  member, alongside the caller, membership, explicit scope and projection
  checks. The repair admitted matching dual-role patient targets. Prior source:
  20261008090000_phase_j_staging_read_contract_repair.sql.

The repair also repeated the existing internal-helper revoke. That helper was
already inaccessible directly to public/anon/authenticated; there is no ACL
change to undo.

All three complete prior statements were retrieved from Staging's
supabase_migrations.schema_migrations.statements and retained, with version
provenance, in scripts/dual-role-family-prior-definitions.json. The new
20261008094000_revert_dual_role_family_patient_capability.sql copies those
statements, changing only CREATE to CREATE OR REPLACE where necessary. Function
bodies are not reconstructed from memory. No grants, tables, RLS, identities,
clinical data or vitals migration are modified.

## Repair-specific artifacts

- Preserved applied migration 20261008093000_dual_role_family_patient_capability.sql.
- Retired scripts/apply-dual-role-family-repair.ps1.
- Removed scripts/dual-role-family-inspection.sql and
  scripts/dual-role-family-reproduction.sql.
- Replaced only the dedicated dual-role repair block in
  src/lib/familyFoundation.integration.test.js with rollback regressions.
  The preceding 61 unrelated family/Phase J tests are preserved.
- Marked docs/dual-role-family-patient-capability-repair.md as a historical,
  superseded record with the current rollback instructions.

## Verification

Tests compare pg_get_functiondef, function ACLs and security properties with the
retrieved pre-repair definitions. They replay repair then rollback twice,
verify patient-only invitation success, dual-role denial as before, provider
identity preservation, unrelated invitation denial, patient-only directory
filtering and scope/revocation/expiry/removal enforcement. Snapshot comparisons
preserve all RLS policies, table/column grants, patient/provider rows, clinical
rows and can_access_patient. Existing Phase J application code is untouched.

## Operator command

From the repository root, only when ready to apply:

powershell -NoProfile -File .\scripts\apply-dual-role-family-rollback.ps1

The operator script verifies the linked Staging project, applies only 094000,
and records that version after success. It has not been executed.
