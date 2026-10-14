# EasyCare Phase 5B.1 — Runtime Automation and Operational Verification

## Status

**PARTIAL — scheduler code/configuration is ready; runtime scheduling and externally configured failure notifications are not active.** No GitHub or Supabase settings were changed and no production deployment was performed.

## Phase 5B runtime gap and architecture audit

Phase 5B added the bounded, timezone-aware, idempotent SQL maintenance primitive and service-role-only RPC. The repository has no Postgres `pg_cron`/`pg_net` schedule, scheduled Supabase Edge Function, Vercel configuration, CI workflow, or alerting integration. Supabase configuration contains only Edge Function JWT settings. Git remote is a GitHub repository, and the project already uses Node scripts for trusted server-side operations.

**Selected mechanism:** GitHub Actions scheduled workflow runs the repository's Node maintenance runner and calls the existing Supabase REST RPC directly. This uses the project's existing GitHub host and Supabase REST interface, adds no third-party scheduler, and creates no public maintenance endpoint. GitHub scheduled workflows use UTC and run the latest commit on the default branch; the configured time is 18:17 UTC daily (00:17 Asia/Yangon). GitHub may delay scheduled jobs during high load. The workflow requires Actions enabled, the workflow merged to the default branch, and its environment values configured. [GitHub workflow schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

The scheduler timezone only controls when the server job starts. Occurrence dates and local due times remain determined by each plan/task timezone in PostgreSQL. The repository's GitHub visibility and Actions enablement could not be inspected from the local checkout. If GitHub treats the repository as public, scheduled workflows can be auto-disabled after 60 days without repository activity, so operations must monitor the workflow's enabled state. No AI, UI, clinical completion, recurrence, progress, source matching, lifecycle, versioning, or provider authorization logic changed.

## Runner, paging, and operational controls

`supabase/scripts/run-care-plan-maintenance.mjs` uses the built-in Node `fetch` API to call only `maintain_care_plan_occurrence_horizons`. It sends `p_after_id` from the preceding database response and fixed `p_batch_size: 50`; it accepts no patient, provider, or plan identity. It validates each response and requires a valid advancing cursor whenever `has_more` is true.

The runner stops after **500 pages / 25,000 plans** in one run. Reaching the cap logs the cursor and summary, then exits non-successfully; it does not silently discard `has_more`. The workflow has a 30-minute job limit. No production fixtures were created. The isolated database suite verifies a 51-plan population as one 50-plan page and one final plan; runner tests also cover a page under 50 and a full 50-plan page.

The workflow uses GitHub's `care-plan-maintenance` environment, read-only `GITHUB_TOKEN` permissions, a concurrency group, and pinned checkout/setup-node action revisions. The job does not cancel an in-progress run. PostgreSQL remains the concurrency authority: plan-row locks, unique occurrence keys, and existing patient/source reconciliation locks make overlapping requests safe. GitHub Actions concurrency reduces duplicate jobs but is not relied on for database correctness.

## Failure monitoring and retries

Every page logs structured counts and failures. Logs include plan UUID and SQLSTATE, and omit the database error message to limit PHI exposure. The runner continues through later pages after per-plan failures, then exits with a failed status if any plan failed. Transport, HTTP, malformed-response, cursor, and page-cap failures also exit non-successfully. A later daily run starts at a null cursor and safely retries through idempotent SQL generation.

No alerting provider is configured. GitHub Actions records run logs and a failed workflow status; notification delivery depends on each repository user's GitHub notification settings. Production alert routing remains deployment configuration. GitHub's own documentation says workflow secrets are supplied only where explicitly referenced; repository/environment access still needs to be tightly controlled. [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), [secure use](https://docs.github.com/en/actions/reference/security/secure-use).

## Secrets and browser isolation

Configure the GitHub environment named `care-plan-maintenance` with:

- Environment variable `SUPABASE_URL` set to the project's Supabase URL.
- Environment secret `SUPABASE_SERVICE_ROLE_KEY` set to the service-role key.
- Environment deployment-branch policy limited to the default branch; restrict write access to trusted maintainers.

Only the maintenance job receives the service key. The Node runner sends it to the Supabase REST RPC over HTTPS; non-HTTPS URLs are rejected except loopback development hosts. It never prints credentials or raw database failure messages. No `VITE_` service-role variable, browser RPC, route/button, public HTTP endpoint, or service-key reference was added to frontend source. Browser clients retain the publishable/anonymous key. Existing RPC grants still deny `PUBLIC`, `anon`, and `authenticated` and grant only `service_role`.

## Additional Phase 5B verification

- **DST:** the PostgreSQL-compatible integration test generates 08:00 `America/New_York` daily occurrences on October 31, November 1, and November 2, 2026. It verifies all persisted local times stay at 08:00 and the UTC instants straddle the fall-back transition by 25 hours. Asia/Yangon recurrence coverage remains present. The DST fixture is time-windowed because the generator only materializes its next 30 days.
- **Concurrency:** 10 overlapping extension requests are submitted with `Promise.all` and duplicate occurrence keys are checked. PGlite serializes statements through one database connection, so this is not true PostgreSQL worker contention. True multi-session scheduler overlap still requires hosted staging validation; row locks and uniqueness remain the database safety controls.
- **Paging:** 51 isolated active plans produce 50 then 1, stable UUID cursors, and final `has_more=false`. Runner tests cover fewer than 50, exactly 50, multiple pages, the final page, cursor non-advancement, and the defensive page cap.
- **Runner:** tests cover single/multi-page completion, per-plan failure with continued paging, sanitized failure logs, page-cap failure, transient HTTP failure, malformed responses, cursor validation, HTTPS enforcement, fixed batch size/no identity arguments, and browser/workflow secret boundaries.

## Preserved boundaries

- Active plans remain eligible; paused and terminal plans remain excluded; resume uses bounded generation.
- The current published version remains authoritative; history is preserved.
- No completion or source event is fabricated; source truth and progress semantics are unchanged.
- Phase 5A.2 relationship authorization, provider authoring, `/my-care-plan`, and Phase 4D read-only family access are unchanged.
- `/care-plan` remains Home Care. Patient/provider authentication, account switching, and minor registration remain intact.
- No AI authority, dependent model, Phase 5C product work, or fake production clinical data was added.
- Repairs 1–15 and existing registration/authentication behavior were not edited by this phase.

## Verification and exclusions

Focused verification: `carePlanMaintenanceRunner.test.js` passed **11 tests** and `familyFoundation.integration.test.js` passed **50 tests** with the Phase 5B migration replayed. Regression follows the established repository command and excludes `.kilo/**`, `bookableDoctorSeed.test.js`, `phase4DatabaseSchema.test.js`, and `phase9AppointmentManagement.test.js`.

Browser verification was not needed for this server-side change; source and built assets were checked for maintenance controls and service-role credentials. No legitimate clinical browser fixture was available. No production deployment was performed.

## Runtime configuration and closure

**Code/config ready:** workflow, runner, tests, and environment setup requirements are prepared in the repository. **Runtime scheduler not activated:** these local files do not run until the workflow is present on the default branch, GitHub Actions is enabled, the named environment and values exist, and the preceding Phase 5B database migration is deployed. Repository/environment access and notification settings cannot be established from the local workspace.

**Phase 5B code: COMPLETE. Runtime automation: NOT ACTIVE.** Phase 5B.1 remains partial until a safe staging invocation and then deployment configuration are verified. A reasonable next product phase after runtime validation is provider-led review and renewal of long-running plans; it is not implemented here.

## Results

- Focused runner and rolling-horizon tests: **61 passed across 2 files** (11 runner, 50 database/family).
- Full established regression: **83 files, 1,243 tests passed**; exclusions: `.kilo/**`, `bookableDoctorSeed.test.js`, `phase4DatabaseSchema.test.js`, and `phase9AppointmentManagement.test.js`.
- Production build: **passed**; Vite reports the main JavaScript bundle at 886.84 kB, above its 500 kB advisory threshold.
- `git diff --check`: **passed** for tracked changes; all changed/new task files also passed trailing-whitespace checks.
- Browser bundle scan: **0 matches** for the maintenance RPC or `SUPABASE_SERVICE_ROLE_KEY`.
- Workflow YAML: reviewed; no YAML parser/actionlint is installed in the workspace.
- Runtime invocation and alert delivery: **not performed**.
- Staging/production invocation: not performed.
- Runtime workflow activation: not performed.
