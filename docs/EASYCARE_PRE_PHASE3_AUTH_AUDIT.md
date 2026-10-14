# EasyCare Pre-Phase 3 Authentication and Registration Audit

**Audit date:** 2026-10-03 (Asia/Rangoon)  
**Scope:** Read-only trace of the checked-in frontend, Edge Function, migrations, Phase 2 family implementation, and existing tests. No source/test/database changes, migration, deployment, or browser/hosted verification was performed. Executable source and the current migration sequence take precedence over handoff prose.

## Executive answers

1. **Can Nandar create/use a separate Mother account through normal registration? YES.** Two distinct valid phone numbers and passwords result in distinct Auth users, profiles, patient rows, and clinical patient UUIDs, assuming the configured Edge Function and current schema are deployed.
2. **Can Mother sign in independently and access her own patient dashboard? YES.** Phone plus password authenticates one Auth user, and the patient lookup is by that user's `auth_user_id`. A new login is not demonstrated in a live browser/hosted environment in this audit.
3. **Can they become family members using Phase 2? YES, conditionally.** Both need active accounts with a recorded DOB making them at least 18, and the Phase 2 migration/RPCs must be applied. The family owner creates a group; the other account generates the join code; the owner sends the invitation; the invitee accepts.
4. **Does membership automatically expose Mother's clinical data? NO.** Membership is management metadata. RLS family access requires a separate active authorization with matching consent, an unexpired grant and the applicable scope.
5. **Can Mother explicitly authorize Nandar? YES.** The data-owning account grants selected scopes to another active group member, with consent and an expiry within one year; revocation is available.
6. **Is an authentication/registration fix required before building an adult-only Family Health Command Center? YES, if the Phase 3 experience requires newly registered accounts to succeed in `/family` without support intervention.** Smallest safe fix: add adult-age validation to registration (frontend and Edge validation) consistent with the existing RPC threshold, or otherwise clearly block/route under-18 accounts before `/family`. Do not change the age policy. Adult DOBs are already collected and persisted. Separately, verify the current Phase 2 migration is applied in the target environment; that is deployment state, not an auth redesign.

## 1. Sign Up fields and persistence

The normal form is at `/register`, headed **“Create your patient profile”**; submit button **“Create Patient Account”**. Validation is in `registrationSchema.js`; the service maps values in `registrationService.js`; Edge validation is in `_shared/registration-core.ts`; persistence is in the final `create_patient_registration` definition from `20260928090000_patient_profile_identity_repair.sql`.

| User-visible field | Required? / validation | Backend and persistence | Later use |
|---|---|---|---|
| Phone Number | Required; Myanmar phone format; normalized | `account.phoneNumber` → Edge normalized phone → `profiles.phone` and `patients.primary_phone`; also derived internal Auth email. Unique phone lookup before Auth creation. | Login identifier and patient identity lookup. |
| Password | Required; at least 8 chars, letter and number; Edge repeats checks | Supabase Auth `auth.users` password hash; never placed in profile/patient registration JSON | Auth credential. |
| Confirm Password | Required; must match Password | Frontend-only; not sent to backend | Validation only. |
| Full Name | Required; trimmed, max 160 | `profiles.full_name`, `patients.full_name` | Patient/dashboard and family display name. |
| Date of Birth | Required; real past date, no future/today. **No adult-age check.** | `profiles.date_of_birth` and `patients.date_of_birth` (`date`) in final registration RPC | Phase 2 adult gate checks `patients.date_of_birth`; eligibility. |
| Gender | Required; Male/Female/Other/Prefer not to say | `profiles.gender`, `patients.gender` | Stored demographic; no family permission behavior. |
| Address / City | Required; trimmed, max 300 | `patients.city` | Stored; not used for family access. |
| Contact Person Name | Required; trimmed, max 160 | `patients.emergency_contact_name` | Stored; no family authorization behavior. |
| Relationship | Required; trimmed, max 80 | `patients.emergency_contact_relationship` | Stored; no family authorization behavior. |
| Emergency Phone Number | Required; Myanmar phone format; normalized | `patients.emergency_contact_phone` | Stored; not used as account login. |
| Blood Type | Required selection including Unknown | `patients.blood_type` | Read by dashboard/settings; not family grant. |
| No known allergies | Checkbox, optional choice; if unchecked, allergies text is required | `patients.care_preferences` JSON key `noKnownAllergies` | Free-text preference only; does not create structured allergy rows. |
| Allergies | Conditionally required unless No known allergies; trimmed, max 1000 | `patients.care_preferences` JSON key `allergies` | Registration text is not inserted into `patient_allergies`; not structured clinical data. |
| Existing Medical Conditions | Optional; max 2000 | `patients.care_preferences` JSON key `existingMedicalConditions` | Not inserted into `patient_conditions`; does not seed normalized condition data. |
| Current Medications | Optional; max 2000 | `patients.care_preferences` JSON key `currentMedications` | Not inserted into `patient_medications`; does not seed medication records. |
| Terms and Conditions acceptance | Required checked | Sent as `termsAccepted: true` after validation; registration RPC does **not** persist this as a terms-specific consent | Frontend/Edge gate only. |
| Privacy Policy / information handling consent | Required checked | Sent as `privacyConsent: true`; registration RPC inserts generic `data_processing` consent version `registration-v2` | Persisted as generic consent; boolean and exact policy text/version are not stored. |

