# EasyCare Phase B Patient Onboarding Report

## 1. Status

Phase B implementation is complete. No deployment was performed. The onboarding migration and RPCs must be applied to the target Supabase database before the hosted onboarding flow can save or load state.

## 2. New patient journey

Successful new patient registration and automatic sign-in now open `/onboarding`. The patient sees a brief welcome, can start optional profile setup, or skip directly to `/dashboard`. Setup includes Personal Details, Contact & Address, and a non-editable Health Information step.

## 3. Existing patient behavior

Existing sign-in continues to use the current login return path, which defaults to `/dashboard`. Incomplete and skipped onboarding never redirects patients automatically. Existing patients without a progress row are treated as `not_started`, can use the dashboard, and may choose the dashboard's optional setup card.

## 4. Routes added or changed

- Added patient-authenticated `/onboarding`, outside the dashboard shell.
- New account success in `RegisterPage` now navigates to `/onboarding`.
- Patient login routing and account-switch routing behavior are unchanged; successful account-switch registration reaches onboarding as a new account.

## 5. Onboarding state design

The new `patient_onboarding_states` table stores a patient-scoped state with `in_progress`, `completed`, or `skipped`. An absent row represents `not_started`, preserving legacy behavior without a backfill. The authenticated user cannot access the table directly; two narrowly scoped RPCs read and update state.

## 6. Profile fields supported in Phase B

The RPC supports only existing patient columns for address line, township, city, emergency contact name, emergency contact relationship, and emergency contact phone. The phone is normalized and validated server-side. Name, date of birth, and phone identity fields are read-only in onboarding.

Gender is not edited in this phase. An existing profile security trigger currently prevents the safe update path from completing; changing that trigger would expand into auth/security architecture work outside this phase.

## 7. Fields deliberately deferred to Phase C

Allergies, medical conditions, current medications, prescriptions, medication schedules, and other clinical facts are not collected or written. The Health Information step is informational only. Gender is also deferred as described above.

## 8. Skip behavior

“I’ll Do This Later” saves `skipped` and returns to the dashboard. From the welcome screen it does not rewrite existing profile data. From setup it saves the allowed profile fields currently shown.

## 9. Resume behavior

`in_progress` resumes directly in the setup flow. `skipped` returns to the welcome screen with the option to start. The patient chooses whether to resume; login does not force onboarding.

## 10. Dashboard integration

The dashboard displays an optional “Complete your profile” card for all states except `completed`. Its Continue Setup link opens `/onboarding`.

## 11. Security model

- The route requires an authenticated patient identity in the patient workspace.
- RPCs derive the patient and profile from `auth.uid()` and verify active patient/profile status and matching identity.
- No patient or profile ID is accepted from browser arguments.
- The save RPC validates progress values, limits profile keys to an explicit allowlist, bounds field lengths, and normalizes the emergency phone.
- Progress table access is revoked from browser roles; authenticated users receive execute permission only on the two RPCs.
- Role, provider/admin assignment, authentication identity, and canonical clinical data are outside the write allowlist.

## 12. Database changes

Added `supabase/migrations/20261004140000_patient_onboarding_state.sql`. It creates the minimal progress table and session-bound read/save RPCs. Existing rows need no migration or backfill. The migration has not been deployed.

## 13. Tests

Focused onboarding, registration, session, route, dashboard, service, and migration integration checks passed: **49 tests across 11 files** in the focused run, including the PostgreSQL-compatible full migration replay and safe-write checks.

## 14. Regression results

The root-worktree regression run passed **1,242 tests** across 89 files. Three legacy test suites could not be collected because the migrations they expect are absent from this checkout:

- `20260813000300_seed_bookable_test_doctors.sql`
- `20260810000000_core_presentation_schema.sql` and related Phase 4 migration
- `20260813000200_phase9_appointment_management.sql`

The archived `.kilo/worktrees` copy contains duplicate tests and stale source-text assertions, so it was excluded from the root regression run. Family, Provider, Care Plan, auth/session, account-switch, and consent tests in the root tree passed.

## 15. Build

The production build passed. Vite reported its existing large-chunk advisory; it did not prevent the build.

## 16. Known limitations

- Supabase migration deployment and hosted browser verification were not performed.
- Until the migration is applied, RPC-backed onboarding state will fail against the hosted database. Network connectivity from the local Myanmar environment remains an external testing limitation and was not changed.
- Gender editing was deferred because of the existing profile security trigger behavior.

## 17. Phase C readiness

**Not yet.** First deploy the Phase B migration and verify the hosted onboarding RPCs and browser flow. Phase C clinical intake remains unimplemented.

## 18. Files changed for Phase B

- `src/App.jsx`
- `src/features/auth/RouteGuards.jsx`
- `src/features/auth/RegisterPage.jsx`
- `src/features/auth/RegisterPage.test.jsx`
- `src/features/auth/RegistrationSessionFlow.test.jsx`
- `src/features/dashboard/DashboardPage.jsx`
- `src/features/dashboard/DashboardPage.test.jsx`
- `src/features/onboarding/PatientOnboardingPage.jsx`
- `src/features/onboarding/PatientOnboardingPage.test.jsx`
- `src/services/patientOnboardingService.js`
- `src/services/patientOnboardingService.test.js`
- `src/lib/patientOnboarding.integration.test.js`
- `src/lib/patientOnboardingMigration.test.js`
- `src/App.carePlanRoute.test.jsx` (route-guard test mock updated for the added route)
- `src/styles/global.css`
- `supabase/migrations/20261004140000_patient_onboarding_state.sql`
