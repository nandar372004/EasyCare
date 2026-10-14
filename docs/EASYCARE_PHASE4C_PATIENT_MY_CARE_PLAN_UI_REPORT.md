# EasyCare Phase 4C — Patient “My Care Plan” UI Report

**Status: COMPLETE.** The patient-facing clinical My Care Plan experience is implemented on its own authenticated route and consumes the Phase 4B/4B.1 patient read and mutation contracts. Phase 4C does not include family plan viewing or provider plan authoring.

## 1. Files changed

- `src/features/care-plan/MyCarePlanPage.jsx` and `src/features/care-plan/MyCarePlanPage.test.jsx`: clinical patient page, projection handling, focused UI coverage.
- `src/features/dashboard/CarePlanDashboardSummary.jsx`: isolated current-plan dashboard card.
- `src/App.jsx` and `src/App.carePlanRoute.test.jsx`: lazy route registration and route compatibility tests.
- `src/data/navigation.js`, `src/components/Sidebar.jsx`, `src/components/BottomNav.jsx`, `src/components/GlobalSearch.jsx`, and `src/features/localization/translations.js`: clear Home Care / My Care Plan navigation labels.
- `src/features/care-plan/CarePlanPage.jsx`: Home Care terminology only; existing package, price, and wizard behavior is unchanged.
- `src/features/dashboard/DashboardPage.jsx` and `src/styles/global.css`: dashboard integration and responsive styling.
- No migration, source schema, authentication, registration, family, AI, or deployment files were changed for Phase 4C.

## 2. Routes and navigation

- **`/my-care-plan`** is the new authenticated patient route. It is lazy-loaded as a separate bundle chunk.
- **`/care-plan`** remains the existing Home Care wizard route. No `/my-care-plan/:patientId` route is registered; route tests verify that a patient-ID path is not accepted.
- Sidebar and mobile navigation use **Home Care** for `/care-plan` and **My Care Plan** for `/my-care-plan`. Global Search uses the same distinct names and descriptions.

## 3. Home Care compatibility and terminology

The existing commercial wizard is now titled “Request Professional Home Care,” its summary is “Your Home Care Request,” and its final action says “Request Home Care.” It still shows the existing preview disclosure that it does not create or send a real booking. Package options, pricing calculations, and request-preview behavior were not changed.

## 4. My Care Plan page and current-plan selection

The page presents the provider's plan title, status, plan dates, timezone-derived day number when supported, plan instructions, today's progress, today's occurrence cards, the next upcoming required occurrence, current-version goals, and plan version/update information. The current backend projection does not provide a responsible-provider display name; the UI does not expose provider UUIDs and identifies that name as unavailable.

Only plans whose `patient_id` matches the authenticated patient ID from AuthContext are shown. One active plan is selected by default. If several active plans exist, the page asks the patient to select one instead of silently combining them. If there is no active plan, it displays the provider-created-plan empty state and links to Home Care only as a separate option. Other returned plan statuses remain visible as read-only plan history.

Day X / Day X of Y is derived from plan start/target timestamps as local calendar dates in the plan timezone. It is omitted if the current local date is before the plan start or dates cannot be parsed. There is no naive UTC duration calculation.

## 5. Progress, tasks, and source behavior

Today's progress uses `get_care_plan_detail`'s backend-derived `progress.today` result, with a native accessible progress indicator for `tasks_due`. `no_tasks_due` renders the semantic message “No care tasks due today” without a zero-percent or full-percent indicator. This remains care-task completion, not a health, recovery, risk, or treatment-success score.

Occurrence cards are sorted by scheduled timestamp and stable occurrence ID. They display the plan task title/type, local due time/date, unmodified provider task instructions, available completion status, and minimal supported source status. Occurrences are joined against the returned task projection across versions so preserved historical occurrences are not silently lost; goals are limited to the current version.

- Medication completion is shown as taken only when the source projection reports a valid medication-event attribution. There is no generic medication completion control and no medication mutation.
- Vital completion shows the real recorded timestamp when returned. There is no checkbox or fabricated vital reading. The contextual link opens the existing Health Records view; no patient vital-entry workflow was present to call.
- Appointment task details link to the existing appointment page only when the safe projection provides an authorized linked appointment ID. Care Plan does not alter appointment status.
- Follow-up status/instructions are displayed from the safe linked projection when available. There is no separate follow-up mutation.
- Only active-plan `activity`, `instruction`, or `custom` occurrences configured for manual acknowledgement, still pending and already due, show “Mark as done.” The action calls `acknowledge_care_plan_occurrence` with that occurrence ID only and reloads detail/progress. Other tasks and non-active plans have no manual completion action.

