# Phase J application/read-model defect repair

2026-10-08. No migration was created or edited, no RLS was changed, and no
deployment or clinical truth write was performed.

## Application changes

- Appointments now include rescheduled in the authorized read and upcoming
  model. Cancelled/completed remain excluded from upcoming care; ordering and
  Yangon dates remain unchanged.
- Care-plan tasks, goals and occurrences match current_version_id before
  becoming actions/milestones. Current version summaries and projected
  progress/completion calculations remain unchanged. Source masking remains
  the responsibility of the existing authorized RPCs.
- Standalone follow-ups use the existing records/clinical scope and direct RLS
  SELECT. The repository reads only id, patient_id, follow_up_type, due_at,
  status, completed_at, paginated deterministically. Overdue, upcoming and real
  completion activity are derived without writes. Source IDs deduplicate linked
  plan follow-ups and standalone records.
- Alerts retain title, a 240-character message, severity, status and detected
  time. Expanded care details show those fields. Open/escalated alerts remain
  unresolved priority-three actions. Acknowledged alerts are explicitly
  informational and keep a member monitoring, without an attention action.
- Overview review signals scan lightweight needs_review metadata independently
  of the 50-row explanation display query. Only currently authorized, active,
  patient-uploaded source documents count. Unexplained/invalid explanations
  still count and have a source-review action. Malformed explanations no longer
  crash the display projection. Candidate values are never clinical truth.
- Pending/failed extraction runs are scanned independently of existing facts
  and filtered through active sources. Removed-source runs do not signal work.
- A separate document-level review state is NOT DEFINED. Only existing
  extracted-fact review states are used; no workflow was invented.
- Medication schedule review is a real priority-six action in the same sorted
  comparison as other actions. No timed reminder/completion is inferred.
- Stored recent activity timestamps, one primary action per member, and exact
  authorized-card summary counts remain covered by tests.

## Confirmed Staging blocker

A SELECT-only live catalog query confirmed:
`has_column_privilege('authenticated','public.follow_ups','id','SELECT') = false`.
The existing `follow_ups_read` policy requires
`can_access_patient(patient_id,'clinical')`; there is no permitted patient RPC
available to replace this read. Changing application code cannot create a
database privilege. No service-role fallback or RLS bypass was added.

The service reports this specific 42501 as unsupported instead of breaking
the complete overview. The expanded member detail says standalone follow-up
data is unavailable with current read permissions, and the card is labeled as
limited information. Revoked/expired records scopes remain blocked and masked,
not relabeled as available.

Full live Phase J follow-up retest remains blocked until a separately authorized
forward-only privilege repair is prepared/applied. None was created in this
application-only task. Other repaired paths can be retested independently.

## Verification

179 focused tests passed across the verification runs (12 files), including
58 local PostgreSQL integration tests and the regression cases for rescheduled
appointments, historical task/goal exclusion, current summaries/progress,
standalone overdue/upcoming/completed follow-ups, duplicate suppression,
alert metadata/informational acknowledgements, 501 unexplained review facts,
invalid explanations, removed sources, existing-fact extraction signals,
medication priority, summary counts, unrelated/revoked/expired/removed denial,
source masking and browser secret-key rejection.

Production build PASS (existing bundle-size warning). Git diff check PASS.
No automatic deployment or Phase K work occurred.