There is **no email field** in the UI. Auth gets an internal derived email from normalized phone; optional `account.email` support in Edge schema is not supplied by the form. No sex-specific separate field exists (Gender is the label). No health fields are copied into structured clinical tables at registration.

## 2. DOB and adult eligibility

- Registration asks for DOB and requires an actual date strictly earlier than today in both browser and Edge validation.
- It does not reject an otherwise valid minor DOB. The browser's `max` date also only excludes future dates; it does not enforce age 18.
- The final current registration RPC writes the same DOB into both `profiles.date_of_birth` and `patients.date_of_birth`. Earlier registration migration definitions were superseded; the final identity-repair migration is the current definition in a clean replay.
- The Phase 2 helper `require_family_patient()` requires an active patient and profile with patient role and `patients.date_of_birth <= current_date - interval '18 years'`. DOB missing, minor, or inactive means every family RPC guarded by that helper fails with an authorization-style error (“An active adult patient account is required”).
- Accordingly, newly registered adults can immediately use `/family` only when the Phase 2 migration/RPCs are applied and backend configuration is available. A minor can register/sign in, but cannot create a family, generate a code, invite/accept, read family management, or grant/revoke family access.
- DOB is mirrored in two columns but currently initialized consistently by registration. A later DOB update path must maintain both columns; registration itself is consistent. No independent age verification exists.
- UI `/family` checks that an Auth user and patient ID exist, but does not pre-check age. It will render and then show the generic family operation failure when the RPC rejects. This is a usability mismatch, not an authorization bypass.

## 3. Registration backend sequence

`/register` → `RegisterPage.handleSubmit` → `registerPatient()` → browser Zod validation and normalized request → Supabase Edge Function `patient-register` → server-side schema/phone/DOB/consent validation → phone duplicate lookup → `auth.admin.createUser()` → service-role `create_patient_registration` RPC → profile + patient + two consents → HTTP 201 `{success:true}` → browser `auth.signIn` using phone/password → `signInWithPassword` → active patient lookup → `/dashboard`.

The RPC runs its Postgres writes as one database transaction (profile, patient, consent rows). Auth user creation is outside that transaction. If persistence fails, Edge attempts to delete the Auth user as compensating rollback; failed cleanup can leave an Auth user without the patient rows. Automatic sign-in can independently fail after successful account creation; the form reports that the account exists and asks the user to sign in.

The Edge rate limit is an in-memory isolate map of five attempts per hashed forwarded address per 15 minutes; it is not durable across isolate restarts. Duplicate detection is by normalized patient phone. Different valid phone numbers are required for the second account.

## 4. Patient identity model

For each independently registered adult:

`auth.users.id = profiles.id = patients.profile_id = patients.auth_user_id` (enforced by current identity constraints); `patients.id` is a separate generated clinical patient UUID.

