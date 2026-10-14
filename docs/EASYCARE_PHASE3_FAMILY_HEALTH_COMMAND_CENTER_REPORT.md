# EasyCare Phase 3: Family Health Command Center

## Status

**Complete for the adult, authenticated, read-only family health scope.** The production build, Phase 3 focused tests, and current non-legacy suite pass. No deployment or hosted-browser verification was performed.

## Architecture implemented

`/family/health` is a protected React route for an active patient account aged 18 or older with a recorded date of birth. `FamilyHealthPage` owns selection, refresh, access-state rendering, and stale-data clearing. `familyHealthService` turns accepted membership and the viewer's current grant into a set of permitted section reads. `familyHealthRepository` uses the authenticated Supabase client for data reads and delegates reusable personal health queries to the Phase 1 patient dashboard repository.

The selected adult member is resolved using the caller's family group ID and the member ID returned by the family membership API. The browser does not submit an arbitrary clinical patient UUID. A narrow metadata RPC returns the clinical ID only for active adult family members in a group the caller belongs to. It does not read clinical information. Clinical queries run separately through ordinary authenticated queries and database RLS.

## Files changed

- `src/App.jsx` registers `/family/health` behind the existing protected route.
- `src/features/family/FamilyPage.jsx` adds an entry point while preserving family management.
- `src/features/family/FamilyHealthPage.jsx` implements the family selector, attention summary, read-only sections, permission/error/empty states, access refresh, and identity-keyed state.
- `src/services/familyHealthService.js` resolves membership and limits reads by live grant scopes.
- `src/services/repositories/familyHealthRepository.js` provides bounded family reads and reuses Phase 1 dashboard queries.
- `supabase/migrations/20261003100000_family_health_read_access.sql` adds the minimal member metadata RPC and three SELECT-only family policies.
- `src/features/family/FamilyHealthPage.test.jsx`, `src/services/familyHealthService.test.js`, and `src/lib/familyFoundation.integration.test.js` cover UI/service behavior and PostgreSQL-compatible RLS behavior. `src/features/family/FamilyPage.test.jsx` was adapted for its new router link.
- `src/styles/global.css` adds responsive Family Health styling.

## Routes, member selection, and navigation

- `/family/health`: adult Family Health Command Center.
- `/family`: existing membership, invitations, permissions, and access revocation experience; remains available from the command center.
- `/dashboard`: existing personal dashboard; linked from Self view.

The selector includes Self and accepted adult family members from the current family group. It does not accept patient UUIDs from URLs. Selection state is scoped to the authenticated user and patient identity, and the page remounts when that identity changes.

## Scope mapping and RLS

| Health section | Existing grant scope | RLS support and Phase 3 behavior |
|---|---|---|
| Upcoming appointments | `appointments` | Existing appointment RLS helper checks `can_access_patient(..., 'appointments')`; the new policy enables the family SELECT path for patient accounts. |
| Medications and schedules | `medications` | Existing helper checks `can_access_patient(..., 'medications')`; two SELECT policies expose medications and their schedules. |
| Active alerts | `alerts` | Existing monitoring alert policy uses `can_access_patient(..., 'alerts')`. |
| Latest vitals | `records` | Existing patient health RLS supports clinical records scope. |
| Vital trends | `records` | Same RLS as vitals; uses the bounded Phase 1 vital history read. |
| Recent care encounters, clinical document metadata, medical history | `records` | Existing records scope. Returned clinical document fields exclude storage paths; history fields exclude document URLs. |
| Lab results for Self | authenticated patient's own records | Reuses the existing personal dashboard query. |
| Lab results for another family member | `records` would be the expected conceptual scope, but current lab RLS explicitly excludes family viewers | Not requested through family service; section reports unsupported. No new lab access policy was added. |
| Payments | `payments` | Not part of this health dashboard. |
| AI Overview | none | Not invoked for family members; existing own-patient AI protections are unchanged. |

