# EasyCare Phase 4C.1 — Automatic Care Plan Reconciliation

**Status: COMPLETE.** Source writes now reconcile the affected patient's supported clinical Care Plan occurrences in the same database transaction. Phase 4B.1 remains the single active matching implementation. No deployment was performed.

## Architecture

The source tables are written through separate database and trusted service paths; there is no common application post-write hook, Edge Function orchestration, or scheduler. Four narrowly scoped `AFTER` triggers call a private `SECURITY DEFINER` database helper with the patient ID from the persisted source row. The helper uses the Phase 4B.1 patient lock, exact source validation, deterministic matching, and attribution/event writer. The existing public `reconcile_care_plan_occurrences(plan_id)` retains its patient/responsible-doctor authorization and delegates to that same helper. The matching loop is not exposed to authenticated or anonymous callers.

The triggers are atomic with the source write: an unexpected reconciliation database error rolls back that write. Matching and occurrence locks serialize concurrent attribution. The existing Phase 4C page-load reconciliation remains a defensive consistency check.

## Source events and corrections

- **Medication:** `INSERT` or status update to `taken` triggers reconciliation. Exact patient, medication, schedule, and scheduled instant remain required. Pending, missed, skipped, unknown, and incompatible medication events do not complete an occurrence. An event can be attributed once.
- **Vitals:** Persisted readings with at least one measurement trigger reconciliation. Type, patient, configured grace window, closest occurrence, stable tie-breaking, and single-use attribution are unchanged. The system does not judge whether a value is medically good or bad.
- **Appointments:** Insert or status update to `completed` triggers reconciliation. Pending, confirmed, cancelled, no-show, and rescheduled rows do not. The trigger does not edit appointment state.
- **Follow-ups:** Insert or status update to the existing `completed` state triggers reconciliation. The existing Repair 2 patient/encounter authority and lifecycle remain in control; no second follow-up lifecycle was added.

Attribution and its append-only completion event are retained if a source is later corrected. Progress checks the current authoritative source row and fails closed when the source no longer meets the Phase 4B.1 validity conditions; the completion event is not rewritten and no reversal clinical record is fabricated. Because progress is derived from source validity, corrections are reflected on the next progress read. A correction does not create a new attribution.

## Activation and bounded generation

Validated activation and resume now call the existing occurrence generator inside the same transaction, then reconcile existing authoritative sources for that patient's active plans. Generation remains idempotent and capped at the current local date plus 30 days. Repeated activation is prevented by the existing lifecycle transition rules; repeated source processing creates no duplicate occurrence, attribution, or event.

There is no cron or background scheduler, and this event-driven source completion does not require one. Recurring tasks beyond the 30-day horizon still need a future bounded extension invocation. No scheduler was added. Plans that were already active before this migration retain their existing generated occurrences; on their next activation/resume generation is automatic. Source triggers do not fabricate clinical rows or invent missing occurrence history.

## Security and product boundaries

The trigger uses only the persisted row's `patient_id`; source callers cannot choose a Care Plan occurrence or attribution. The internal helper and trigger function have execution revoked from `PUBLIC`, `anon`, and `authenticated`. The public RPC still requires the authenticated patient or verified responsible doctor. Existing same-patient constraints, source validation, RLS, provider authorization, family read-only `care_plans` scope, and Repairs 1–15 remain in place. Family members cannot force reconciliation or complete another adult's task. AI has no completion authority.

`/my-care-plan` and its existing page-load consistency call are unchanged. `/care-plan` Home Care packages, pricing, and request flow are unchanged. Create Account, Sign In, phone/password authentication, identity mapping, minor registration, and Phase 4D UI were not modified. Source tables remain authoritative. No fake clinical data was added.

## Changed files

- `supabase/migrations/20261003130000_care_plan_event_driven_reconciliation.sql` — private shared reconciliation path, four source triggers, authorized RPC wrapper, and activation/resume generation.
- `src/lib/familyFoundation.integration.test.js` — clean migration replay and trigger, status, attribution, correction, bounded generation, RLS, family, and deterministic matching coverage.
- `docs/EASYCARE_PHASE4C1_AUTOMATIC_RECONCILIATION_REPORT.md` — this report.

## Verification

- Clean PostgreSQL-compatible PGlite replay: passed, including all 44 earlier migrations followed by the family/clinical Care Plan migrations and this forward migration. Existing identity, foreign-key, helper, and RLS policy assertions remain intact.
- Focused Care Plan/family integration: **42 tests passed**. Coverage includes source status transitions, wrong medication/type/window, cross-patient isolation, appointment/follow-up completion transitions, correction fail-closed behavior, immutable attribution/event history, repeated invocation, closest-vital resolution, single-use sources, internal-helper ACL, family denial, activation generation, and 30-day bound.
- Established repository regression suite (excluding `.kilo/**`, `bookableDoctorSeed.test.js`, `phase4DatabaseSchema.test.js`, and `phase9AppointmentManagement.test.js`): **77 files passed, 1,107 tests passed**.
- Production build: **passed**. Vite reports the existing large main-bundle warning (836.28 kB minified); the My Care Plan chunk is 17.28 kB.
- Browser verification: not performed; no authenticated clinical browser session was available. UI route and component regression tests passed.
- Deployment: not performed.

## Phase 4D readiness

**YES — ready to proceed to Phase 4D, Family Read-Only Care Plan UI.** Keep the explicit `care_plans` permission and source masking; do not add family task completion. Recurring occurrence extension beyond the existing 30-day horizon remains a separate bounded operational requirement and does not block the read-only family UI.