The registration RPC creates a new Auth user for each phone, inserts a profile under that user ID, then inserts a new patient row and returns its clinical UUID. Unique Auth-user and phone constraints prevent sharing the same account identity. Thus Mother and Nandar receive separate Auth users, profiles and clinical patient IDs when registered with distinct phone numbers. Family membership later links existing patient IDs; it does not merge or replace them.

## 5. Sign In

- **Identifier:** phone number only. The login page's Email tab is visibly disabled (“Email (Optional”); `Remember me` is cosmetic and defaults on.
- **Credentials:** phone and password. The service normalizes phone, derives internal email, then calls Supabase `auth.signInWithPassword({email, password})`.
- **Session:** Supabase JS handles persisted/refreshable session. AuthContext calls `getSession()` and subscribes to `onAuthStateChange()`.
- **Patient/status check:** after Auth succeeds, `loadAuthorizedPatient(user.id)` selects from `patients` by `auth_user_id`; missing/error/inactive patient rejects sign-in and locally signs out. Generic error is shown, avoiding account enumeration details.
- **Redirect:** success uses a validated return path if present, otherwise `/dashboard`; registration normally auto-signs in and navigates directly to `/dashboard`. Direct `/register` from a signed-in account is redirected by `PublicOnlyRoute`; `/login` is public and login itself accepts the credentials shown.

## 6. AuthContext/current patient and account-switch safety

`auth.uid()` is the managed Supabase user ID. AuthContext resolves the patient by `patients.auth_user_id`; the patient object's `id` is the clinical `patients.id`. Services/pages use that patient ID for patient-scoped queries; database RLS remains the actual access control.

Safeguards present:

- Each hydration increments a request ID and discards a stale async patient lookup if a newer auth event has arrived.
- A session without a matching active patient is locally signed out and state becomes anonymous.
- `signOutPatient()` uses `auth.signOut({scope:'local'})`; AuthContext clears `session`, `user`, and `patient` on success.
- Family page state remounts keyed by `auth.user.id`; pending join code/member data is discarded on account identity change. Async family requests use alive/version guards to ignore late results after unmount/reload.
- AI Overview is patient-keyed in its backend/cache design; family screen provides management metadata only and does not fetch other-member clinical data absent explicit scope.
- Prototype mode is separate and does not create a managed user or clinical UUID; it cannot use family management.

Limits: automated tests exercise session restoration, missing-patient sign-out and family page state behavior, but no single test proves a live full Account A logout → Account B login across dashboard, family, AI, and every cached component. This was not browser-verified. The current auth flow clears core identity; there is no universal centralized cache purge contract beyond component unmount/account-keyed behavior. The family page's own private state protections are explicit.

## 7. Two-account Phase 2 workflow

The requested order needs one addition: an invitation can only be sent by the owner of a family group, so Nandar must first create the group. Actual flow:

1. Register Nandar at `/register` with her own unique phone/password and adult DOB; successful registration auto-signs in and opens `/dashboard`.
2. Open `/family` (My Family page) and create a group with **Create a Family** / **Create Family**.
3. Sign out from the app navigation; sign in as Mother at `/login` with Mother's separate phone/password.
4. Open `/family`; click **Generate Invitation Code** and share the displayed one-use code with Nandar through a trusted external channel. Code lasts 24 hours.
5. Sign out; sign in as Nandar; open `/family`. In the owned group's **Invite an Adult Member** section, enter Mother's code and choose relationship (for example **mother**), then click **Send Invitation**.
6. Sign out; sign in as Mother; open `/family`; accept the incoming invitation using **Accept Invitation**.
7. Both accounts now see the family membership (Mother is a member; Nandar is group owner). Acceptance does not insert a family authorization and does not grant clinical access.
8. In Mother's member view, select Nandar's **Manage Access** and choose the desired scopes, expiry (future and no more than one year), and consent checkbox; submit **Grant Selected Access**. Mother controls access to Mother's own data.
9. Confirm the grant from the owner/member authorization metadata shown in My Family; database semantics also require active status, unexpired expiry and linked granted consent. Revoke via **Revoke Access**.

Join codes are random one-use UUIDs; only SHA-256 digest is stored. Invitation expiry is seven days; membership removal revokes group-origin grants and withdraws linked consent. Current family page is `/family`, not marketing `/families`.

