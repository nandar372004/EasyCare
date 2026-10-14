# EasyCare Account & Onboarding Architecture Audit

**Status: COMPLETE — audit only.** Repository state was inspected read-only; this report is the only requested deliverable. No application code, migrations, deployment, or database state was changed.

## 1. Executive summary

EasyCare already has a secure patient phone/password account path, an adult-to-adult family invitation and explicit authorization foundation, verified-provider login, and separate patient/provider identity resolution. The main onboarding issue is that account creation currently asks for a long clinical and emergency intake before the user can reach the dashboard, while some health answers are saved as unstructured JSON rather than canonical clinical records.

There is no public provider application or self-service provisioning flow. Provider identity and credential verification fields exist, and database rules reserve identity changes for the main administrator, but the inspected product reports and UI do not establish an operational credential review workflow. Provider application must be separate from provider authority.

Recommended direction: retain phone/password and minimal identity at signup; move clinical intake to a skippable, clearly sourced health-profile flow; retain adult family membership as a separate step followed by owner-granted, scoped consent; add provider application and verification as a distinct future workflow; preserve all existing Care Plan and relationship authorization rules.

## 2. Current patient registration

The current page is `src/features/auth/RegisterPage.jsx`, titled “Create your patient profile.” It accepts a phone and password, then asks for identity, address, emergency contact, blood type, allergy status/details, existing conditions, current medications, Terms acceptance, and privacy/information-handling acceptance. It has no email field. On success, it signs the new patient in and navigates to `/dashboard`.

The client schema is `src/features/auth/registrationSchema.js`; `src/services/registrationService.js` sends the payload to the `patient-register` Edge Function. Password and confirmation are not copied into the registration RPC payload; password is passed to Supabase Auth. `supabase/functions/patient-register/index.ts` validates/rate-limits the request, creates the Auth user, calls `create_patient_registration`, and removes the Auth user if database registration fails.

The Auth email is derived internally from the normalized phone. An optional email is accepted by shared backend validation/persistence, but the current page does not collect one and login uses phone. It should not be advertised as a recovery/login email until authentication and recovery semantics are designed consistently.

## 3. Registration field matrix

| Field | Current requiredness and validation | Current database destination | Clinically necessary? | Recommended placement |
|---|---|---|---|---|
| Phone Number | Required; Myanmar phone format validated in Zod and normalized by server; unique profile phone | Supabase Auth uses phone-derived internal email; patient/profile phone fields | No, but required for this account/login design | Required at registration |
| Password | Required; at least 8 chars, one ASCII letter and one digit; Auth validates too | Supabase Auth only | No clinical value | Required at registration |
| Confirm Password | Required; must equal password; form-only | None | No | Registration form only |
| Full Name | Required; trimmed, 1–160 characters; backend validates | Auth metadata and patient/profile identity row (`full_name`) | Not clinical, needed to identify the account | Required at registration |
| Date of Birth | Required; strict valid past date in UI; backend rejects invalid/future date; under-18 users are accepted | Patient identity row and profile date of birth | Useful for age-sensitive eligibility and care context; not needed for credentials | Keep in basic identity, with explicit minor/guardian product policy before offering child services |
| Gender | Required; enum Male/Female/Other/Prefer not to say in UI; backend validates supported values | Patient/profile gender | Not universally clinically necessary; may be relevant to some care | Make optional in basic identity or collect in optional profile with Prefer not to say |
| Address / City | Required combined text; trimmed, max 300; backend validates nonempty | Stored in `patients.city` by current RPC; distinct address_line and township columns exist but this form does not map them | Not needed for account; may help service delivery | Optional onboarding; collect structured address only when needed for a service |
| Emergency contact name | Required; trimmed, 1–160 | `patients.emergency_contact_name` | Helpful for care, not account creation | Optional health/safety onboarding, with clear reason |
| Emergency contact relationship | Required; trimmed, 1–80 | `patients.emergency_contact_relationship` | Helpful context, not account creation | Optional health/safety onboarding |
| Emergency contact phone | Required; Myanmar phone validation/normalization | `patients.emergency_contact_phone` | Helpful for care, not account creation | Optional health/safety onboarding |
| Blood Type | Required; enum A+, A−, B+, B−, AB+, AB−, O+, O−, Unknown | `patients.blood_type` | Not universally necessary; self-reported blood type must not be treated as confirmed | Optional onboarding; default/allow Unknown and label source as patient reported |
| No known allergies | Required boolean choice; either selected or allergies text must be present | `patients.care_preferences` JSON key `noKnownAllergies` | Allergy status is important, but forced signup is poor fit and self-report is unverified | Optional onboarding; do not infer “none” from omission |
| Allergy details | Optional only when “No known allergies” selected; otherwise at least one character; max 1000 | `patients.care_preferences` JSON key `allergies`; not inserted into `patient_allergies` | Clinically useful | Optional onboarding as patient-reported history; distinct from verified clinical allergy rows |
| Existing conditions | Optional free text; max 2000 | `patients.care_preferences` JSON key `existingMedicalConditions`; not inserted into `patient_conditions` | Clinically useful | Optional onboarding as reported history; do not imply clinician-verified diagnosis |
| Current medications | Optional free text; max 2000 | `patients.care_preferences` JSON key `currentMedications`; not inserted into `patient_medications` | Clinically useful | Optional medication reconciliation; do not create prescriptions or active medication orders from free text |
| Terms | Required checked boolean | RPC records generic `care` consent with version `registration-v2` | Legal/product requirement rather than clinical intake | Keep at account creation; store exact document/version and acceptance evidence |
| Privacy / information handling | Required checked boolean | RPC records generic `data_processing` consent with version `registration-v2` | Legal/product requirement rather than clinical intake | Keep at account creation; store exact document/version and acceptance evidence |

