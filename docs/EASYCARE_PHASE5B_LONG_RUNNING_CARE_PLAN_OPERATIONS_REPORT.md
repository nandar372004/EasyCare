# EasyCare Phase 5B — Long-Running Care Plan Operations

## Status

**PARTIAL — bounded rolling generation and a server-only maintenance primitive are implemented. Scheduled runtime invocation is not configured in this repository and remains a deployment/infrastructure requirement.** No deployment was performed.

## Previous limit and generator audit

The previous generator was `public.extend_care_plan_occurrences(plan_id, through_date)`, recreated by the Phase 4B.1 forward migration to repair `source_schedule` recurrence. It locks the plan row, requires the responsible doctor through `assert_care_plan_doctor`, accepts active plans only, and caps `through_date` to the plan's current local date plus 30 days. This is 31 local calendar dates including today. The limit is a date boundary, not a rolling 30×24-hour timestamp.

Tasks begin at the later of `starts_on` and their own timezone's current local date. The Phase 5B generator also honors the plan's `starts_at` local date. `ends_on` truncates task generation. The new migration clips the horizon to `target_end_at` in the plan timezone and omits due timestamps after the exact target timestamp. With no plan target, only the bounded 30-day-ahead window is generated. Plans with no end therefore do not generate unlimited rows.

The current published version is selected through `care_plans.current_version_id`; draft and older version tasks do not generate new rows. Occurrence identity remains `(task_id, occurrence_key)`, where the key is the local date and local time. Its unique constraint and `ON CONFLICT DO NOTHING` make repeated extension idempotent. The plan row lock serializes extension and lifecycle changes. The database uniqueness constraint also prevents duplicate rows if workers race. PGlite verifies repeated calls, not true multi-connection contention; concurrency protection is established by PostgreSQL locking and constraints.

Recurrences remain `one_time`, `daily`, `selected_weekdays`, `multiple_daily_slots`, and medication `source_schedule`. `source_schedule` reads currently valid schedule times for each date. Local due date/time and task timezone remain stored; conversion to `timestamptz` uses PostgreSQL `AT TIME ZONE`, preserving local clock intent across DST changes. Existing tests verify Asia/Yangon conversion. A DST-observing timezone integration case is not yet present.

## Lifecycle and replacement behavior

Activation and resume already generated the bounded window in the Phase 4C.1 lifecycle migration. The Phase 5B forward migration keeps that behavior and routes it through the shared private generator, then invokes the existing patient reconciliation helper. Paused, completed, discontinued, and cancelled plans are excluded from maintenance. The internal generator returns zero for non-active plans. Terminal lifecycle transitions remain one-way under the existing transition rules.

Approving a replacement version does not erase occurrences from the former version. Future generation selects only the new current version; old occurrences and their completion state remain historical. Extension and maintenance never mark tasks complete or create source clinical events. Progress remains derived from occurrence state and existing as-of queries; future rows do not enter today's due denominator. `no_tasks_due` retains its existing separate meaning.

## Maintenance and scheduler

The migration adds `public.maintain_care_plan_occurrence_horizons(after_id, batch_size)`. It selects active, versioned, non-expired plans in stable UUID order. Each call processes at most 50 plans (default 25); callers page with the returned `next_after_id` and `has_more`. The next scheduled run starts with a null cursor. Each plan's generation and source reconciliation run in their own exception subtransaction. Failures are returned with plan ID, SQLSTATE, and message while other plans continue. Repeated runs are safe.

The maintenance function accepts no patient or provider identity. Its execute privilege is revoked from `PUBLIC`, `anon`, and `authenticated`, and granted only to `service_role`. The private generator is not directly executable by browser roles. The existing plan-specific extension RPC remains responsible-doctor-authorized. Reconciliation uses the existing private source matching rules and patient lock/attribution constraints.

The repository contains no `pg_cron` migration, cron schedule, scheduled Edge Function configuration, or other established job runner. The existing Phase 4C.1 report likewise records that no scheduler is configured. Therefore automatic invocation is **not active or established as supported by the current repository configuration**. Deployment must configure a trusted daily server-side job to call the maintenance RPC with the service-role credential held only in server infrastructure. For each run, start with a null cursor, use batch size 50, continue with each returned `next_after_id` while `has_more` is true, and log/alert on returned failures. No public HTTP maintenance endpoint was added, and no service key is exposed to the browser. Deployment configuration and live invocation validation remain outstanding.

## Patient, family, and provider behavior

Patient and family read projections remain read-only and do not invoke extension. Newly materialized rows flow through existing patient/provider projections. Family access remains read-only and permission-scoped. Providers do not need to click a generation action; activation, resume, and existing version publication behavior continue to generate their bounded window. Phase 5A.2 provider relationship checks were not weakened.

## Migration and verification

Forward-only migration: `supabase/migrations/20261004110000_care_plan_rolling_occurrence_horizon.sql`. Historical migrations were not edited. The focused `familyFoundation.integration.test.js` suite replays the migration and passed **47 tests**. Coverage includes recurrence generation and idempotency, source-schedule behavior, timezone conversion, replacement-version history, bounded plan/task generation, activation/resume, paused and terminal exclusion, maintenance access restrictions, stable cursors, per-plan failure isolation, and source reconciliation for medication events, vitals, appointments, and follow-ups.

The focused suite does not establish true concurrent database sessions, a DST transition, or the maximum 50-plan paging boundary. Those behaviors are supported by the locking, uniqueness, and batch structure, but warrant deployment-level validation and additional fixtures before claiming full operational verification.

The requested broad regression command excludes `.kilo`, `bookableDoctorSeed.test.js`, `phase4DatabaseSchema.test.js`, and `phase9AppointmentManagement.test.js`. The production build passed; Vite emitted its existing large-chunk advisory (the main JavaScript bundle is 886.84 kB). `git diff --check` passed for tracked changes, and whitespace checks passed for the new migration/report files.

## Browser, deployment, limitations, and next step

No legitimate signed-in browser fixture or production Care Plan dataset was available for this backend change. No production or demo clinical records were fabricated. Browser verification is unavailable. No deployment was performed.

**Known limitation:** the database code is ready for trusted invocation, but recurring automatic invocation and operational alerting are not live until deployment infrastructure configures and monitors the service-role job. DST-boundary, true concurrent-worker, large-batch paging, and failure-isolation integration cases remain additional verification opportunities.

**Next priority:** configure and validate the trusted scheduled invocation and failure monitoring in the deployment environment before beginning a new Care Plan product phase. After that, a reasonable Phase 5C product candidate is a provider-led clinical review and renewal workflow for long-running plans, retaining explicit clinician approval and version history. This is a recommendation, not implemented scope.

## Verification results

- Focused database integration: **47 passed**.
- Broad regression: **82 test files, 1,229 tests passed**; exclusions: `.kilo`, `bookableDoctorSeed.test.js`, `phase4DatabaseSchema.test.js`, `phase9AppointmentManagement.test.js`.
- Production build: **passed**; Vite's large-chunk advisory remains (886.84 kB main bundle).
- `git diff --check`: **passed** for tracked changes and whitespace checks for new files.
- Deployment/runtime schedule: **not configured**.
- Browser verification: **unavailable; no legitimate fixture**.
