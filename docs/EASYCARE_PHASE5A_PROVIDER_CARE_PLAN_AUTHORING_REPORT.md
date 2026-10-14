# EasyCare Phase 5A Provider Care Plan Authoring Audit

## Status

**BLOCKED — implementation stopped at the provider authentication boundary.** The application has no usable provider sign-in/session flow or provider route shell. Adding the authoring UI now would require changing the patient-only authentication boundary or inventing a provider workflow, both explicitly excluded by the Phase 5A brief.

## Provider infrastructure audit

- **Provider records:** `public.providers` links one provider row to a `profiles` row with `profile_id`; provider type and credential verification are represented in the database. Clinical eligibility also checks active profile status and current provider verification.
- **Provider authentication:** **No provider login flow exists in the app.** `AuthContext` restores sessions only by calling `loadAuthorizedPatient`; that function queries `patients.auth_user_id` and returns no identity for accounts without an active patient row. `signInPatient` uses the same patient resolution and signs out when it fails. The login form collects a phone and password and calls this patient-only flow. The brief forbids converting patient authentication into provider registration or casually redesigning it.
- **Provider route/shell:** **None found.** `App.jsx` has a patient `ProtectedRoute` and `AppShell`; routes for `/doctors` are the patient-facing doctor directory and booking flow. There is no provider dashboard or `/provider/*` shell.
- **Safe provider-patient selection:** **None found.** There is no provider patient-list/search RPC or UI selector. The existing `can_access_patient(..., 'clinical')` helper supplies server-side authorization checks, but it is not a constrained patient-selection projection and cannot support the requested safe UI by itself.
- **Relationship semantics:** Existing provider access is based on an appointment for the patient/provider or an assigned/accepted care assignment. The care-plan doctor assertion checks current clinical identity, the doctor role, a verified doctor provider row bound to `auth.uid()`, and `can_access_patient(patient, 'clinical')`. Draft creation applies this assertion server-side; a supplied source encounter must also belong to the same patient and provider.

## Existing Care Plan contracts

The Phase 4B and 4B.1 reports and migrations were read. Existing authenticated RPCs include draft creation, goal/task additions, version creation/approval, lifecycle transitions, occurrence extension/reconciliation, and patient-facing reads. Authoring RPCs derive the actor from `auth.uid()` and enforce doctor/relationship eligibility. The repository wraps these RPCs, but it exposes no provider-specific patient selector or provider-scoped plan-list contract. The existing plan summary RPC is a cross-role clinical read projection; it is not a provider authoring portal or safe selector.

The backend has plan/task source fields and database validation for source linkage, recurrence, immutability, and lifecycle. No Phase 5A UI was added, so no provider source selectors, review/activation flow, version editor, or lifecycle controls were created.

## Scope boundaries and security

No code, migrations, or tests were changed. Patient sign-in, Create Account, minor registration, `/my-care-plan`, Phase 4D family read-only access, and `/care-plan` Home Care remain untouched. No actor identity, patient identity, or provider authority was added in the browser. No fake clinical data was created and nothing was deployed.

Existing backend protections remain the authoritative boundary: doctor-only authoring, provider identity resolved from `auth.uid()`, relationship checks independent of a patient identifier, immutable published versions, and backend lifecycle validation. Since no provider workflow was implemented, this audit makes no claim that Phase 5A is safely usable.

## Verification

- Read all six requested Phase 4A–4D implementation reports, app routing/authentication, Care Plan service/repository, and relevant identity/access/Care Plan migrations.
- Phase 5A focused tests and regression suite: **not run**; implementation was stopped at the required blocker.
- Production build: **not run**; no application code changed.
- Browser verification: **not performed**; there is no provider login/session fixture or provider portal.
- Deployment: **none**.

## Exact blocker and next phase

The existing app rejects an authenticated provider session unless that same auth user resolves to an active `patients` row. There is no provider-specific login/session resolution or role-aware provider shell, and there is no safe provider-patient list contract. Phase 5A cannot be safely exposed until the provider authentication/session foundation and minimal relationship-scoped patient read contract are intentionally designed and implemented without changing patient authentication behavior. The next phase should establish and audit that provider identity/session and safe patient-selection foundation before returning to Phase 5A authoring UI.

**Safe to use Phase 5A provider authoring: NO.**
