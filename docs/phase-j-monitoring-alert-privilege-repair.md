# Phase J monitoring alert privilege repair

2026-10-08: SELECT-only inspection of Staging `xyprybspwrtthvhnumdp`
confirmed monitoring_alerts RLS enabled, authenticated BYPASSRLS false, and
no authenticated SELECT privilege on any column. The earlier repair restored
metadata but did not restore this missing privilege.

The existing permissive `alerts_read` policy is exactly
`can_access_patient(patient_id,'alerts')`, addressed to authenticated.
Its live helper authorizes patient ownership or existing clinical relationships
and, for family viewers, requires explicit `can_receive_alerts`, active status,
no revocation, unexpired access, valid consent, and applicable group membership.
The existing INSERT and UPDATE policies remain unchanged. SELECT privileges
permit the query to execute; they do not bypass RLS.

New migration: `20261008091000_phase_j_monitoring_alert_read_privileges.sql`.
It grants column-level SELECT on id, patient_id, alert_type, severity, status,
title, message, detected_at, created_at. patient_id is required for the WHERE
filter. No table-wide SELECT, provenance/reviewer access, write privilege,
policy change, function change, or clinical data write is introduced.
The migration refuses disabled RLS, an authenticated bypass role, an altered
alerts_read expression, or additional applicable permissive SELECT policies.
Already-applied migration files remain untouched.

69 tests passed in three files, including 57 local PostgreSQL integration tests.
The new cases explicitly remove table and column SELECT first (the historical
fixture defaults otherwise grant table access), reproduce 42501, replay the
repair twice, verify narrow privileges and unchanged clinical rows/policies/
authorization helper/write privileges, and test owners, permitted sharing,
missing/wrong scope, unrelated patients, other families, revoked/expired access,
and refusal of unsafe RLS. Repository projection tests and browser secret-key
rejection tests passed. Live post-apply acceptance was not performed.

Prepared operator command from the repository root; not executed:

```powershell
& .\scripts\apply-phase-j-alert-read-privileges.ps1
```

This validates the Staging link, applies only this migration, then records only
its version in migration history. If history recording fails after the grant
commits, the script reports that state. No general migration push is used.
