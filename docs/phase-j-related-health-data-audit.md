# Phase J related health data audit

Audit date: 2026-10-08 (Asia/Yangon). Staging project:
`xyprybspwrtthvhnumdp`. No deployment, migration, RLS alteration, new product
feature, or clinical truth write was performed. Only audit SQL and local
characterization tests were added.

## Evidence limits

Live SQL read checks used authenticated roles and server-side request identity
claims, through the administrative Management API. They verify actual database
RLS/RPC behavior, not a browser JWT session or the HTTP PostgREST transport.
Only anonymous labels, counts, authorization booleans and aggregate appointment
timestamps were returned. No names, full patient IDs, clinical text, JWTs,
passwords or keys were printed.

No signed-in browser session or Staging website URL was available. The database
and backend checks are live; UI checks use the real local React component and
read-model implementation with fixtures. Live UI sign-off remains PARTIAL.

## Live stored data and authenticated results

One family has two accepted adult accounts and two active reciprocal grants.
Both grants share appointments, records and care plans; alerts are not shared.
Four other eligible adult accounts have no family membership.

There are three stored pending appointments, all on August 23–25, 2026.
There are zero future appointments. Account 1's own query returns three;
Account 2's permitted family query returns the same three. Reverse shared
appointments correctly return zero. All six audited accounts return zero rows
for appointments outside their authorization. All four unrelated accounts
receive 42501 from the family care-plan RPC and return no family directory.

There are no care plans, follow-ups, or monitoring alerts stored on Staging.
Own summary and permitted family care-plan RPCs both return empty results
without error. This verifies empty contracts, not populated rendering for
those categories. Revoked/expired/removed access was verified with populated
local PostgreSQL fixtures, without changing live grants.

Two patient-uploaded documents are active and seven are removed. The family
viewer receives the one active document that is shared with them. An unrelated
account can read its own separate active document but does not join the family
directory. The 12 needs_review facts and one confirmed fact all reference
removed documents. Authenticated queries return zero such facts, correctly.
Those missing review counts are not a current Staging data-loss defect.

## Appointments — FAIL for complete coverage

Source: `familyHealthRepository.getCommandAppointments`, direct
`public.appointments` SELECT on id, patient_id, scheduled_start, scheduled_end,
status, created_at, updated_at. Patient filtering, deterministic pagination,
pending/confirmed upcoming exclusion rules and Yangon time display pass.
Cancelled and completed rows are excluded from upcoming care. Completion
activity uses explicit completed status and stored updated_at, with wording
that does not claim an exact completion timestamp.

Gap: the repository and read model omit `rescheduled`, although the schema's
active-slot constraints and provider relationships treat it as active. A future
rescheduled appointment disappears. No such row currently exists on Staging.
Provider/clinic fields are not selected or displayed in this overview; no
unauthorized provider/clinic details are exposed.

## Care plans — FAIL for current-version coverage

Family source: `familyHealthRepository.getFamilyCarePlans` ->
`get_family_care_plan_readout(p_group_id,p_member_id)`, with authorized,
source-masked detail and occurrence RPCs. Own source:
`list_my_care_plan_summaries`, `get_care_plan_detail`,
`get_care_plan_occurrences`. Active status filtering, current version title,
projected integer progress validation and unauthorized exclusions pass.
Completed plans do not appear active.

Gap: the projection includes historical versions/tasks/goals/occurrences, and
the overview does not filter tasks and milestones to current_version_id. A
pending occurrence from an older version can become the primary overdue action.
Past goal review dates are also omitted by the future-only goal loop.
The audit fixture reproduces the historical-task problem. No live plan exists
to validate populated live progress or tasks.

## Follow-ups — FAIL for standalone coverage