## 8. Family-page compatibility and privacy

`/family` is under `ProtectedRoute` in `src/App.jsx`. UI operations call named RPCs through `familyRepository`; RPCs derive actor from `auth.uid()` rather than a client-supplied patient ID. `require_family_patient()` gates adult/active identity. Owner-only group invitation, invited-profile-only acceptance, membership-scoped views, data-owner authorization, consent linkage, expiration and revocation are enforced in SQL.

Membership exposes group/member identity and relationship metadata after acceptance; no membership-to-clinical-access RLS edge exists. Existing family authorization is scope-based (`records`, appointments, medications, payments, alerts); only authorization semantics applicable to an actual query enable data access. Family membership itself never makes Mother’s health rows visible to Nandar. No Phase 3 family health viewing UI is implemented here.

## 9. Account credential privacy

The architecture supports Mother owning Mother's phone/password/Auth identity and Nandar owning Nandar's. It does not require password sharing, shared `auth.users`, fake email, or fake Auth accounts. Family join code and invitation plus Mother's explicit authorization is the delegation model. Internal derived email exists only to use Supabase email/password Auth behind the phone-number UI; it is not a fake shared account.

## 10. Existing tests and verification level

| Claim | Current evidence | Classification |
|---|---|---|
| Registration fields/rendering/client validation | `RegisterPage.test.jsx`, registration schema/service tests | Unit/component tested; no live Auth/Edge browser submission proven |
| Registration DB identity and consent persistence | `patientProfileIdentity.integration.test.js`, SQL migration/RPC tests | Local DB integration tested; not two real Auth accounts in hosted Supabase |
| Auth session restore, rejected missing patient, route protection | `AuthContext.test.jsx`, `authService.test.js` | Unit/component tested with fake client |
| Family UI actions/privacy wording/account-keyed state | `FamilyPage.test.jsx` | Component tested with mocked service |
| Family RPCs, adult/minor gate, invitations, acceptance, no implicit clinical access, selected scopes, expiry, revoke and removal | `familyFoundation.integration.test.js` replays migrations in PGlite and tests RLS/RPC behavior | Local PostgreSQL-compatible integration tested, not hosted Supabase |
| Full two real accounts with actual registration → logout → login → family UI → scope grant | No end-to-end real Auth/browser test identified | Not verified |
| Browser behavior in an actual browser | None performed | Not verified |
| Hosted Auth/database/RLS/Edge Function state | No live environment inspected | Not verified |

The Phase 2 report expressly records no authenticated browser or hosted Supabase validation. Database tests do not establish browser behavior.

## 11. Manual demo readiness

**Can a real demo Mother account be created through normal registration? Yes, conditionally**—the configured real Supabase mode, Edge Function, current registration RPC/migrations and valid unique phone must be available. Avoid prototype/demo mode: it creates a synthetic session with no Auth user/patient UUID and cannot use `/family`.

User-facing sequence: from Nandar's session, use the Header **Log out** control (accessible label) or Settings → **Logout**; visit `/register`; complete all required fields with Mother's actual demo information, a distinct Myanmar phone number, a password and adult DOB; accept both consent checkboxes; click **Create Patient Account**. Normal success auto-signs in and opens `/dashboard`. If auto-sign-in fails after creation, use `/login`, enter Mother's phone and password, then **Sign In**. Open `/family` (My Family); create the group under Nandar first, then have Mother generate **Invitation Code**; return to Nandar to **Send Invitation**; switch back to Mother and **Accept Invitation**. Use Mother's **Manage Access** to explicitly grant desired scopes.

The Header logout control has accessible label **Log out**; Settings shows **Logout**. The route/button labels above are sourced from current JSX. `/family` is routable directly even where no desktop navigation link is evident.

## 12. Gaps, severity, and smallest safe fixes

