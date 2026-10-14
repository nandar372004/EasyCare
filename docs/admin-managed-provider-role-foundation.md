# Admin-managed provider roles — Step 1

New account roles use `profiles.role`: `patient`, `admin`, or `provider`.
Provider category stays in the existing `providers.provider_type`: doctor,
nurse, nurse_aide, skilled_nurse_aide, special_nurse, caregiver.

The prepared forward-only migrations add the two normalized enum values, then
convert existing doctor/nurse/caregiver profile roles to provider and main_admin
to admin. They preserve provider identities, patient mappings, applications,
private credentials, and unrelated operational roles (family/coordinator/clinic_admin).
Historical enum labels remain for existing SQL policy compatibility; they do not
form a second account-role system. `current_profile_role()` derives the legacy
clinical category from provider_type so existing clinical policies keep their gates.

Patient self-application has no route or settings entry. Authenticated access to
draft-save, submission, and credential-registration RPCs is revoked; a restrictive
storage INSERT policy prevents new application uploads. Authorized historical reads
and existing admin review remain. No new provider-creation or invitation API is added.

Doctors use `/provider`; nurses use `/provider/nurse`; all three aide types use
`/provider/nurse-aide`; caregivers use `/provider/caregiver`. The latter destinations
are category placeholders. Their route guard denies doctor appointments and care-plan
screens. Server clinical access still depends on verified identity and the existing
patient relationship checks, independently of UI routing. Existing authorized multi-
workspace accounts retain their workspace selector.

Security-field triggers continue to reject self-role/status or provider-identity
changes. Provider INSERT is not permitted to authenticated clients. Admin operations
still require the active, server-resolved admin identity. Browser code uses the
ordinary signed-in client. RLS remains enabled; only application upload access is tightened.

Migrations are prepared and locally tested only; they have not been applied or deployed.
Apply `20261009110000_admin_managed_role_values.sql` before
`20261009111000_admin_managed_provider_role_foundation.sql` in separate committed
migration transactions. Provisioning and invitations belong to later steps.
