# EasyCare Phase F — Admin Review & Provider Verification

## 1. Status

**Implementation status: COMPLETE locally. Staging status: PARTIAL.** The forward migration was applied to EasyCare Staging and only version `20261005130000` was recorded. Hosted admin review could not proceed because Staging has no active `main_admin` profile. The existing submitted application remains untouched.

## 2. Admin authorization model

The workflow uses the existing `main_admin` authority and `public.is_main_admin()`. Each review RPC also checks that `auth.uid()` belongs to an active `main_admin` profile. The browser supplies an application ID or filter only; it never supplies reviewer identity or role. No broader reviewer role was added.

The application and document tables grant admins read access only for submitted, under-review, verified, or rejected applications. Existing applicant owner policies remain in place. Applicant table reads are limited to an explicit list of safe columns; the applicant RPC explicitly projects its response and only includes the safe rejection reason for rejected applications.

## 3. Review queue

`/admin/provider-applications` lists applicant name, requested provider type, specialty, status, and submission date. Filters cover submitted, under review, verified, and rejected. The route uses `AdminProtectedRoute`; non-admin sessions are redirected. Admin sign-in and session restoration derive the admin session from the existing auth-bound RPC.

## 4. Detail review

`/admin/provider-applications/:applicationId` displays applicant identity and submitted professional details through `admin_get_provider_application()`. Reviewer-only fields are not returned through the applicant-facing RPC.

## 5. Credential review

The Phase E credential bucket is confirmed private in Staging. The deployed policies limit admin reads to recorded document paths associated with eligible applications. The UI verifies the path against the admin detail response, then requests a 60-second signed URL. A hosted admin session was unavailable, so signed-link creation and expiry were not exercised against Staging.

## 6. Under-review transition

`admin_start_provider_application_review()` performs the server-side `submitted → under_review` transition, records the `auth.uid()` reviewer and server timestamp, and appends an immutable review event. Applicants cannot call the admin RPCs or update the application table directly.

## 7. Approval flow

`admin_approve_provider_application()` accepts only an under-review application, validates its provider type, specialty, professional fields, active applicant profile, absence of an existing provider identity, and presence of stored credential evidence. It denies self-approval and is idempotent for an already-consistent approved identity.

## 8. Rejection flow

`admin_reject_provider_application()` requires an 8–500 character applicant-facing reason, records the reviewer and server timestamp, and permits only an under-review application. Rejection does not change the applicant role or create a provider identity. The applicant status RPC exposes the safe reason but not reviewer or provisioning metadata.

## 9. Atomic provider provisioning

Approval performs profile role assignment, verified provider creation, primary specialty association, canonical provider credential creation, application decision update, and review-event insertion within one database function call and transaction. A uniqueness conflict test confirms the profile, provider, and application state do not partially change.

## 10. Role/type mapping

The migration preserves the current compatibility mapping:

- doctor → profile role `doctor`, provider type `doctor`
- nurse → profile role `nurse`, provider type `nurse`
- nurse aide → profile role `nurse`, provider type `nurse_aide`
- caregiver → profile role `caregiver`, provider type `caregiver`

## 11. No-self-approval rule

Start review, approval, and rejection all compare `auth.uid()` to the application owner and deny self-review, including for a dual-role identity.

## 12. Provider Login result

The approved identity satisfies the existing `get_my_provider_identity()` checks in local migration replay. The provider authentication service continues to require that auth-bound identity RPC before allowing Provider Login. Approval and provider sign-in were not exercised in Staging because no active admin account was available.

## 13. Provider-patient access boundary

Approval creates no patient relationship. The replay test confirms the newly approved provider resolves as a provider but receives no clinical patient rows without an existing qualifying relationship. Provider-patient authorization code was not changed.

## 14. Audit model

Each under-review, verified, and rejected transition creates an immutable `provider_application_review_events` row with application, reviewer, timestamp, decision, safe reason where relevant, and resulting provider ID for approval. Existing row-audit triggers also write to `audit_logs`.

## 15. Storage security

The bucket remains private. New RLS policies permit the active main admin to read only recorded credential objects tied to reviewable applications. The restrictive guard still denies unrelated paths, anonymous reads, and cross-applicant reads. The local migration replay tested owner, other-patient, admin, and anonymous visibility. Hosted signed-link behavior remains to be verified after deployment.

## 16. Database changes

Applied only forward-only migration `20261005130000_provider_application_admin_review.sql` to EasyCare Staging and recorded only that migration version. It adds reviewer/decision metadata, credential provenance links, immutable review events, owner/admin read policies, and admin RPCs. The Phase E migration was not rewritten. No full database push, reset, or other migration was performed.

## 17. Tests

Phase F coverage includes the migration replay and database boundary tests for patient/provider denial, admin listing and detail, admin credential access, applicant transition denial, self-approval denial, atomic approval, verified credential provenance, compatible role assignment, idempotent approval, rejection behavior, private storage, audit events, and rollback on a unique credential conflict.

## 18. Regression results

After the Staging migration, the requested provider application, provider authentication/workspace, provider-patient relationship, registration identity/consent, Family, and Care Plan regression group passed: **25 test files, 358 tests**. Migration replay through Phase F also passed locally.

## 19. Build

Production build: **PASS**. Vite reported the existing large main-chunk advisory; it did not fail the build.

`git diff --check`: **PASS**.

## 20. Known limitations

- Staging has **zero active `main_admin` profiles**. The app browser also had no authenticated admin session, so the hosted review page and admin Storage access could not be exercised.
- Staging has one submitted application. Its synthetic credential is marked not valid; no approval or rejection was performed, and the application remains submitted.
- Signed credential links and their expiry, hosted approval/rejection, verified provider login, workspace access, and post-approval relationship-scoped patient access remain to be verified with an authorized Staging admin.
- The provider schema records verifier identity and time on `provider_credentials`; the existing `providers` table has `verified_at` but no `verified_by` column. The migration preserves that canonical model instead of adding a redundant provider-level field.
- No notification workflow for approval or rejection was added.

## 21. Phase G readiness

**NO.** Phase G should wait until an authorized Staging admin account is available and the hosted credential access, approval, rejection, Provider Login, and relationship-scoped patient access flows are verified.

## 22. Files changed for Phase F

- `supabase/migrations/20261005130000_provider_application_admin_review.sql`
- `src/services/adminProviderApplicationService.js` and its test
- `src/features/provider/AdminProviderApplicationsPage.jsx` and its test
- `src/features/provider/ProviderApplicationPage.jsx` and its test
- `src/features/auth/AuthContext.jsx` and its test
- `src/features/auth/RouteGuards.jsx`
- `src/features/auth/LoginPage.jsx`
- `src/services/authService.js` and its test
- `src/App.jsx`
- `src/styles/global.css`
- `src/lib/providerApplication.integration.test.js`
- `src/App.carePlanRoute.test.jsx`
- `docs/EASYCARE_PHASE_F_PROVIDER_VERIFICATION_REPORT.md`

Staging migration deployment: **YES**. Applicant review and approval RPC attempts were denied with authorization error `42501`; no application state changed. Phase G: **NOT STARTED**.
