# EasyCare Phase 5A Provider Clinical Care Plan Authoring

## 1. Status

**PARTIAL — the provider-scoped authoring workflow is implemented and its primary path passes, but the full 30-case Phase 5A UI verification checklist is not yet covered.** No authorization bypass was found. The remaining gap is verification of source selector variants, detail/version/lifecycle screens, and the activation failure paths as dedicated UI cases.

## 2. Phase 5A.0 foundation usage

The workflow reuses the Phase 5A.0 provider identity, provider route guards, provider shell, and relationship-scoped patient selector. Provider identity continues to resolve from `auth.uid()` through `get_my_provider_identity()`. Provider accounts are not provisioned here.

## 3. Provider Care Plans route

`/provider/care-plans` is now a provider-scoped plan list. The authoring wizard is at `/provider/care-plans/new`; provider detail is at `/provider/care-plans/:planId`; draft/version authoring and review are at `/provider/care-plans/:planId/edit` and `/provider/care-plans/:planId/activate`.

## 4. Provider plan list

The list uses the new `list_my_provider_care_plans()` projection. It groups draft, active, paused, completed, and discontinued plans and shows patient name, title, status, version, dates, and last update. It does not query or widen RLS on raw Care Plan tables. Authorization or network errors render as errors rather than an empty list.

## 5. Patient selection

The wizard uses only `list_my_clinical_patients()` through `providerWorkspaceService.listPatients()`. It shows minimal display name and relationship context; there is no global search or patient UUID field. Every write RPC independently rechecks the doctor identity and patient relationship.

## 6. Draft creation

The UI creates drafts through `create_care_plan_draft()`. That RPC derives the provider from `auth.uid()`, checks current eligible doctor identity and clinical patient access, validates the timezone, and creates the initial draft version and audit events in the database.

## 7. Plan details

The wizard supports title, summary, instructions, start date/time, optional target end date, and timezone. Date/time values are converted using the selected timezone before being sent to the RPC. The schema has no independent plan metadata update RPC, so saved draft/version details are displayed read-only when resuming.

## 8. Goals

Goals are clinician-authored and added through `add_care_plan_goal()`. Unsaved goals can be removed locally and ordered before saving. The current database contract has no update, delete, or reorder operation for saved goals; persisted draft goals are therefore read-only in the resumed wizard. Published version contents remain immutable.

## 9. Tasks

The UI uses the existing enum values: `medication`, `vital_check`, `appointment`, `follow_up`, `activity`, `instruction`, and `custom`. Tasks are created with `add_care_plan_task()`. Unsaved tasks can be removed locally. The RPC/schema validates source linkage, recurrence, vital types, and manual acknowledgement rules.

## 10. Medication selector/linkage

`list_provider_care_plan_sources(patient, 'medication')` is a narrow provider-authorized read projection. It checks doctor eligibility and relationship independently and returns only same-patient active medication and valid schedule fields needed by the selector. Future-valid schedules are excluded. The task is linked to both medication and schedule IDs; free-text medication does not create medication truth. Backend composite constraints remain authoritative.

## 11. Vital tasks

The wizard exposes only the validated types: blood pressure, heart rate, SpO2, temperature, glucose, and weight. The task links to no fabricated reading, threshold, or diagnosis. Grace configuration is not exposed; the backend default applies.

## 12. Appointment linkage

The source projection returns minimal same-patient appointment fields for pending, confirmed, or rescheduled appointments. The task points to the existing appointment; it does not create or mutate an appointment. Backend linkage validation remains authoritative.

## 13. Follow-up linkage

The source projection returns same-patient pending follow-ups with recorded due times. The task references the existing follow-up lifecycle and does not create a second follow-up record or lifecycle. Backend linkage validation remains authoritative.

## 14. Manual tasks

Activity, instruction, and custom tasks may use the existing manual acknowledgement setting. The UI forces it off for medication, vital, appointment, and follow-up tasks; the database also restricts acknowledgement to eligible manual task types.

## 15. Recurrence

The UI uses the existing recurrence values: `one_time`, `daily`, `selected_weekdays`, `multiple_daily_slots`, and medication `source_schedule`. It validates weekdays, local-time format, the eight-slot maximum, and task date ordering before submission. Appointment and follow-up tasks are one-time. No client-side occurrence generation was added.

## 16. Review

The review step shows patient, plan details, goals, tasks, linked medication label, schedule/recurrence information, and timezone. It is read-only. Activation requires an additional explicit confirmation checkbox.

## 17. Activation

Activation publishes the draft version through `approve_care_plan_version()` and transitions the plan using `transition_care_plan('activate')`. The UI does not generate occurrences or reconcile sources. It reloads by navigating to the provider-scoped detail contract and does not claim that a notification was sent. The migration’s active-version wrapper refreshes bounded occurrences and reconciles on publication of a replacement version.

## 18. Provider plan detail

`get_my_provider_care_plan(plan)` returns a provider-authorized detail projection using current doctor identity, responsible-provider match, and clinical relationship checks. The screen shows patient, plan information, current/draft version, goals, tasks, status, and version history. Inaccessible plans return an unavailable state without disclosing whether an unrelated plan exists.

## 19. Versioning

The UI starts a new version through `create_care_plan_version()`, preserving published history. An active plan remains active when a new version is published; a paused plan remains paused. Existing backend operations allow appending goals/tasks to the draft version, but do not allow edits/removals of saved draft content or metadata. The UI makes those limits visible.