The two consent rows do not separately identify the exact Terms document and Privacy Policy version/text. The enum has `care`, `data_processing`, `family_access`, `teleconsultation`, and `AI_assistance`; adding consent rows for two checkboxes does not by itself prove which documents the user accepted.

## 4. Current patient identity architecture

Supabase Auth user is the login principal. Patient registration creates a patient identity linked to that Auth user; current patient-specific queries resolve the logged-in user to their own patient row. Patient registration and session resolution do not accept an arbitrary patient identifier from the browser as proof of identity. The patient dashboard is entered after successful registration/sign-in.

The public registration function is patient-only. Edge Function validation is duplicated server-side in shared registration code. The Edge Function enforces an origin allowlist (with local development origins), POST/OPTIONS handling, configured secrets, and a per-process in-memory rate limit keyed from forwarded IP and a peppered hash. Because that limiter is process-local, it is not a durable distributed abuse-control mechanism; a production-grade shared limiter is a future hardening consideration.

## 5. Recommended patient registration

Keep the first step short:

1. Phone number
2. Password and confirmation
3. Full name
4. Date of birth (retain because age gates the adult family product and informs a future minor policy)
5. Required Terms acceptance and privacy notice/consent, each linked to its exact current version

Create the account, sign in, and land on a welcome/profile-completion screen with clear “Do later” and progress. Gender, address, emergency contact, allergies, conditions, medications, blood type, and care preferences should not block account creation. If product policy decides DOB is not required to create an account, ask before the first age-gated/family feature and prevent access until the age check is complete.

Do not require a medical history as a condition of using general account features. Explain which items are optional and whether they are patient-reported.

## 6. Recommended health onboarding and actual schema reuse

Use a post-registration checklist that can be completed in short steps and skipped. The profile should distinguish “reported by you” from information documented by a clinician.

