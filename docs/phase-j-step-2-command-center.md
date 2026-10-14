# Phase J Step 2 — Real signals and interaction polish

The existing command center read model now adds family status counts, one highest
priority family action, projected daily care-plan progress, recent appointment
completion status, patient-upload document activity, and compact member details.
It makes no clinical writes, AI calls, database changes or authorization changes.

## Operational priorities

1. Stored pending actions whose scheduled time has passed.
2. Actions scheduled for today in Asia/Yangon.
3. Unresolved document reviews, pending appointment review, and existing open alerts.
4. Appointments within 48 hours.
5. Active care-plan tasks or plan viewing.
6. Existing medication care-plan tasks or medication schedule viewing.
7. Other upcoming care, including goal review milestones.
8. No action needed.

Candidates contribute review state only, never values, diagnoses or inferred
severity. Confirmed extraction review state is not clinical truth. A card's
attention reason refers to an attention-required item even when a different
today action takes precedence as the primary action.

Source identifiers deduplicate direct appointments and linked plan tasks;
follow-up IDs deduplicate the same follow-up across plan tasks. Distinct pending
fact IDs remain counted, while facts from one source document share a single
review action. Each member has exactly one primary action, including an honest
no-action fallback. Missing safe destinations produce information without links.

Upcoming care uses Today, Tomorrow, This week (Monday through Sunday), and Later,
based on Yangon calendar dates. Recent activity uses only stored creation,
update, and completion timestamps, sorted newest first. Completed appointments
say “is marked completed”; their record update time is not presented as an exact
consultation completion time. No timestamp is invented when one is missing.

## Query reduction and privacy

The previous overview performed unnecessary vital, trend, lab and encounter
queries and repeated directory RPCs for every member. The overview now loads
only appointments, active medications, alerts, document reviews, document upload
metadata, and secure care-plan projections.

`loadCommandCenterGroup` performs exactly two directory reads per group: one
before signal reads and one after all group signal reads settle. Revoked,
expired, changed and removed memberships mask or discard loaded results.
No directory/authorization cache persists across requests. Own-plan reads and
group reads run concurrently, and each own plan's detail and occurrences are
read concurrently. Completed appointment history is limited to the last 30 days.

Scoped per-member clinical reads and care-plan projection RPCs remain necessary
under existing security boundaries; they are not replaced with a permissive RPC.
The detailed family page retains its previous read behavior. UI account changes,
focus refresh, 15-second revalidation and exact grant-expiry clearing remain.

## UI and verification

Member cards expand using native buttons with meaningful labels, aria-expanded,
and aria-controls. Details contain current status, primary action, upcoming care,
authorized plan summaries, pending document reviews, and recent activity.
Status chips always contain text; skeletons reserve space for summary, cards and
sections. Empty and error states remain honest.

Browser checks used an isolated temporary fixture outside the normal application
routes. Desktop 1280×900, tablet 768×1024, and mobile 390×844 had no horizontal
overflow. Mobile used one column, tablet two member columns, desktop three.
Keyboard Enter expanded the member detail and Space collapsed it in UI tests.
The temporary fixture source is removed after validation; the screenshot is
explicitly a test preview, not stored production family data.

Focused tests cover summary counts, priority ordering, source deduplication,
time grouping, newest-first changes, progress, keyboard details, blocked data,
identity isolation, read-only intents, and query counts. The existing local
PostgreSQL family RLS suite is also run. Hosted account/device validation remains
the recommended next step. No deployment or Phase K AI Guardian work is performed.

Final results: 107 tests passed across seven suites; production build passed with
the existing large-bundle advisory. `git diff --check` passed. Browser contrast
checks found secondary links below the 4.5:1 text threshold, so the command center
uses a darker scoped link color; status text and secondary links exceed 4.5:1.