| Severity | Affected source | Current behavior / expected behavior | Smallest safe fix (not implemented) |
|---|---|---|---|
| **Medium — eligibility mismatch** | `src/features/auth/registrationSchema.js`; `supabase/functions/_shared/registration-core.ts`; `src/features/family/FamilyPage.jsx`; `supabase/migrations/20261003090000_family_foundation.sql` | Form/backend accept past DOB for minors; `/family` then fails on every RPC. For an adult-only family product, notify/block in a user-friendly way before the RPC failure. | Add adult DOB validation to both registration layers using the exact existing 18-year SQL boundary; optionally mirror friendly eligibility messaging in `/family`. Preserve server RPC as authority. This changes no database or age rule. |
| **Low — consent traceability** | registration service + `create_patient_registration` in identity repair migration | Terms checkbox is validation-only; privacy checkbox yields generic `data_processing` consent with registration-v2, but neither exact checkbox text/version is separately evidenced. | Decide whether product/legal requirements need distinct terms/privacy consent records and persist the agreed versions. Not a blocker to two-account identity/family flow absent that requirement. |
| **Low — unstructured health intake** | registration RPC `care_preferences` payload | Allergies/conditions/medication text persists only in JSON preferences and does not become clinical allergy/condition/medication records. | If Phase 3 requires structured health data, separately define a reviewed import/confirmation path. Not an auth blocker. |
| **Environment-dependent — migration state** | Phase 2 migration `20261003090000_family_foundation.sql` | Source contains route/RPC code, but Phase 2 report says no hosted migration application/verification. If not applied, `/family` RPC calls fail. | Apply/verify the already-approved Phase 2 migration in the intended environment before demo/build; no new migration is indicated by this auth audit. |
| **Low — verification gap** | Auth/family tests | No complete real browser journey proves separate registrations plus A/B account switch, and no hosted verification exists. | Before relying on a live demo, perform a controlled two-account browser smoke journey in the intended environment; do not treat PGlite tests as hosted proof. |

No major identity-model change is indicated. The minimum production auth/registration work for an adult-only Family Health Command Center is a small adult-eligibility validation/message fix if registration must prevent unsupported minor enrollment; separate adult identity and Phase 2 delegation are already represented in current source.

## 13. Phase 3 readiness recommendation

**Ready to build an adult-only Phase 3 experience at the identity and authorization foundation level, after closing the minor-DOB usability mismatch and confirming the target environment has the Phase 2 migration applied.** Build must consume scoped family authorizations, respect consent/expiry/revocation and remain patient-specific; it must not infer access from membership. This audit does not claim Phase 3 health viewing exists or is hosted/browser verified.

## Source map

- Registration UI/schema/service: `src/features/auth/RegisterPage.jsx`, `src/features/auth/registrationSchema.js`, `src/services/registrationService.js`.
- Edge validation/creation/cleanup: `supabase/functions/patient-register/index.ts`, `supabase/functions/_shared/registration-core.ts`.
- Final registration identity/RPC: `supabase/migrations/20260928090000_patient_profile_identity_repair.sql`; DOB history also in `20260820010000_identity.sql` and `20260820011100_simplify_patient_auth.sql`.
- Login/session/guards: `src/features/auth/LoginPage.jsx`, `src/services/authService.js`, `src/features/auth/AuthContext.jsx`, `src/features/auth/RouteGuards.jsx`.
- Family route/UI/RPC repository: `src/App.jsx`, `src/features/family/FamilyPage.jsx`, `src/services/familyService.js`, `src/services/repositories/familyRepository.js`, `supabase/migrations/20261003090000_family_foundation.sql`.
- Test evidence: `src/features/auth/RegisterPage.test.jsx`, `src/features/auth/AuthContext.test.jsx`, `src/services/authService.test.js`, `src/features/family/FamilyPage.test.jsx`, `src/lib/patientProfileIdentity.integration.test.js`, `src/lib/familyFoundation.integration.test.js`.
- Read-first context documents: `docs/EASYCARE_CURRENT_STATE_HANDOFF.md`, `docs/EASYCARE_FRONTEND_MAP.md`, `docs/EASYCARE_BACKEND_MAP.md`, `docs/EASYCARE_PHASE1_IMPLEMENTATION_REPORT.md`, `docs/EASYCARE_PHASE2_FAMILY_FOUNDATION_REPORT.md`, `supabase/database-v2-handoff.md`, `supabase/database-v2-schema-map.md`.