Only care-plan follow_up tasks and their projected occurrences are consumed.
There is no direct `public.follow_ups` overview read. Existing standalone
due_at/status/completed_at rows would be absent if not represented by an active
care plan. Projected overdue follow-ups correctly outrank reviews and upcoming
appointments; completed projected follow-ups use stored completed_at.
No live follow-up exists. A fixture verifies both the supported priority and
the standalone coverage gap.

## Monitoring alerts — FAIL for requested detail display

Source: `familyHealthRepository.getActiveAlerts`, direct monitoring_alerts
projection of id, alert_type, severity, status, title, message, detected_at,
created_at; patient filter and open/acknowledged/escalated filter.
RLS and local populated authorization checks pass, including unrelated,
revoked and expired denial. No live alert exists and family alert sharing is
currently off.

Gap: the overview discards title/message/severity/detected_at and emits only
“Review open care alert” for open/escalated rows. It does not show alert status
or detection time. An acknowledged alert alone yields stable, despite being
loaded by the active-alert repository.

## Document/review signals — FAIL for complete review coverage

Sources: `document_extracted_facts`, active patient-uploaded clinical_documents,
and document_extractions through `documentHealthIntelligenceService.getForPatient`;
document activity uses `getCommandDocuments` (latest 20 metadata rows).
Distinct needs_review facts are counted; actions deduplicate by source document.
Candidate values and diagnoses are excluded from the overview model, and no
candidate is promoted to clinical truth. Removed document facts are excluded.

Gaps: counts use displayable explained facts, not all authorized needs_review
facts. Missing/invalid explanations and the 50-fact read limit can undercount
reviews. There is no separate document-level pending-review contract; uploads
are activity, and extraction pending is monitoring rather than a review item.
The service checks pending/failed extraction runs only when no active facts
exist, so existing explained facts can conceal another pending extraction.
Current live zero reviews are correct because every stored fact's source was
removed.

## Recent changes — PASS within implemented scope

Actual stored created_at/updated_at/review_created_at/completed_at values drive
appointment scheduling/completion, plan updates, document uploads, fact review
readiness and projected follow-up completion. Events are newest-first, limited
to 30 days, deduplicated and exclude invalid/future timestamps. No fabricated
activity or inferred completion was found. These are record-derived activity
signals, not a complete append-only event history. Standalone follow-up
completion is absent for the coverage reason above.

## Next actions — FAIL for full declared priority

One primary action per member and one highest-priority family action are
deterministic. Overdue, today, review and 48-hour appointment ordering passes.
Source duplicates are removed. Real overdue projected follow-ups outrank lower
priority actions.

Gap: medication review (priority 6) is inserted only as a fallback when no
action exists, so a later appointment (priority 7) wins over it. No timed
medication reminder is derived from the loaded schedule. Missing standalone
follow-ups, historical-version tasks and incomplete review inputs also affect
the chosen action. Existing behavior was documented, not changed.

## Family summary — PASS within authorized input scope

peopleCount equals unique rendered cards (self included), and status counts
exactly partition them. Revoked/expired/removed members are excluded from cards
and summaries. Members without any current shared scope are excluded; this is
an authorized-card count rather than all Health Circle relationships. Limited
sharing is labeled. Next Family Action equals the highest-priority real member
action. Counts remain subject to the input coverage defects listed above.

## Tests and conclusion

170 focused tests passed across the verification runs, including 57 actual
local PostgreSQL integration tests and 11 new rendered/read-model audit tests.
Characterization tests explicitly record existing gaps; their passing does
not mean those product requirements pass. Authorization checks cover unrelated,
revoked, expired, removed and cross-family cases. Read-only contracts and
candidate-only behavior are covered.

Production build: PASS, with the existing bundle-size warning. No cross-family
leak was found. Authorization verified in live active/unrelated database checks
and local populated lifecycle tests; full browser sign-off remains pending.
Application code changes are required to meet all requested coverage. No new
migration or RLS change is required for the proven service/display defects.
Any future independent document-review workflow would need its own explicitly
defined product/data contract rather than an invented review state.