## 20. Lifecycle

Controls are limited to backend-valid transitions: draft activate/cancel, active pause/complete/discontinue, and paused resume/complete/discontinue. Completed, discontinued, and cancelled plans expose no reopen transition. Each action reloads the provider-authorized detail projection.

## 21. Audit/events

All mutations use the existing intent-specific RPCs. Draft creation, version creation/approval, lifecycle transitions, and patient manual acknowledgement remain audited by database events. No direct table mutation API was added to the browser repository.

## 22. Provider authorization

The existing `assert_care_plan_doctor()` checks authenticated identity, active/current clinical identity, doctor role/type, verified provider status, provider ID mapped to `auth.uid()`, and `can_access_patient(patient, 'clinical')`. Each existing authoring/lifecycle RPC invokes it. The new list, detail, source, and publish projections independently resolve the current provider and check the target plan/patient.

## 23. Relationship semantics

Authorization intentionally follows existing `can_access_patient()` and Phase 5A.0 semantics. A provider appointment can count as a relationship even when historical or cancelled; this limitation remains in the backend and has not been redefined in React. Care assignment relationships follow their existing accepted/assigned rules.

## 24. Direct-write protection

Browser writes to `care_plans`, `care_plan_versions`, `care_plan_goals`, `care_plan_tasks`, `care_plan_task_occurrences`, and `care_plan_events` remain revoked. The integration test confirms an authenticated direct plan insert is denied. Raw Care Plan RLS was not broadened for provider convenience.

## 25. Patient integration

The existing patient `list_my_care_plan_summaries()` and `/my-care-plan` architecture remain in place. Activation publishes the same Clinical Care Plan model consumed by that patient view; no parallel patient model was introduced.

## 26. Family integration

Phase 4D remains read-only and authorization remains based on its explicit family scopes. Provider authoring does not grant family membership or permissions. Family and Care Plan integration suites pass in the filtered regression run.

## 27. Home Care boundary

`/care-plan` remains the commercial Home Care packages, pricing, duration, and service-request flow. Provider Clinical Care Plan routes use the separate `/provider/care-plans` namespace.

## 28. AI boundary

No AI authoring control, recommendation path, or AI-created authoritative plan was added. Authoring is explicitly clinician-authored.

## 29. Auth preservation

Phase 5A.0 provider sign-in, identity resolution, dual-role workspace choice, route guards, provider Patients page, session restoration, logout, and account switching remain in use. This phase did not change their authority model.

## 30. Tests

- Provider-focused UI, route/auth, care plan service, patient My Care Plan, family health, and provider migration/RPC tests: **7 files passed, 55 tests passed**.
- Phase 4D/full-chain family and Care Plan integration: **44 tests passed**. Its two time-dependent fixtures now choose a due time ten minutes before the database clock, so they behave consistently across local time-of-day.
- Filtered active-workspace regression suite: **81 files passed, 1,138 tests passed**. It excludes duplicate `.kilo/**` worktree copies and three obsolete tests that require migration files absent from the current repository (`bookableDoctorSeed`, `phase4DatabaseSchema`, `phase9AppointmentManagement`). This run includes provider identity, Care Plan, family, patient auth/registration, Phase 4B–4D, and Repairs 1–15 coverage.
- An unfiltered `npm test` run before the fixture correction included duplicate `.kilo/**` tests and failed on the two time-dependent assertions plus obsolete/missing-migration tests. The filtered active-workspace run passed after the fixture correction.
- The Phase 5A-specific UI suite currently has four scenarios; it does not yet individually exercise every item in the requested 30-case UI checklist. This is the reason the phase is reported partial.

## 31. Clean migration replay

The provider migration integration test replays all earlier migrations in order, applies `20261003160000_provider_care_plan_read_projections.sql`, and exercises identity resolution, authorized draft creation, list/detail projection, source projection, relationship filtering, and direct-write denial. **10/10 provider migration integration tests passed.**

## 32. Build

`npm run build` passed. Vite reported the existing main JavaScript chunk size warning (about 885 kB minified).

## 33. Browser verification

Not performed. No legitimate provider/patient browser fixture or session is configured in this workspace. No production account or clinical record was fabricated.

## 34. Known limitations

- Dedicated Phase 5A UI coverage does not yet reach all 30 requested cases; in particular source-selector variants, detail/version/lifecycle screens, and activation failure handling need dedicated UI assertions.
- Existing RPCs do not support editing/removing/reordering saved draft goals/tasks or editing a saved draft’s plan/version metadata. The current wizard safely supports local edits/removals before save and append-only changes after save.
- Stale concurrent edits are limited by row locks and backend state checks, but the RPCs do not accept an expected version/revision token. Multiple simultaneous editors can still encounter conflicts; the UI reports stale/current-state failures and asks the doctor to reload.
- No real-provider browser acceptance test was possible in this environment.

## 35. 30-day occurrence horizon

Existing Phase 4C.1 generation/reconciliation remains bounded to the established 30-day horizon. Activation and active version publication call validated backend lifecycle/reconciliation functions. No cron, scheduler, unlimited generation, or client-side reconciliation was added.

## 36. Deployment status

No deployment was performed.

## 37. Next-phase recommendation

Finish Phase 5A verification by adding the remaining dedicated UI tests for medication/vital/appointment/follow-up selectors, recurrence validation, detail/version/lifecycle paths, terminal states, and mutation failures. Do not begin a dependent phase until this Phase 5A verification gap is closed.
