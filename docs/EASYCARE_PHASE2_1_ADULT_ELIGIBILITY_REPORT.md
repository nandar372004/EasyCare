# EasyCare Phase 2.1 — Adult Family Eligibility Report

**Date:** 2026-10-03 (Asia/Rangoon)

## 1. Product eligibility decision

**REQUIREMENT AMBIGUOUS.** Current executable registration requires a past DOB but does not enforce age 18. The checked-in product documents describe a patient-facing application and an adult-only Phase 2 family foundation; they do not establish that all patient accounts must be adults. The Phase 2 report explicitly scopes the age gate to family management and notes that minor accounts cannot use its RPCs. Globally blocking minor registration would therefore infer a product policy that the repository does not establish.

Chosen path: preserve existing minor registration and improve `/family` eligibility messaging. The SQL `require_family_patient()` rule remains authoritative and unchanged.

## 2. Files changed

- `src/features/family/familyEligibility.js` — date-only client-side eligibility helper matching the SQL 18-year date boundary, including leap-day clamping.
- `src/features/family/familyEligibility.test.js` — adult boundary, one-day-underage, older adult, leap-year and invalid DOB cases.
- `src/features/family/FamilyPage.jsx` — shows eligibility guidance and omits family controls for accounts with missing or under-18 DOB.
- `src/features/family/FamilyPage.test.jsx` — verifies minors/missing DOB do not trigger family service/RPC calls; adult management tests remain.
- `src/services/authService.js` — includes the already-persisted `patients.date_of_birth` in the authenticated patient's lookup so `/family` can make its UX decision.
- `src/features/auth/registrationSchema.test.js` — confirms a valid minor DOB remains accepted by browser registration validation.
- `supabase/functions/_shared/registration-core.test.js` — confirms Edge registration still proceeds for a valid minor DOB; no adult-only validation was added.
- `docs/EASYCARE_PHASE2_1_ADULT_ELIGIBILITY_REPORT.md` — this report.

## 3. Behavior after the change

Registration behavior is unchanged. Valid past DOBs, including minor DOBs, remain valid in browser validation and Edge validation. The Edge Function still validates its payload before it creates an Auth user; there is no age policy change at that boundary.

At `/family`, an account without a valid recorded DOB or whose DOB is younger than the existing 18-year threshold sees: **“Family management is currently available to active accounts aged 18 or older with a recorded date of birth.”** Family management services are not called from this UI state. Adult accounts continue to the existing management UI. This check is usability only; direct RPC calls continue to be rejected by the unchanged server-side `require_family_patient()` rule.

The frontend compares date-only ISO DOBs using the account's local calendar date and clamps leap-day year subtraction to the last valid day of February. The family RPC remains the final authority, including where client and database calendar dates differ.

## 4. Tests

Added/updated tests cover the family eligibility boundary, one day short of 18, older adults, leap-year subtraction, invalid/missing DOB, suppression of family-service calls for ineligible UI state, and continued minor acceptance by both browser registration validation and Edge registration core. Existing family integration coverage includes rejection of minor accounts by the direct family RPC. Adult family UI/action coverage is retained.

## 5. Test results

- Focused registration/auth/family/identity/security run: **21 files passed, 215 tests passed**.
- Current non-legacy suite: **72 files passed, 1,050 tests passed**. This excludes `.kilo/worktrees/**` duplicates and three known stale tests that refer to migration files absent from the current migration set (`bookableDoctorSeed`, `phase4DatabaseSchema`, `phase9AppointmentManagement`), as documented in `supabase/database-v2-handoff.md`.
- Unfiltered `npm test`: **105 files passed, 8 failed; 1,250 tests passed, 2 failed**. Failures came from duplicated `.kilo` worktree tests and the three documented stale migration-reference suites. The current non-legacy suite passes.
- Production build: **passed** (`vite build`); Vite emitted its existing advisory that the main JavaScript chunk exceeds 500 kB.

## 6. Database/security and scope confirmation

- Database migrations: **NONE**.
- Database schema, `20261003090000_family_foundation.sql`, RLS, `can_access_patient()`, and `require_family_patient()` were not changed.
- Patient identity constraints and separate `patients.id` are unchanged.
- Security Repairs 1–15 and Edge registration transaction/rollback behavior are unchanged.
- No dependent functionality or Family Health Command Center was added.
- No deployment was performed.

## 7. Remaining limitations

The repository does not define whether general patient registration is intended for minors; product ownership must settle that policy before any global registration restriction. The client family eligibility state depends on the authenticated patient lookup returning the DOB; the RPC independently rejects missing/ineligible records regardless. No live browser or hosted Supabase verification is included in this code change.