- **Allergies:** canonical `patient_allergies` already has patient, allergen, reaction, severity, active/inactive status, and `recorded_by`. Existing authenticated insert policy is provider-restricted (doctor/nurse), so patient self-entry needs a narrow self-service RPC or a separate patient-reported intake table/status. Do not bypass RLS or silently mark self-reported entries as clinician-confirmed. Preserve “no known allergies” as an explicit, sourced assertion rather than treating an empty list as a negative.
- **Conditions:** `patient_conditions` has condition name, status, diagnosed date, recorder, notes, plus metadata constraints in later migrations. Patient-reported entries should be labeled and reviewed; current create policy is doctor-only. Add a constrained self-report route or dedicated intake table before onboarding writes here.
- **Medications:** `patient_medications` represents medication rows with medication name, dose/frequency/dates/status, optional prescription item, and `created_by_profile_id`; medication schedule/event structures also exist. Do not convert arbitrary free text into an active medication or prescription. Add medication reconciliation that records patient-reported entries with source/status, then lets a clinician reconcile them into canonical medication truth.
- **Emergency contact:** existing patient columns `emergency_contact_name`, `emergency_contact_relationship`, `emergency_contact_phone`; reusable, but make optional at account creation. Restrict family views to explicit scopes and avoid exposing by default.
- **Blood type:** `patients.blood_type`; reuse it, but permit unknown/null and capture source/verification if it will be shown clinically.
- **Care preferences:** `patients.care_preferences` JSONB is available for bounded nonclinical preferences. Define a versioned schema and validation; do not turn it into a catch-all medical record.
- **Gender/address:** profile gender and patient address fields exist. Address UI should map to `address_line`, `township`, and `city` rather than placing the entire combined string into city. Keep optional unless required for a chosen service.
- **Baseline health profile:** `patient_health_profiles` is a separate structured table for baseline measurements/statuses and reviewed metadata; it is not a dumping ground for conditions/allergies/medications. It can be a later, optional profile step.

## 7. Current family architecture

The current model is adult account to adult account. `family_groups`, `family_group_members`, `family_join_codes`, and `family_invitations` connect existing authenticated patients. A join code is one-time, stored as a digest, returned to its creator, and expires after 24 hours; an invitation is sent to an intended profile and expires after seven days. An invitation must be accepted by the intended authenticated person. Group membership and relationship label do not grant clinical access.

Each patient remains the owner of their own records and grants/revokes family permissions for their own patient identity. `family_authorizations` carries scoped flags, consent linkage, expiration and revocation information, and is audited. Server RPCs manage membership and grants; direct authenticated table writes are denied. Current family read projections require both active membership and an active explicit scope. Family Health is read-only and scope-limited.

The backend foundation is usable for post-registration family UX; onboarding should call the existing RPCs rather than creating a second household/family schema. The sequence should present “Just myself” or “Myself and my family,” then “Create Family,” “Join Family,” “Invite Family,” or “Skip.” “Invite” means issue/share a join code or invite a registered profile through existing APIs; joining never implies authorization. The patient should grant data scopes in a separate, named consent step.

## 8. Nandar and Mother: supported adult flow

Assume Nandar and Mother are both adults and each has their own account and patient identity.

1. Nandar creates an account and chooses family setup. Nandar creates a family group.
2. Mother creates her own EasyCare account (if she does not have one), signs in, and creates a one-use join code for her profile.
3. Mother gives the code to Nandar through a channel they choose. Nandar uses the code to invite Mother and records the relationship label “Mother” on the invitation/member row. The label describes Mother’s relationship to Nandar/the group context; it does not authorize access.
4. Mother signs into her own account and accepts the invitation. Membership becomes active.
5. Mother, as owner of her health data, opens the family authorization step and grants Nandar only selected scopes (for example, Care Plans and records), with the displayed expiry/consent terms. This creates/updates explicit authorization and consent.
6. Nandar selects Mother in `/family/health`. The server checks active group membership, adult patient status, and `can_access_patient` scope. Care Plan display additionally uses `care_plans` permission and remains read-only.
7. Mother can later change scopes or revoke access. Expiry, revocation, inactive membership, or withdrawn consent denies the corresponding family read.

If Mother has no account yet, Nandar can explain or share the registration entry point, but cannot create a patient identity for her or access/share her records on her behalf. Mother must create her own account before the existing join/accept flow can complete. No password sharing or adult-family workaround is supported.

## 9. Child/dependent limitation

