# EasyCare Phase 4B Smart Care Plan Core Report

## Status

**PARTIAL.** The additive clinical domain, scoped read access, doctor-authorized plan operations, lifecycle controls, and derived progress foundation are implemented. The remaining source-to-occurrence reconciliation and broader security coverage listed under Limitations must be completed before Phase 4C is ready.

## Product boundary

- Existing `/care-plan` remains the Home Care service/package selection and request wizard.
- Home Care packages, service fees, and pricing were not converted into clinical plans.
- Clinical Smart Care Plans are a separate database domain.
- `care_encounters.care_plan` remains historical free text.
- No existing patient records were backfilled.
- No new Smart Care Plan UI or deployment was added.

## Files changed

- `supabase/migrations/20261003110000_clinical_smart_care_plans.sql`
- `src/lib/familyFoundation.integration.test.js`
- `src/services/repositories/carePlanRepository.js`
- `src/services/carePlanService.js`
- `src/services/carePlanService.test.js`
- `docs/EASYCARE_PHASE4B_SMART_CARE_PLAN_CORE_REPORT.md`

## Database model and rules

The additive migration creates `care_plans`, `care_plan_versions`, `care_plan_goals`, `care_plan_tasks`, `care_plan_task_occurrences`, and append-only `care_plan_events`. Plan ownership references one immutable `patients.id`. Same-patient foreign keys protect source encounters, goals, tasks, appointments, follow-ups, medication/schedule/event links, and vital-reading links. Supporting composite keys were added to existing source tables without changing their rows.

Plan statuses are `draft`, `active`, `paused`, `completed`, `discontinued`, and `cancelled`. RPC transitions permit draft to active/cancelled, active to paused/completed/discontinued, and paused to active/completed/discontinued. Terminal plans cannot reopen. Authenticated clients have SELECT privileges only on the new tables; mutations use named RPCs.

Published version rows and their goal/task definitions reject edits. New versions preserve prior version rows and start as a new draft for provider-authored content. Goals are version-bound. Task types are medication, vital check, appointment, follow-up, activity, instruction, and custom. Manual acknowledgement is constrained to activity/instruction/custom tasks.

Occurrence generation is bounded to 30 local days, supports one-time, daily, selected weekdays, multiple daily slots, and medication source schedules, and is idempotent by task and occurrence key. It runs only when explicitly called; no scheduler or background worker is configured. The migration does not claim automatic generation.

Progress is derived from occurrences and source state. Future and optional work is excluded, cancelled work is excluded from the denominator, incomplete work stays in the denominator, and empty periods return `no_tasks_due` with a null percentage. This is task completion, not a health or recovery score.

Care plan events reject UPDATE and DELETE. Current RPCs record plan creation, version creation/approval, lifecycle transitions, and manual occurrence completion.

## Authority, access, and data sources

Plan creation, authoring, approval, lifecycle transitions, and occurrence generation require a current doctor account, a verified doctor provider record, and a clinical relationship to the patient. Patients and family members cannot create or activate authoritative plans. AI, coordinator, clinic admin, and support paths are not authors.

Patients can read their own plans. Related doctors, nurses, and caregivers can read via existing clinical access. Main-admin access is not granted by the new plan policies. Family access is patient-role only, read-only, and requires an active explicit `care_plans` grant plus the existing consent, expiry, revocation, and group membership checks. Membership alone and `records` alone do not grant plan access. Legacy grants receive `can_view_care_plans=false`.

`grant_family_authorization` accepts the independent `care_plans` boolean. Family membership and health-member metadata include the new flag. Removing a family member continues to revoke group-origin grants. Linked medication and appointment details in the detail projection require their respective scopes; follow-up detail requires clinical/records access. Source tables remain their own truth:

- Medication truth remains `patient_medications`, `medication_schedules`, and `medication_events`; only a matching `taken` event counts.
- Appointment truth remains `appointments`; only `completed` counts.
- Vital truth remains `vital_readings`; a typed real measurement in the configured time window counts.
- Follow-up truth remains `follow_ups`.
- Alerts remain `monitoring_alerts`.

The final `can_access_patient` helper accepts only the traced permission names plus explicit `records` and `care_plans`; unknown names fail closed. Existing provider, coordinator, and clinic-admin branches were preserved. Family `clinical` continues to map to records access, while `care_plans` is independent.

## Service contracts

`carePlanRepository` and `carePlanService` expose narrow calls for draft creation, new version creation, goal/task authoring, approval, lifecycle intent, occurrence generation, manual acknowledgement, list/detail, and progress. The browser service performs no direct table mutations and forwards no actor identity; RPCs derive the actor from `auth.uid()`.

## Verification

- PostgreSQL-compatible migration replay and family foundation integration: **30 passed**. This replays the 44 earlier migrations, then the family foundation, family health read migration, and Phase 4B migration.
- Care plan service contract tests: **2 passed**.
- Production build: **passed**. Vite reports the existing large-chunk warning (main JS bundle about 827 kB).
- Full repository test run: **1,267 passed, 2 failed, 7 suites failed to load**. The failures are outside this change: three legacy migration files referenced by tests are absent from the workspace, the same absent-file suites are duplicated under `.kilo/worktrees/few-mask`, and two stale nested-worktree medication dashboard contract checks fail. The Phase 4B integration and service tests pass.
- The Phase 4B PostgreSQL-compatible slice passed; production Supabase deployment/replay was not performed.

## Limitations and Phase 4C readiness

- **Scheduler status:** none configured. A caller must invoke bounded occurrence generation.
- **Source reconciliation:** progress derives completion from source records, but source events/readings are not yet persistently attached to occurrence rows as they arrive. Vital matching currently uses a time window and can match one reading to multiple overlapping occurrences. A reconciliation contract and corresponding tests are needed before relying on occurrence-level source attribution.
- **Version editing:** a new version is created as an empty draft; the provider must author its goal/task definitions. Prior versions remain preserved.
- **Security test coverage:** the new integration cases cover explicit scope, unknown-scope denial, family read-only behavior, provider authoring, lifecycle, and no-task progress. The complete requested adversarial matrix for every source type, expiry/removal, linked-detail masking, recurrence edge, and all repair regressions is not yet present as Phase 4B-specific tests.
- **Deployment status:** no deployment performed.

**Ready for Phase 4C patient UI: NO.** Complete source-to-occurrence reconciliation with unambiguous measurement attribution and expand the requested security integration matrix first. The UI must use the new RPC/service read contracts, treat `no_tasks_due` as a semantic state, and never offer family task completion or direct table writes.

## Preserved prior behavior

Repairs 1–15, Phase 1, Phase 2, Phase 3, minor registration, adult-only family management, and existing Home Care flow were not intentionally modified. No dependent functionality, synthetic production clinical rows, UI, or deployment was added. Test-only synthetic fixtures are isolated to the PostgreSQL-compatible integration test.