The new RPC is `SECURITY DEFINER` only to resolve family membership and the corresponding clinical identity. It calls the existing family patient and membership checks, constrains results to active adult patient accounts, and returns authorization metadata. It never selects clinical rows. Every clinical query remains an authenticated client query subject to RLS and `can_access_patient()`.

## Health behavior and reuse

Self uses the authenticated patient's identity and Phase 1 dashboard repository reads. For a selected family member, only granted and currently active scopes are queried. Section requests run independently, are bounded, and return distinct no-data, no-permission, expired/revoked, unsupported, and load-error states. A failed section does not hide successful sections.

“Who needs me today?” is a deterministic summary: active alerts take precedence, then upcoming care, then “No current attention signal” only when both relevant sections loaded successfully; otherwise it reports limited information. It does not infer risk or generate AI content.

No fake runtime family or health data was added. Initial member selection is bounded to the membership list; health reads happen for the selected member only. Reads use limits (20 medications, 10 active alerts, up to 10 rows per recent-record source then 20 combined); vital history uses the existing repository date window.

## Revocation, expiry, and mutation restrictions

The metadata RPC reports grant status, consent state, scopes, and expiry. The service skips reads for expired, revoked, inactive, or ungranted scopes, then rechecks family authorization after reads and clears data for scopes that changed or were removed during the request. RLS independently checks each database query. Membership refresh runs on focus, periodically, and at grant expiry; existing details are hidden while access is being verified. Auth identity changes remount and clear page state.

Family health is read-only. The migration adds no write policies or grants. Integration coverage verifies family appointment/medication reads and denies appointment and medication updates. No delegated appointment, medication, or record mutation was added.

## Compatibility and explicit exclusions

- Family membership alone does not grant clinical access.
- No arbitrary cross-patient access was added; unrelated patients remain inaccessible through membership resolution and RLS.
- Revoked, expired, and consent-inactive grants lose access.
- Minor registration remains supported; only Family Health and family management use the existing adult eligibility rule.
- No dependent, guardian, or managed-profile functionality was added.
- AI Overview own-patient protections and family foundation behaviors were not intentionally changed. Existing Security Repairs 1–15 were left in historical migrations.
- No deployment was performed.

## Tests and build

Phase 3 focused command:

```text
npm test -- src/lib/familyFoundation.integration.test.js src/services/familyHealthService.test.js src/features/family/FamilyHealthPage.test.jsx src/features/family/familyEligibility.test.js src/features/family/FamilyPage.test.jsx
```

Result: **5 test files passed, 60 tests passed.** The integration tests replay the historical migration chain and the new migration in PostgreSQL-compatible PGlite, checking scope-specific reads, no membership-only access, unrelated patient denial, no implicit records-to-medications access, revocation, and read-only behavior.

Production build: **`npm run build` passed.** Vite reported the existing large main JavaScript chunk advisory (827.47 kB minified); build completed successfully.

Current non-legacy full-suite result: **74 test files passed, 1,065 tests passed.** This run excludes `.kilo` worktree duplicates and three pre-existing legacy suites (`bookableDoctorSeed`, `phase4DatabaseSchema`, `phase9AppointmentManagement`) that are documented as stale in the project handoff.

## Known limitations and verification

- Family lab viewing is unsupported by current database policies and remains hidden for other members; the personal Self lab view remains available.
- No hosted Supabase instance or browser session was used to verify deployment configuration or live data. The cross-patient path is validated by source-level review, unit/component tests, and PostgreSQL-compatible RLS integration tests.
- No new indexes were required; reads use patient IDs and existing bounded dashboard patterns.

## Readiness for next phase

Phase 3 is complete within this scope. Stop here; dependent architecture, Smart Care Plan, Health Story, I Need Care, and family AI remain out of scope.

**Can Nandar sign in to her own account, select Mother in Family Health, and see only the real health information Mother explicitly authorized? YES, for sections currently supported by RLS and only while the grant remains active.** Family lab results are the documented unsupported section.