The current family model requires an existing authenticated patient identity for each member and the family/health projections enforce adulthood for both relevant family participants. The current registration does allow a person under 18 to create a patient account, but that does not create guardian authority or a dependent patient model. There is no parent/guardian proxy identity, minor consent, representative relationship, or accountless dependent record flow in the audited architecture.

Therefore the adult family model does not support a child without their own account. Do not create an adult account pretending to be the child or treat a relationship label as guardian permission. Dependent/guardian support is future scope requiring its own legal/product model, patient identity ownership, guardian verification, consent, revocation, and age-of-majority transition design.

## 10. Current provider architecture

Provider login exists at `/provider/login`; it authenticates using existing Supabase Auth credentials and accepts phone or email plus password. Phone sign-in derives the same internal email convention; email/password is supported for existing providers. There is no provider public registration or application form, no provider-specific Auth store, and no registration link on the provider login page.

The account chain is `auth.users → profiles → providers`; provider accounts do not receive patient rows merely by being providers. `profiles.role` is a single enum role. `providers.profile_id` is unique. Provider types are `doctor`, `nurse`, `nurse_aide`, and `caregiver`. Profile roles map to allowed provider types: doctor→doctor; nurse→nurse/nurse_aide; caregiver→caregiver. Other profile roles are not clinical provider roles.

Current `providers` fields include provider ID, profile ID, provider type, license number, verification status (default pending), years of experience, bio, languages, service area JSON, home-visit and teleconsult flags, rating average, verified timestamp, and created/updated timestamps. There is no separate provider active-status field. `provider_credentials` includes credential type/number, issuer, issue/expiry dates, document URL, verification status, verifier profile, and verified timestamp. `specialties` and `provider_specialties` hold specialty associations. Relevant values for `verification_status` are pending, verified, rejected, and suspended.

## 11. Current provider provisioning and verification

Existing providers are provisioned through trusted/admin-managed data operations: an Auth user and profile are created, a provider row is linked, role and provider type are made consistent, and credentials/verification are populated through controlled administration. Database triggers/policies explicitly protect provider identity and verification fields from non-admin writes. No public self-service flow is present.

`get_my_provider_identity()` derives the provider through `auth.uid()` and returns only an eligible linked provider. Eligibility requires an active profile, compatible profile role/provider type, `verification_status='verified'`, and `clinical_identity_is_current()`. The helper `clinical_identity_is_current()` also requires active profile and verified provider for clinical roles. Pending, rejected, suspended, mismatched, or otherwise ineligible users do not receive provider identity. Provider sign-in checks this RPC; if no verified provider identity is returned, the app signs out the attempted provider session and shows a provider-access error.

Provider identity is derived from authenticated identity. Browser users do not choose or submit a provider ID to establish authority. `list_my_clinical_patients()` returns only a minimal list for the current provider and current relationship. Phase 5A.2 keeps relationship access limited to a current pending/confirmed/rescheduled appointment before its end, a current assigned/accepted assignment with an open parent request, or the responsible verified doctor’s own active/paused plan. Historical encounters, completed/cancelled appointments, and terminal plans do not independently preserve provider access.

The core database includes `is_main_admin()` and audit triggers on credential/provider identity changes, and schema fields for `verified_by`/`verified_at`. This is administrative capability and audit recording at the database layer; the repository reports do not show a complete provider credential-review user interface or end-to-end operational verification workflow. Do not imply verification is operational solely because status columns and guarded database actions exist.

## 12. Recommended provider application

Add a separate “Apply as a healthcare provider” entry point, distinct from patient registration and provider sign-in. The minimal flow should create/identify an ordinary account first, collect professional application data, submit to review, and show application status. Selecting “Doctor” must only set a requested type in an application record. It must never set `profiles.role='doctor'`, create a verified provider row, or enable clinical access.

Suggested application states: draft, submitted, under_review, verified, rejected, with withdrawn if product needs it. Current `verification_status` on providers supports pending/verified/rejected/suspended but does not model draft and submission/review operations cleanly. Prefer a separate `provider_applications` entity with status and immutable application/audit history. Verification should create or activate the provider identity only after an authorized reviewer confirms credentials; store reviewer, decision time, reason, and evidence references.

