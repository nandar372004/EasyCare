# EasyCare Phase D — Family Onboarding UX Report

## 1. Status

**Complete (UI orchestration only).** Existing Family services, RPCs, schema, RLS, invitation semantics, and authorization rules are reused. No database migration was added and no deployment was performed.

## 2. User journey

Patient onboarding now includes an optional Family Setup step with **Just Myself** and **Myself and My Family** choices. Choosing either option can continue onboarding; neither choice creates membership or grants access. The family choice offers a link to the existing My Family area.

## 3. Entry points

- Patient onboarding: optional Family Setup step.
- Dashboard: optional Set Up Family card for eligible adults without a group; existing groups show Manage Family and View Family Health.
- Existing Family area: introduction and shortcuts to create, join, or invite flows.

## 4. Create Family flow

The existing Family form calls `create_family_group` through `familyService`. The authenticated server RPC resolves the owner from `auth.uid()` and creates only the owner's membership. No browser-supplied patient or owner ID is sent. The created group appears in the existing family list, where its owner can invite adults.

## 5. Join flow

The existing join flow generates a server-side, one-use invitation code. The patient shares the code with the family owner, who sends an invitation. The recipient must accept from their own authenticated account. The UI explains this sequence and the code's 24-hour expiry; it does not imply that entering a code directly creates membership.

## 6. Invitation flow

The group owner submits the intended adult's generated code and a relationship value supported by the existing schema: `spouse`, `mother`, `father`, `parent`, `child`, `sibling`, `guardian`, or `other`. The invitation RPC resolves the recipient from the code. Each person needs their own EasyCare account.

## 7. Acceptance flow

The existing invitation inbox allows the intended authenticated adult to accept or decline. Acceptance activates membership and makes the relationship visible. The success message states that health access remains separate. The acceptance UI does not call an authorization grant.

## 8. Permission flow

The existing Family management UI lists the supported explicit scopes (records, appointments, medications, payments, alerts, and care plans where supported by the deployed Family API). It requires a selected scope, consent, and a future expiry within one year before calling the existing grant RPC. Unselected scopes remain false. Family Health continues to enforce the corresponding scopes in its existing service and read projections.

## 9. Revocation flow

The existing Revoke Access action calls `revoke_family_authorization`, then reloads family state. Family Health rechecks authorization and removes data from sections that are no longer authorized. Expiry is reflected in the existing authorization status handling.

## 10. Membership vs access explanation

Onboarding and My Family now state that a family relationship describes who someone is, while permission controls what that person may see. Membership and relationship labels alone never grant clinical access.

## 11. Existing Family backend reuse

Reused existing tables and APIs: `family_groups`, `family_group_members`, `family_join_codes`, `family_invitations`, `family_authorizations`, and the existing Family RPC-backed `familyService` / `familyHealthService`. Browser calls do not supply arbitrary patient/profile identity. No second Family model or new RPC was introduced.

## 12. Onboarding integration

The Family Setup step follows Health Information and precedes Review. Family setup remains optional, can be left for later, and does not block completion. **Just Myself** is the default and performs no Family operation. No profile, health-intake, or onboarding database field was added.

## 13. Dashboard integration

For an adult with a recorded date of birth, the dashboard reads groups through `get_my_family_groups`; member counts come from the existing `get_family_members` RPC. Empty state links to My Family. Existing groups link to management and `/family/health`. The card reminds patients that each adult must grant access.

## 14. Security model

Adult eligibility checks remain in the UI for usability and in the existing server authorization for enforcement. Identity remains `auth.uid()`-derived. Invitation codes remain one-use and expiring; acceptance is limited to the intended authenticated account. Health scopes remain explicit, expiring, and revocable. Family Health remains a read-only projection, including Care Plan access. Membership does not make family health data available without authorization.

## 15. Child/dependent limitation

No child or dependent support was added. The UI states that adult accounts are required and dependent profiles are not yet supported. Existing adult eligibility rules remain authoritative.

## 16. Database changes

**None.** No migration, schema change, RLS change, or RPC change.

## 17. Tests

Focused Family, onboarding, dashboard, and Family Health tests passed: **103 tests across 7 files**. This includes existing Family foundation integration tests (50), Family management (15), Family Health UI (8), Family service (4), Family Health service (10), onboarding (6), and dashboard (10).

## 18. Regression results

The repository-only regression run passed **1,256 tests**. Three suites could not start because this checkout lacks these historical migration files they read directly: `20260813000300_seed_bookable_test_doctors.sql`, `20260810000000_core_presentation_schema.sql`, and `20260813000200_phase9_appointment_management.sql`. The root source copies of Profile Settings and medication frontend contract tests passed. Provider, Care Plan, auth/session, and Phase C patient health-intake tests were included in the repository-only run. The unfiltered run also discovers a stale duplicate checkout under `.kilo/worktrees/few-mask`, with outdated Profile Settings and medication UI source-text assertions. Provider Care Plan UI verification passed when rerun individually: **66/66 tests**; its single timeout occurred only during the parallel full run.

## 19. Build

Production build passed. Vite emitted its existing large-chunk advisory; the build completed successfully.

## 20. Phase E readiness

**Ready to begin Phase E.** The focused Family/onboarding suite passes, and the repository-only regression run had no behavioral test failures. Three historical-schema suites are blocked at file load because their migration fixtures are absent from this checkout. Phase D did not change Family authorization or clinical data behavior.

## 21. Files changed

- `src/features/onboarding/PatientOnboardingPage.jsx`
- `src/features/onboarding/PatientOnboardingPage.test.jsx`
- `src/features/dashboard/DashboardPage.jsx`
- `src/features/dashboard/DashboardPage.test.jsx`
- `src/features/family/FamilyPage.jsx`
- `src/features/family/FamilyPage.test.jsx`
- `src/styles/global.css`
- `docs/EASYCARE_PHASE_D_FAMILY_ONBOARDING_REPORT.md`
