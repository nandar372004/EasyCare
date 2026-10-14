# Phase J follow-up read privilege repair

Prepared 2026-10-08. Target: EasyCare Staging `xyprybspwrtthvhnumdp`.
Only read-only catalog inspection was executed remotely. No repair, migration
history update, deployment, or clinical write was executed.

The repository reads exactly id, patient_id, follow_up_type, due_at, status,
completed_at. Its patient/status filters and due_at/id ordering require no
additional columns. Column-level SELECT is sufficient.

Live inspection confirmed RLS enabled, authenticated BYPASSRLS false, and no
SELECT privilege on any follow-up column. `follow_ups_read` enforces
`can_access_patient(patient_id,'clinical')`. Staging also has its existing
assignee/admin ALL policy. The local historical migration chain instead has
the hardened staff read policy. Both existing authorized contracts are
recognized and preserved; neither is created or changed by this repair.

One new forward-only migration:
`20261008092000_phase_j_follow_up_read_privileges.sql`.
It grants SELECT only on the six columns, after checking RLS, the authenticated
role, table ownership, the exact clinical read policy and permitted staff/
assignee policy expressions. Disabled RLS, bypass/superuser/owner roles,
missing or changed clinical policies, and unexpected permissive reads abort
the transaction. SELECT cannot bypass existing RLS. No clinical instructions,
encounter IDs, assignee IDs, table-wide privileges, writes or data changes are
introduced. Already-applied migration files remain untouched.

123 focused tests passed across six files, including 61 local PostgreSQL
integration tests. The populated follow-up test first removes table and column
SELECT to reproduce Staging 42501, then replays this migration twice and verifies
the owner and permitted records-scope viewer can read, while unrelated,
expired, revoked and removed-member users see no rows. Policies, clinical rows,
INSERT/UPDATE/DELETE privileges remain identical; unneeded columns remain
unreadable. Both the hardened local policy and inspected legacy Staging policy
are covered, along with unsafe-policy/disabled-RLS refusal. Read-model tests
cover overdue/upcoming/completed follow-ups, real completion timestamps,
care-plan duplicate suppression, and source masking/secret-key rejection.

Prepared operator command from the repository root (not executed):

```powershell
& .\scripts\apply-phase-j-follow-up-read-privileges.ps1
```

The script checks the linked project is Staging, applies only this new SQL file
against the explicit Staging reference, and records only its migration version
after success. If version recording fails after the grant commits, it reports
that state. No general migration push is used. A populated live retest remains
pending operator application.