## 13. Provider application fields

| Field | Recommendation | Reason |
|---|---|---|
| Full name | Reuse account identity; editable only through account/profile path | Avoid duplicate identity data |
| Phone | Reuse verified account phone | Contact and login identity |
| Email | Optional contact field; verify separately if used | Do not silently change phone-based login |
| Date of birth / gender | Do not require by default; request only if legal/licensing verification requires them | Not needed to establish provider authority |
| Requested provider type | Required application selection | Request only; no role grant |
| Specialty | Optional for non-doctors; structured catalog where relevant | Useful for matching, not authorization |
| Registration/license number | Required for regulated clinical types before submission | Core verifiable credential |
| Qualifications | Required summary or structured credential records | Supports review |
| Years of experience | Optional and bounded | Directory/context, not authority |
| Hospital/clinic affiliation | Optional initially; verify before displaying affiliation | Avoid unverified affiliation claims |
| Professional bio | Optional, bounded, reviewed before public use | Patient-facing profile data |
| Profile photo | Optional | Not needed for verification |
| Credential documents | Required where applicable, private storage with restricted access and retention rules | Supports evidence-based verification |
| Languages/service area | Optional; later provider workspace setup | Operational preferences, not eligibility |

## 14. Provider security boundary

The application and provider identity are different records. A submitted application should not create clinical provider identity. Only a reviewer authorized under an explicit policy may make the verified transition. Runtime access continues to require authenticated `auth.uid()`, active profile, compatible provider role/type, verified provider row, current clinical identity, and current patient relationship. All clinical RPCs/RLS remain authoritative and continue to reject caller-supplied provider identity as proof.

The existing provider enum does not cover every future health worker or clinic-admin role. Any expansion must define what each role can do and how its relationship is created; do not map an application choice to a permissive generic provider type.

## 15. Admin and verification gap

The schema has a `main_admin` role, `is_main_admin()` guard, provider and credential statuses, `verified_by`, `verified_at`, provider/credential audit triggers, and protections against unauthorized provider identity edits. In the inspected reports and app routes, there is no provider application portal, credential review queue, document review UI, reviewer workflow, or complete audited decision RPC lifecycle. `provider_credentials` supports records but does not itself make review operational.

Minimum future design: private credential object storage; application submit/status RPCs; admin-only review queue; an authorized verification/decision RPC that checks reviewer authority, records status/reason/reviewer/time, audits every transition, prevents applicant self-approval, and creates/updates provider identity atomically; notifications/status view for applicant; tests for unauthorized decisions and verified-access gating. Define retention and access limits for identity/credential documents.

## 16. Login UX

Present “Patient Sign In” and “Provider Sign In” as clear pathways, with patient Create Account and provider Apply links placed appropriately. This matches separate route guards and prevents confusion. A shared login can still offer an explicit workspace chooser after authentication when the server resolves both identities. Never expose a client-side “I am a doctor” toggle that grants role or provider authority. Email login should be clearly described for existing providers only until patient email authentication is deliberately implemented.

## 17. Dual-role behavior

AuthContext restoration resolves patient identity and provider identity independently from the same session. A workspace preference is stored locally for convenience, but it is honored only if the server has freshly resolved the corresponding identity. When both identities exist, `/workspace` offers a workspace choice/switch. Patient login sets patient preference; provider login sets provider preference; switching does not change role or grant authority. Provider-only users cannot enter patient routes and patient-only users cannot enter provider routes. A profile's single role enum and separate patient/provider rows must remain compatible through explicit admin provisioning rather than browser selection.

## 18. Care Plan integration

- Patient account → own patient identity → verified provider with a current relationship authors the Clinical Care Plan → patient sees their own plan at `/my-care-plan`.
- Family account → accepted adult membership → the patient/data owner explicitly grants `care_plans` scope → family sees that member’s plan read-only in `/family/health`.
- Provider account → current verified provider identity + current patient relationship → `/provider/care-plans` and existing server-authorized authoring/read RPCs.