On selecting an active plan, the page loads the plan projections, requests the narrow server-side reconciliation once for that plan during the page session, then reloads projections. It sends only the plan ID; it never sends a source record ID or client-selected attribution. There is no claim of real-time monitoring. Reconciliation errors leave successfully loaded data visible with a separate status message.

## 6. Goals, empty states, and errors

Goals and instructions are rendered as authored. Empty copy covers no clinical plan, no tasks due, no upcoming tasks, and no goals. Paused, completed, discontinued, and cancelled plans are visibly labeled; clinical lifecycle controls are absent. Discontinued/completed/paused plans do not show actionable next tasks or allow acknowledgement.

Plan loading, patient identity/access, list/network errors, detail errors, occurrence-only errors, reconciliation errors, acknowledgement errors, and acknowledgement success have distinct accessible states. If occurrence retrieval fails but detail succeeds, progress and goals remain visible while the Today/Next task areas report unavailable data instead of claiming no tasks exist. The dashboard hides a failed Care Plan query without breaking other dashboard sections.

## 7. Dashboard, accessibility, and responsive behavior

The dashboard has a small independent query for the authenticated patient's active plan. It shows real backend progress and the nearest required pending task, or an honest no-tasks-due state. Multiple active plans are represented as a list with separate links. Query failures do not affect the health dashboard.

The page uses semantic headings/regions, labelled progress, text status alongside color, keyboard-operable selects/links/buttons, visible button labels, status/alert roles, and minimum 40-pixel acknowledgement touch controls. Styling uses existing EasyCare tokens and card conventions, with layouts adapting at tablet and mobile widths. The separate page chunk helps limit bundle impact.

## 8. Boundaries preserved

Patient identity comes only from authenticated AuthContext and returned patient-owned summaries; no patient ID is read from URL parameters or local storage. Family plan UI and family task acknowledgement were not added. Existing family scope and source masking remain defined by the 4B.1 projections. AI is not connected to plan authoring, editing, activation, medication, instructions, or completion.

Create Account, Sign In, phone/password authentication, patient identity mapping, and minor registration are unchanged. Phase 1, Phase 2, Phase 3, and Security Repairs 1–15 are covered by the established passing regression suite. No dependent functionality or production clinical fixtures were added. Test-only clinical fixtures remain isolated in tests.

Source-of-truth tables remain authoritative: medication tables/events, `vital_readings`, `appointments`, and `follow_ups`. The UI uses existing patient projections, narrow reconciliation, and eligible acknowledgement RPCs; it performs no direct plan/source table writes.

## 9. Verification results

- Phase 4C page, route, navigation, and dashboard tests plus Phase 4B service/integration tests: **4 files passed, 70 tests passed**. This includes Phase 4B.1 clean PGlite migration replay and reconciliation coverage.
- Established non-legacy repository suite, excluding `.kilo/**`, `src/lib/bookableDoctorSeed.test.js`, `src/lib/phase4DatabaseSchema.test.js`, and `src/lib/phase9AppointmentManagement.test.js`: **77 files passed, 1,107 tests passed**. This includes registration/sign-in regressions, Phase 3 family behavior, and Security Repairs 1–15.
- Production build: **passed**. Vite emitted a separate `MyCarePlanPage` chunk of about 17.3 kB (5.1 kB gzip). The main JavaScript bundle remains above the 500 kB warning threshold (about 836.3 kB minified, 231.7 kB gzip).
- Browser verification: **not performed**. No real authenticated clinical fixture/session was available for visual desktop/mobile verification; UI states and route behavior are covered by component tests.
- Deployment: **not performed**.

## 10. Known limitations and Phase 4D readiness

There is no background scheduler; active-plan reconciliation is requested on selection/page load only. Care Plan currently has no provider display-name field in its safe detail projection, and no patient vital-entry workflow was available, so the UI does not invent either. Occurrence availability depends on the existing bounded occurrence generation contract. Historical completed/discontinued plans remain read-only and are not edited here.

**Phase 4C is complete and ready for Phase 4D — Family Read-Only Care Plan UI: YES.** Phase 4D must retain explicit `care_plans` authorization, use the family-safe projections with source masking, filter to authorized family members, and must not add task acknowledgement or delegated completion.
