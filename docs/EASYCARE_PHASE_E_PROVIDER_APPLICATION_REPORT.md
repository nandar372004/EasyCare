# EasyCare Phase E — Provider Application Report

## 1. Status

**Complete locally.** Ordinary authenticated patient accounts can prepare and submit a professional application. Application state is separate from provider identity and verified status. No application migration was deployed.

## 2. User journey

Profile Settings links to **Apply as Healthcare Provider**. The application guides the user through Professional Role, Professional Details, License & Qualifications, Credential Documents, and Review & Submit. The existing **Provider Sign In** remains the path for already provisioned providers.

## 3. Application lifecycle

The application status enum supports `draft`, `submitted`, `under_review`, `verified`, `rejected`, and `withdrawn`. Phase E exposes draft creation/editing, submission, and read-only status. Review decisions and transitions to under review, verified, rejected, or withdrawn are not exposed here and are reserved for authorized later work.

## 4. Application schema

The forward-only migration adds `provider_applications` and `provider_application_documents`. Each application belongs to the authenticated profile. A partial unique index permits one open application per user. Timestamp fields are server generated and `updated_at` uses the existing timestamp trigger. There are no provider ID, verifier ID, or reviewer decision fields on the application.

## 5. Professional fields

Requested provider type uses the existing `provider_type` enum: doctor, nurse, nurse aide, or caregiver. Specialty references the existing `specialties` table. The form collects license number and issuer, qualifications, and optional years of experience, organization, bio, languages, and service area. Full name and phone are read-only and come from the signed-in profile.

## 6. Credential upload design

Credential evidence is stored in a separate private Storage bucket. Phase E accepts PDF, JPG/JPEG, and PNG files up to 10 MiB, checks file type, extension, and size in the client, and enforces MIME and size limits again in Storage and the metadata RPC. Each object is associated with an owned draft application and a metadata row. Submission requires at least one recorded credential object that still exists in Storage.

## 7. Storage security

The bucket is created private. Storage policies bind object paths to `auth.uid()`, the owned application, and its draft state for upload. Downloads require a matching owned application document row; access uses a 60-second signed URL. Cross-user and anonymous reads are denied. Updates are denied. Applicants can read their own credential records. Storage permits deletion only for the owner's registered draft objects; the Phase E UI does not expose a remove control. No public URL or service-role secret is used.

## 8. Draft behavior

`save_provider_application_draft` derives the applicant from `auth.uid()`, accepts only the application field allowlist, and permits edits only while that applicant’s application is a draft. Browser table writes are revoked. The user can save and resume a draft.

## 9. Submit behavior

`submit_provider_application` checks required role, specialty, license, issuer, qualifications, and an existing credential object. It sets `submitted_at` and status server-side. Submitted applications cannot be edited through the draft RPC. The page reports **Pending Review** and explains that submission grants no provider or clinical access.

## 10. Status page

`get_my_provider_application()` returns only the signed-in user’s profile, latest application, and credential metadata. The UI presents safe lifecycle labels. Rejected applications show no reviewer details because Phase E has no reviewer decision or reason field.

## 11. Identity and security model

Application ownership is derived from `auth.uid()`. Calls may include an application ID to edit or submit, but the server checks it belongs to the caller. No profile, user, provider, or verifier identity is accepted from the browser. Selecting a provider type does not update `profiles.role`, create a `providers` row, create a provider-patient relationship, or grant clinical access.

## 12. Existing provider compatibility

An account resolved as an existing verified provider sees a message directing it to the existing Provider Workspace. Existing verified provider rows and identities are unchanged. Existing providers do not need to submit an application.

## 13. Provider Login boundary

Provider Login and `get_my_provider_identity()` were not changed. Integration verification confirms a submitted applicant remains a patient, has no provider identity, and gets no clinical patient list. Existing verified provider login remains available.

## 14. Database changes

Added local migration `20261005120000_provider_applications.sql`. It adds only application status/type data, application and document metadata tables, four owner-bound RPCs, a private Storage bucket, and owner-scoped Storage policies. It does not alter provider verification semantics, provider authorization, Family authorization, or Care Plan behavior.

## 15. Tests

- Provider Application UI: 5 tests.
- Provider Application service: 8 tests.
- Provider Application migration/security replay: 6 tests; migration replayed over the prior local migration set.
- Existing provider authentication, Provider Workspace, Provider Care Plan, provider-patient security, and route guard suites were run.

## 16. Regression results

The repository-wide regression run excluding `.kilo/worktrees/**` completed with **1,275 tests passing across 96 files**. Three test files could not start because they read historical migration files absent from this checkout: `20260813000300_seed_bookable_test_doctors.sql` (bookable doctor seed), `20260810000000_core_presentation_schema.sql` (Phase 4 schema), and `20260813000200_phase9_appointment_management.sql` (Phase 9 appointment management). These are missing-file collection errors, not test assertions against the Phase E changes. The focused Phase E UI/service/integration run passed **19 tests across 3 files**. The Phase E integration replay also passed independently with **6 tests**.

## 17. Build

Production build passed. Vite reported the existing large-chunk advisory; output completed successfully.

## 18. Known limitations

Phase E does not provide reviewer access, approval/rejection, verified-provider provisioning, or content scanning. Credential files remain private to the applicant until a later authorized review design is implemented. No Phase F reviewer UI or authority was added. Three repository test files remain unexecuted because their referenced historical migration files are missing from this checkout.

## 19. Phase F readiness

**Ready to begin Phase F implementation.** The application data model and submission boundary are in place locally; Phase F can add authorized review and verification without treating submission as approval. No staging or production migration has been applied.

## 20. Files changed

- `supabase/migrations/20261005120000_provider_applications.sql`
- `src/services/providerApplicationService.js`
- `src/services/providerApplicationService.test.js`
- `src/features/provider/ProviderApplicationPage.jsx`
- `src/features/provider/ProviderApplicationPage.test.jsx`
- `src/App.jsx`
- `src/features/secondary/PatientSettingsPage.jsx`
- `src/styles/global.css`
- `src/lib/providerApplication.integration.test.js`
- `src/lib/patientOnboarding.integration.test.js` (Storage test fixture schema)
- `src/lib/registrationConsentMigration.integration.test.js` (Storage test fixture schema)
- `docs/EASYCARE_PHASE_E_PROVIDER_APPLICATION_REPORT.md`