This onboarding audit recommends no change to the Care Plan lifecycle, `/my-care-plan`, family read projection/authorization, provider relationship rules, Home Care `/care-plan`, rolling horizon, or scheduler.

## 19. Recommended complete user journey

**New patient:** Landing → Create Account → phone/password + name + DOB + document-specific Terms/privacy acceptance → account created/signed in → optional health-profile checklist → optional family setup or skip → Dashboard.

**Existing patient:** Patient Sign In → own patient identity resolved → Dashboard.

**New provider:** Apply as Healthcare Provider → ordinary account identity → professional details and credential upload → submit → pending/review status → authorized verification → verified provider identity → Provider Sign In → Provider Workspace.

**Existing verified provider:** Provider Sign In → verified identity resolved from `auth.uid()` → Provider Workspace.

**Family member:** own adult account → accept intended invitation → active membership + relationship label → data owner grants explicit scopes → viewer accesses only the authorized read-only Family Health sections.

## 20. Existing schema reuse

- `auth.users`, `profiles`, patient identity row, and `patient-register` for patient account creation.
- Existing profile fields for phone, name, DOB, gender, language; patient fields for address, emergency contact, blood type, preferences.
- `patient_allergies`, `patient_conditions`, `patient_medications`, schedules/events for canonical clinical data, with careful provenance and current RLS.
- `patient_health_profiles` for its defined baseline profile data.
- `consents` for versioned consent evidence, with document identity/version representation improved.
- Family group/member/join-code/invitation/authorization schema and existing family RPCs.
- `providers`, `provider_credentials`, `specialties`, and `provider_specialties` as verified provider directory/clinical identity after review.
- Existing admin role and audit infrastructure as building blocks, after an operational reviewer UI/RPC is designed.

## 21. New schema potentially required

- `provider_applications` with applicant profile, requested provider type, structured professional details, status, submitted timestamp, decision metadata, and audited state history.
- Private credential-document metadata/storage policy with restricted reviewer access and retention/cleanup policy; do not expose public document URLs.
- Patient-reported allergy/condition/medication intake/provenance if existing canonical tables cannot safely represent unverified self-reports. A separate intake record should include source, status, entered/reviewed timestamps, reviewer, and link to any reconciled clinical record.
- Consent evidence/document version fields or a dedicated acceptance record sufficient to prove which Terms and Privacy versions were accepted.
- Optional onboarding completion/progress state only if not safely derivable from existing field presence; do not block account use on this state.

## 22. Frontend impact

Likely changes: `RegisterPage.jsx`, patient registration schema/service and login links; welcome/onboarding pages for profile completion and family choice; existing family management pages to call current RPCs with explicit separation between membership and permissions; provider login navigation; new provider application form, application status page, and admin verification console. Provider reviewer/admin UI is genuinely new. No public provider signup should be added to provider login itself as a privilege path.

## 23. Backend impact

Patient account changes: adjust registration payload and SQL/Edge validation so optional health answers are not required; preserve Auth/database rollback; record exact consent document versions; likely add a post-registration profile save service/RPC with field validation. Health intake: add scoped provenance-aware RPC/table writes; current clinical table write policies are provider-limited and should remain so unless explicit self-report semantics are designed.

Family onboarding can reuse current RPCs; add frontend orchestration only. Provider applications need submit/status APIs, private document storage, reviewer decision RPC, audit/history, notifications, and atomic verified-provider provisioning. Keep server checks at every provider and family data path.

## 24. RLS/security impact

- Preserve registration service-role boundary and server validation.
- Ensure health-profile updates can only target the caller’s own patient identity; do not accept arbitrary patient IDs without deriving/checking auth ownership.
- Keep self-reported data distinct from clinician-entered truth and family projection scopes.
- Keep family group membership separate from `family_authorizations`; ensure family pages never infer access from relationship labels.
- Restrict provider applications and credential documents to applicant plus authorized reviewers; avoid public credential URLs.
- Restrict provider verification transitions to explicitly authorized reviewer RPCs; deny applicant self-verification and direct table updates.
- Continue to require active, compatible, verified provider identity and current patient relationship for clinical work.
- Store Terms and Privacy acceptance independently with exact version and timestamp; do not treat one consent type as the other.

