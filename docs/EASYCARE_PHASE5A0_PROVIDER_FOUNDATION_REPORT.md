# EasyCare Phase 5A.0 Provider Identity and Workspace Foundation

## 1. Status

**COMPLETE for the provider identity, session, workspace, and relationship-scoped patient-selection foundation.** Phase 5A Care Plan authoring remains intentionally disabled.

## 2. Previous blocker

The Phase 5A audit found that authentication only resolved active patients, with no provider route shell or relationship-scoped patient list. This phase adds the minimum server-resolved provider identity and workspace needed to address that blocker.

## 3. Identity architecture and patient preservation

- Patient accounts continue to resolve through the existing `patients.auth_user_id` mapping and patient phone/password sign-in.
- Provider accounts resolve through `auth.users → profiles → providers`. The UI creates no patient row for providers.
- Provider authority is resolved by an authenticated RPC using `auth.uid()`. The browser sends neither provider ID nor role.
- Provider eligibility follows schema rules: active `profiles.status`, profile role mapped to provider type, verified provider record, and `clinical_identity_is_current()`. There is no separate active-status column on `providers`; active profile plus verified provider is the established rule. A suspended, pending, or rejected provider is denied.
- The profile role enum is single-valued, while the patient and provider identity records are separate. Where the existing rows resolve to both identities, the app resolves each independently and offers a workspace choice. The persisted workspace preference is UX only and is checked against freshly resolved server identities at session restoration.
- Provider sign-in reuses Supabase Auth. It accepts the existing phone-derived internal email convention or an email/password credential; there is no second auth store or provider self-registration.
- Session restoration re-resolves both identities after refresh. Logout clears the workspace preference and in-memory patient/provider state. Switching credentials replaces session state, and provider-only identities cannot enter patient routes.

## 4. Routes, shell, and overview

- Added `/provider/login`, `/provider`, `/provider/patients`, and `/provider/care-plans`.
- Patient routes require a resolved patient identity. Provider routes require a resolved provider identity. Authenticated provider-only users are redirected from patient routes to `/provider`; patient-only users are sent from provider routes to provider sign-in.
- The minimal provider shell has Overview, Patients, Care Plans, and logout navigation.
- Overview displays the provider’s server-resolved name and count of rows returned by the safe patient RPC. It does not invent appointment, revenue, or clinical metrics.
- The Care Plans route is a placeholder. It contains no plan creation, goal, task, or activation controls.

## 5. Provider patient-selector RPC and UI

Added `public.list_my_clinical_patients()` in `supabase/migrations/20261003150000_provider_workspace_foundation.sql`.

- It accepts no provider or patient ID arguments and derives the provider through `get_my_provider_identity()` using `auth.uid()`.
- It returns only active patient rows for the existing provider/patient relationship semantics: any matching provider appointment, or an assigned/accepted care assignment. The existing `can_access_patient(patient, 'clinical')` check is also applied; these semantics were not broadened. The appointment helper currently counts appointments regardless of appointment status.
- The projection is limited to clinical patient ID, display name, and relationship kind. It does not return contact, address, family, payment, or medical-record data.
- Both RPCs use an empty `search_path`, are `SECURITY DEFINER`, revoke execution from `PUBLIC` and `anon`, and grant execution only to `authenticated`. Patient-table RLS was not broadened.
- The Patients page shows only RPC results, supports selection of an authorized row, and has honest loading/error/empty states. It has no global search, patient UUID input, or patient mutation.
- Future clinical RPCs still need to enforce authorization themselves; possession of a displayed patient ID grants no authority.

## 6. Care Plan and existing feature boundaries

- No Care Plan authoring or lifecycle action was added.
- `/my-care-plan` remains the patient Clinical Care Plan view.
- Phase 4D remains family read-only.
- `/care-plan` remains the Home Care request flow.
- Phase 4C.1 automatic reconciliation and Repairs 1–15 were not modified by this phase.
- Create Account and the patient registration/Edge Function flow were not changed. Patient phone normalization, session, account logout, and minor registration remain supported by the existing code.
- No dependent/guardian functionality or AI provider authoring was added.

## 7. Tests and migration replay

- Provider UI, authentication, route, clean migration replay, and patient identity focused run: **8 files passed, 55 tests passed**. The database test replays all migrations preceding this migration and applies the new migration against PGlite/PostgreSQL semantics.
- Established non-legacy repository run, excluding `.kilo/**` duplicates and the three documented obsolete suites (`bookableDoctorSeed`, `phase4DatabaseSchema`, `phase9AppointmentManagement`): **81 files passed, 1,135 tests passed**. This includes patient registration identity and minor-registration coverage, Phase 4B/4B.1, Phase 4C/4C.1, Phase 4D, and Repairs 1–15.
- Unfiltered `npm test`, run before the final anonymous-route test was added: **114 files passed, 8 failed; 1,333 tests passed, 2 failed**. Failures came from duplicated `.kilo/worktrees` copies and the documented obsolete migration-reference suites; those suites expect migration files removed from the current migration set. The established non-legacy run after all changes passed.
- Production build: **passed**. Vite reports the existing large JavaScript chunk warning (855.17 kB minified).
- Browser verification: **not performed**. No real safe provider auth fixture/session is configured in this workspace; no fake production account or clinical data was created.
- Deployment: **none**.

## 8. Known limitations and provisioning

- Provider accounts must already exist as legitimate Auth users linked to active profiles and verified provider rows. The UI does not provision accounts or permit self-registration. Phone sign-in requires the provider Auth email to follow EasyCare’s existing phone-derived internal-email convention; direct email/password sign-in is also supported.
- The database migration must be applied to an environment before the new provider RPCs are available there.
- Existing relationship semantics treat any provider appointment as a clinical relationship, including historical or cancelled appointments. This phase intentionally matches that existing backend rule; the patient list is not a new authorization source.
- Browser behavior with a real provider credential remains unverified.

## 9. Phase 5A readiness

**YES — the local provider identity, route, and patient-selection foundation is sufficient to resume Phase 5A authoring work.** Existing Care Plan authoring RPCs remain the authority and must continue to revalidate doctor eligibility and patient relationship. No authoring is enabled by this phase.
