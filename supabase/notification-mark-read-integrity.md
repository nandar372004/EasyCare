# Security Repair 7 — Notification mark-read authorization

## Root cause and inspected semantics

`notifications_mark_read` permitted UPDATE of any owned row, checking only
recipient_profile_id on the old and new row. With UPDATE grants, this let recipients
change body, delivery status and sent_at. RLS ownership did not restrict fields.

The actual eleven columns are id, recipient_profile_id, patient_id, type, channel,
title, body, status, scheduled_at, sent_at and read_at. There is no created_at,
is_read, generic metadata or provider-attribution column. Status combines delivery
and read states: queued, sent, delivered, failed, read. read_at is nullable.

All migrations/policies and repository, frontend and Edge notification references
were inspected. There was no safe mark-read RPC, notification-specific trigger,
implemented notification caller, mark-unread feature or delivery worker. The header
explicitly labels notifications unavailable. The existing mark-read policy and
read fields establish the intended operation, but did not constrain its payload.
No additional recipient-editable fields or intentional unread operation were found.
Service-role direct delivery updates remain an existing database capability;
this is not evidence of an implemented external notification provider.

## Enforcement

Forward migration: `migrations/20261002110000_notification_mark_read_integrity.sql`.

The new `mark_notification_read(target_notification_id uuid)` RPC accepts only an
ID and updates a row only when its recipient equals auth.uid(). It sets status to
the fixed value `read` and read_at to the first server statement timestamp using
COALESCE. Repetition preserves the original read timestamp. It cannot clear read
state, choose timestamps, change recipient, content or resource identity, or assert
arbitrary delivery status. Missing, foreign and unauthenticated identities receive
the same `42501` unavailable error. The returned row belongs to the caller.

This narrow RPC is preferred to a trigger that distinguishes clients from privileged
delivery actors: there is no current application caller requiring arbitrary direct
UPDATE compatibility. The RPC is SECURITY DEFINER with empty search_path and fully
qualified table/function references. PUBLIC/anon execution is revoked; authenticated
execution is granted. No extra helper path or mark-unread RPC is added.

`notifications_mark_read` is removed. Table-level and all existing column-level
UPDATE grants to PUBLIC, anon and authenticated are revoked. Removing the policy
also prevents an accidental UPDATE regrant from restoring mutation through RLS.
The SELECT ownership policy remains unchanged; no INSERT/DELETE policy is added.
Service-role grants are not altered; trusted service delivery INSERT/UPDATE works.
Database owners and BYPASSRLS service processes remain trusted administrative paths.

System-controlled fields remain id, recipient_profile_id, patient_id, type, channel,
title, body, scheduled_at and sent_at. Status may change client-side only to the
fixed read value through the RPC. read_at may change only from NULL to a server
timestamp through this operation. No historical notification is rewritten or
normalized by migration. Repeating the RPC can restore status='read' if a trusted
delivery process subsequently changed status, but preserves the first read_at.

No application, Edge Function, old migration, existing helper or Repair 1–6 file was
changed. A future actual caller should use:

```js
client.rpc('mark_notification_read', { target_notification_id: notificationId })
```

## Read-only audit

`scripts/notification_security_validation.sql` lists notification policies, table
and column grants, triggers and relevant function definitions/security settings.
It flags inconsistent read-status/timestamp combinations, future read timestamps
and read-before-sent values for review. These are candidates, not proof of malicious
activity; no rows are altered. The normal local notification fixtures were preserved
byte-for-byte by the migration. No hosted dataset was inspected.

## Tests and independent exploit

`src/lib/notificationMarkReadIntegrity.integration.test.js`: **36 passed**.

The PostgreSQL/PGlite suite covers own reads, server-time mark-read, safe repetition,
each existing protected field, multi-column changes combined with read_at, ownership
changes, clearing read state, RPC parameter injection, foreign/anonymous/missing
identity denial, column-grant revocation, accidental UPDATE regrant, original-row
preservation and unchanged unrelated policies. It also checks that service delivery
INSERT/UPDATE remains functional. Nonexistent created_at/metadata fields are identified
as absent, rather than added merely to test them.

Independent exploit retest outside the suite: a recipient's combined body/status/
sent_at UPDATE was **ACCEPTED before migration**, then **denied with 42501 after**.
Legitimate mark-read succeeded afterward, preserving body and sent_at. All exploit
attempts ran in disposable local transactions; no hosted notification was changed.

Widest non-legacy regression: **790 passed, 0 failed across 59 suites**.

| Repair | Passing tests |
|---|---:|
| 1 | 16 |
| 2 | 32 |
| 3 | 43 |
| 4 | 33 database + 1 repository |
| 5 | 19 |
| 6 | 28 |
| 7 | 36 |

Three obsolete suites requiring removed migrations were excluded, not counted as
passing or repaired. Earlier repair suites retain their phase-specific cutoffs;
the new suite exercises the migration chain through Repair 7. Managed Auth/Storage
infrastructure is represented locally; hosted JWT/grants and concurrent server
delivery sessions were not exercised.

## Files and deployment considerations

Four new files:

- `supabase/migrations/20261002110000_notification_mark_read_integrity.sql`
- `supabase/scripts/notification_security_validation.sql`
- `src/lib/notificationMarkReadIntegrity.integration.test.js`
- `supabase/notification-mark-read-integrity.md`

Nothing was deployed. Before deployment, review actual grants and any hosted-only
notification callers; direct recipient UPDATE must migrate to the RPC. Verify RPC
visibility and trusted delivery permissions in staging. The mixed delivery/read
status column remains; this repair does not redesign notification lifecycle or add
workers. Historical inconsistent rows are not automatically corrected. Future
columns are not writable through this fixed RPC; future permissive UPDATE policies
or additional definer functions require separate security review.

Removing the RPC restriction or restoring the old broad UPDATE policy would reopen
the vulnerability; rollback requires a reviewed forward migration. No unrelated
feature work was performed. Stopped after Repair 7.