## 25. MUST HAVE

- Short account creation with server-validated phone/password and necessary identity.
- Exact, versioned Terms and Privacy acceptance evidence.
- Optional, skippable health onboarding with transparent patient-reported status.
- Explicit family authorization after membership, per data owner and scope.
- Provider application cannot create verified provider authority.
- Authorized reviewer decision path and current clinical identity checks before provider access.

## 26. SHOULD HAVE

- Structured address fields and optional email verification for recovery/contact.
- Provenance-aware allergy/condition/medication reconciliation; explicit “unknown” states.
- Onboarding progress/resume UX and a profile completion indicator.
- Applicant status/decision notifications and auditable reviewer reasons.
- Shared login landing with separate patient/provider routes and server-resolved dual-workspace chooser.

## 27. FUTURE

- Parent/guardian and accountless dependent model with legal policy and age transition.
- Additional provider types/clinic staff applications after role/capability mapping.
- Rich credential renewal/expiry automation and organization-level verification.
- Additional health profile sections such as baseline measures where product needs justify them.

## 28. Implementation phases

1. **Phase A — Consent and registration contract:** decide required identity fields and minor policy; version Terms/Privacy acceptance; shorten UI while preserving Auth and rollback behavior.
2. **Phase B — Patient onboarding shell:** create welcome/profile checklist, optional/skip/resume behavior, and own-profile save path.
3. **Phase C — Safe patient health intake:** provenance and self-report data model/RPC for allergy/condition/medication reconciliation; map existing address/emergency/blood-type fields without writing clinical truth unsafely.
4. **Phase D — Family onboarding UX:** wire welcome choices to existing group/join/invite APIs; show relationship labels separately from explicit scope consent; verify `/family/health` behavior remains read-only and authorized.
5. **Phase E — Provider application data and upload security:** add application schema/status and private credential-document handling; no provider privileges.
6. **Phase F — Verification operations:** authorized admin queue and decision RPC/audit trail; provision verified provider identity only on approval; test denial, suspension/rejection, expiry, and no self-approval.
7. **Phase G — Login/workspace polish:** clarify Patient Sign In, Provider Sign In, Apply, and server-resolved dual-role switching; keep the underlying identity checks unchanged.

## 29. Risks

- Long signup can reduce completion and collects more health data than account creation needs.
- Free text in `care_preferences` is not equivalent to validated clinical records and can be mistaken for clinician-confirmed data.
- Writing patient input directly into clinical tables may bypass provenance and violates current provider-oriented write policies if implemented casually.
- Generic registration consent rows do not identify exact Terms/Privacy documents.
- Provider status fields without an operational reviewer workflow can create a false impression of governance.
- Profile role is single-valued; dual patient/provider accounts require a defined provisioning/migration strategy.
- Registration currently permits minors but family features require adult identities; onboarding must explain the boundary and not imply guardian support.
- Existing process-local Edge Function rate limiting may not offer consistent limits across function instances.
- Credential documents and contact fields require strict private storage and retention controls.

## 30. Final recommendation

Implement the patient path first: shorter signup, exact consent evidence, then optional sourced health onboarding. Reuse the adult family RPC model and preserve the separate grant step. Build provider application and verification as a separately authorized workflow with private documents and auditable reviewer decisions. Keep the current `auth.uid()`-derived identities, server-side current relationship checks, family explicit scopes, and all Care Plan architecture intact.

## Audit answers

- Does current Patient Create Account need improvement? **YES**
- Should health information be split from basic registration? **YES**
- Does adult Family linking already have a usable backend foundation? **YES**
- Should Family membership automatically grant health access? **NO**
- Does public Provider registration currently exist? **NO**
- Should Provider application be added? **YES**
- Can provider application automatically grant Doctor privileges? **NO**
- Does EasyCare currently have a complete provider verification/admin workflow? **NO**
