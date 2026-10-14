# EasyCare Phase 4B.1 Reconciliation and Security Report

**Status: COMPLETE.** Phase 4B.1 closes the persistent source attribution and adversarial security blockers identified by Phase 4B. Phase 4B is ready for Phase 4C patient UI, subject to the contracts and limitations below.

## Scope and changed files

- Added `supabase/migrations/20261003120000_care_plan_source_reconciliation.sql`, a forward-only repair. The historical Phase 4B migration was not edited.
- Expanded `src/lib/familyFoundation.integration.test.js` with PostgreSQL/PGlite integration coverage, including source reconciliation and source-schedule recurrence.
- Added narrow service/repository methods in `src/services/carePlanService.js` and `src/services/repositories/carePlanRepository.js` for reconciliation and read projections; service contract tests are in `src/services/carePlanService.test.js`.
- No Smart Care Plan UI, registration/sign-in, Home Care `/care-plan`, provider UI, dependent functionality, AI-authoring, scheduler, or deployment changes were made for this phase.

## Reconciliation architecture

The browser can request reconciliation for a plan but cannot choose an occurrence or submit a source ID. The server-side `reconcile_care_plan_occurrences(plan_id)` function validates the caller, plan, task, patient, source status, and compatibility before persisting attribution. An internal attach helper is not executable by authenticated clients. A patient-row lock serializes reconciliation across that patient's plans; unique partial indexes make each medication event, vital reading, appointment, and follow-up attributable to at most one occurrence.

Attribution is stored on `care_plan_task_occurrences` in the existing source-specific columns. One completion event is appended with minimal source type and ID. Repeated reconciliation preserves the attribution and does not create duplicate completion events.

### Matching rules

- **Medication:** the source must be a `medication_events` row for the same patient, with `status = taken`, exact medication and schedule matching the task, and exact due timestamp matching the occurrence. `pending`, `missed`, `skipped`, `unknown`, wrong medication/schedule, and cross-patient records do not complete an occurrence.
- **Vital:** the reading's patient and supported vital type must match. The allowed interval is `[scheduled_at - grace_minutes, scheduled_at + grace_minutes]`; the configured grace is capped at 120 minutes and defaults to 60. Timestamps are compared as absolute instants. When a reading can match multiple unresolved occurrences, the closest scheduled instant wins, then stable scheduled-time, plan, task, and occurrence UUID ordering breaks ties. The unique source index prevents a second assignment.
- **Appointment:** only the exact linked appointment for the same patient with `status = completed` qualifies. Materialized occurrence time follows that appointment's timestamp. Reconciliation never changes appointment state.
- **Follow-up:** only the exact linked same-patient follow-up in its existing `completed` state qualifies. The existing follow-up lifecycle and Repair 2 remain authoritative.
- **Manual tasks:** existing acknowledgement remains limited to eligible `activity`, `instruction`, and `custom` tasks. Source-backed tasks cannot use generic manual completion.

Appointment and follow-up tasks are constrained to one-time recurrence. Medication `source_schedule` generation now selects the schedule linked to the task and respects its validity dates and weekdays. The forward migration repairs a Phase 4B generator guard that previously skipped these tasks.

## Progress, corrections, events, and family projections

Progress counts persisted source links only while their authoritative source remains valid. If a source is later corrected, deactivated, or changes to an incompatible state, the occurrence reads incomplete and progress falls accordingly; the original attribution and append-only event remain for audit. No synthetic reversal event or competing clinical record is created. Reconciliation must be invoked again by an authorized caller; automatic background reconciliation is not configured.

Family members receive controlled read projections only with an active explicit `care_plans` grant. The projection masks medication, appointment, vital, and encounter details unless the matching medication, appointment, or records scope is also granted. Family members cannot reconcile, acknowledge, author, activate, or otherwise mutate plans. Direct authenticated reads of source-bearing child plan tables and the unsafe legacy list RPC are revoked in favor of scoped projections.

## Security and same-patient coverage

The integration matrix covers active/verified/related doctors and rejects suspended, inactive, unverified, unrelated doctors, patients as authors, family members, and related non-doctor clinicians. Existing explicit role semantics are retained; no nurse authority is inferred. AI has no authoritative plan-write path.

Family integration cases verify denial for membership-only and records-only access; explicit `care_plans` read-only access; source masking and additional-scope reveal; and denial for expired, revoked, removed, withdrawn, and legacy grants. Family reconciliation and mutation attempts are denied.

Source adversarial cases verify exact medication and schedule matching, all non-taken medication statuses, single-use attribution, vital type and window enforcement, deterministic overlap resolution, appointment status compatibility, completed follow-up ownership, cross-patient foreign-key protections, correction fail-closed behavior, and idempotence. The existing Repair 1–15 integration/security tests were included in the passing repository suite, including the relevant prescription/encounter, follow-up, appointment pricing, encounter/appointment, vital/encounter, medication event, alert/vital, prescription item, and care request integrity checks.

## Recurrence and verification results

Recurrence integration covers one-time, daily, selected weekdays, multiple daily slots, and medication schedule-based generation; it checks idempotency, timezone/local-date conversion, a 30-day generation cap, and preservation of prior-version occurrence history.

- Focused Phase 4B.1 PGlite integration and service tests: **2 files passed, 44 tests passed** (42 integration and 2 service tests).
- Established non-legacy repository suite, excluding `.kilo/**`, `src/lib/bookableDoctorSeed.test.js`, `src/lib/phase4DatabaseSchema.test.js`, and `src/lib/phase9AppointmentManagement.test.js`: **75 files passed, 1,081 tests passed**. This includes family authorization/security and the established Repair 1–15 regressions.
- Clean migration replay: **passed** in the focused PGlite integration harness from the historical migration chain through family foundation, Phase 3 family read access, Phase 4B, and Phase 4B.1. The harness also verifies the 44-migration pre-family chain and family/identity invariants.
- Production build: **passed**. Vite reported the existing large JavaScript chunk warning (827.47 kB minified; 229.14 kB gzip).
- Browser/runtime verification and deployment: **not performed**; this phase intentionally added no UI and deployed nothing.

## Known limitations and Phase 4C contract

There is no scheduler. Reconciliation runs only when an authorized service caller invokes the narrow RPC. Source correction makes derived completion fail closed but does not create a reversal event or erase immutable attribution. No historical occurrence/source backfill was run. Phase 4C must use the read projections and narrow reconciliation contract; it must not accept client-selected source attribution, must preserve family masking/read-only permissions, and must treat the existing clinical source tables as authoritative. The clinical Smart Care Plan remains separate from the commercial Home Care `/care-plan` flow.

## Explicit boundary confirmations

The Home Care `/care-plan` flow is unchanged and remains separate from Clinical Smart Care Plan. Create Account, Sign In, authentication identity mapping, phone/password behavior, and minor registration remain unchanged. No historical source data was backfilled, no fake runtime clinical data was added, and no deployment was performed. Medication truth remains in medication tables/events; vital truth remains in `vital_readings`; appointment truth remains in `appointments`; follow-up truth remains in `follow_ups`. One source row cannot be consumed by multiple occurrences. Family membership alone and `records` alone grant no Care Plan access; `care_plans` remains explicit and read-only for family, and family cannot complete another adult's tasks. AI cannot create or activate authoritative plans. Phase 1, Phase 2, Phase 3, and Security Repairs 1–15 remain covered by the passing suite. No Smart Care Plan UI or dependent/guardian functionality was added.

**Phase 4B complete and ready for Phase 4C — Patient “My Care Plan” UI: YES**, with the scheduler, immutable attribution/correction behavior, source authority, and family/provider access contracts above.
