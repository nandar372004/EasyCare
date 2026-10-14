# EasyCare Phase 4D — Family Read-Only My Care Plan

**Status: COMPLETE.** Adult family members can view a selected adult member's active Clinical Smart Care Plans inside the existing `/family/health` experience when that member has granted the separate `care_plans` permission. The view is read-only and uses backend-masked projections. No deployment was performed.

## 1. Files changed

- `supabase/migrations/20261003140000_family_care_plan_read_projection.sql` — adds the member-scoped, family-authorized read RPC.
- `src/features/family/FamilyCarePlanSection.jsx` — read-only summary and detail rendering.
- `src/features/family/FamilyHealthPage.jsx` and `src/styles/global.css` — integrate the card into the existing responsive Family Health layout.
- `src/features/family/FamilyPage.jsx` — add independent Care Plans consent permission and description.
- `src/services/familyHealthService.js` and `src/services/repositories/familyHealthRepository.js` — authorize by the current family member result and call the family read RPC.
- Family Health, Family Management, family service, and PostgreSQL-compatible integration tests were extended.
- `docs/EASYCARE_PHASE4D_FAMILY_CARE_PLAN_UI_REPORT.md` — this report.

## 2. Routes and Family Health integration

No disconnected dashboard or patient-ID route was added. Selecting Self retains the own-account Family Health experience and links to `/my-care-plan`. Selecting an authorized family member shows a separate Care Plan section within the existing `Who needs me today?` command center. Each active plan has its own summary and expandable read-only detail. Multiple plans are not combined.

The detail uses only the returned family readout. It shows safe plan title/status/dates, current version and instructions, backend-derived progress, due tasks, next task, and goals when returned. Internal identifiers are used only for data association and React keys; they are not rendered. Accessible headings, status text, labelled progress, keyboard buttons, loading and error announcements, and responsive layouts are used.

## 3. Permission management and authorization

The My Family access form shows **Care Plans** as a separate checkbox with the description “View my clinician-created care plans, goals, and care tasks.” All new form permissions start off. Enabling Records does not enable Care Plans, and existing grants do not inherit the new permission.

The UI calls the new `get_family_care_plan_readout(group_id, member_id)` RPC with the selected family group and accepted membership ID. The backend resolves the target adult from that active membership, derives the viewer from the authenticated account, requires current adult patient identity and group membership, and checks active `care_plans` access through the existing authorization helper. It accepts no patient UUID or plan ID from the browser. Membership-only, records-only, medications-only, and appointments-only access are denied.

The RPC returns active plans only. For each plan it calls the existing Phase 4B.1 `get_care_plan_detail` and `get_care_plan_occurrences` safe projections. The browser does not query raw Care Plan or source tables and does not reproduce masking rules. No permission error is converted into an empty-plan response.

## 4. Empty, partial-access, and refresh behavior

- No `care_plans` grant: **Care Plan access not shared**. The UI does not imply whether a plan exists.
- Authorized read returning no active plans: **No active care plan**.
- Expired, revoked, inactive, withdrawn-consent, or removed-membership access: protected data is cleared and the Care Plan section reports that access is no longer available.
- Read/network failure: a separate load error is shown, not the no-plan state.
- A normal Family Health refresh and its existing focus/15-second authorization checks remain in place. When the member authorization changes, the selected data key changes immediately; the next load rechecks access before showing data.

## 5. Read-only rendering and source masking

Family task cards have no acknowledge, complete, medication-recording, vital-recording, appointment mutation, or lifecycle controls. The family UI never calls reconciliation. The PostgreSQL integration test verifies family denial for manual acknowledgement, reconciliation, plan lifecycle transitions, and writes to medication events, vitals, appointments, and follow-ups.

The existing safe projection applies each scope independently:

- **Medication:** linked medication/event detail is available only with `medications`; otherwise it is omitted.
- **Vitals:** linked reading and values are available only with `records`; otherwise the occurrence has no source detail.
- **Appointments:** linked appointment detail is available only with `appointments`.
- **Follow-ups:** linked follow-up detail is available only with `records`.

Integration assertions cover the masked and permitted forms. The UI does not fetch source details separately or reveal hidden identities to explain masking. Source tables remain authoritative, and automatic reconciliation remains backend-controlled.

Progress is displayed as care-task counts using backend progress. `no_tasks_due` renders “No care tasks due today” without a fabricated percentage. This is not presented as a health, recovery, risk, or treatment-success score.

## 6. Security and product boundaries

The new RPC is `SECURITY DEFINER` with an empty search path; execution is revoked from `PUBLIC` and `anon` and granted to `authenticated`. It validates membership, age/status, current identity, group membership, and explicit active care-plan access before returning data. The prior Phase 4B.1 projection functions continue to enforce linked-resource masking.

No arbitrary patient UUID URL or route was added. No family mutation or reconciliation path was added. The patient `/my-care-plan` experience remains unchanged. `/care-plan` remains the separate Home Care wizard and no Home Care packages, prices, or purchases appear here. Create Account, Sign In, phone/password authentication, registration Edge Function, AuthContext identity mapping, adult eligibility rules, and minor registration were not changed. No dependent, guardian, or family AI functionality was added. Repairs 1–15 remain intact.

## 7. Verification

- Clean PGlite migration replay: passed. The harness applies the 44 earlier migrations and then the family, Care Plan, reconciliation, and family projection migrations in order.
- Focused Phase 4D UI/service/database tests: **5 files passed, 79 tests passed**. Includes explicit-scope denial, authorized empty state, linked-source masking, expiration/revocation/consent withdrawal/membership removal, family mutation denial, no arbitrary patient lookup, self route, separate plans, and independent permission management.
- Established non-legacy repository suite, excluding `.kilo/**`, `bookableDoctorSeed.test.js`, `phase4DatabaseSchema.test.js`, and `phase9AppointmentManagement.test.js`: **77 files passed, 1,115 tests passed**. This includes Phase 4B/4B.1, Phase 4C/4C.1, Repairs 1–15, and Phase 1–3 regressions.
- Production build: **passed**. Vite emitted the existing main-bundle size warning (845.01 kB minified); the My Care Plan page remains separately lazy-loaded.
- Browser verification: not performed. No authenticated two-adult clinical fixture/session was available; no browser behavior is fabricated.
- Deployment: not performed.

## 8. Known limitations and next phase

The family projection exposes active plans only; historical and paused plans are not included in this family readout. Family Health's authorization refresh interval is 15 seconds, with immediate clearing when a refreshed membership/consent result changes. Visual browser verification with real accounts remains pending.

**Phase 4D is complete.** The next highest-priority phase is a constrained **provider Care Plan authoring experience**. The current provider authoring workflow remains database/RPC-only, so clinicians still lack a connected UI to create, review, and activate plans. This report does not implement that phase.
