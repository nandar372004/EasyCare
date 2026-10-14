# EasyCare Phase A — Registration & Consent Implementation Report

## 1. Status

**COMPLETE.** Phase A implementation and verification are complete. No deployment was performed. Phase B work was not started.

## 2. Previous registration behavior

Patient signup required phone/password, name, date of birth, gender, address/city, emergency contact, blood type, allergy status/details, and Terms/Privacy acknowledgements. Conditions and medications were optional text fields, but still appeared in the registration form. The backend required the profile, emergency, and allergy inputs. Registration saved free-text health intake in `patients.care_preferences` and created generic `care` and `data_processing` consent rows at `registration-v2`.

## 3. New registration contract

The Create Account form and both client/server validation now require only phone, password, password confirmation, full name, date of birth, Terms acceptance, and Privacy acknowledgement. Email is not required or presented. Successful registration still creates an Auth user, creates its patient identity, signs in, and navigates to `/dashboard`.

## 4. Fields removed from mandatory signup

Gender, address/city, emergency contact name/relationship/phone, blood type, allergy status/details, existing conditions, and current medications are removed from the visible registration journey and registration payload. Their database columns and canonical clinical tables remain. No historical data was deleted and no canonical clinical table was redesigned.

## 5. Frontend changes

`RegisterPage.jsx` now displays only the minimal fields and two separately labeled, required consent checkboxes. It retains field-level feedback, focus on the first invalid field, loading state, success routing, and the account-created/sign-in fallback message. Registration validation no longer blocks on clinical data.

## 6. Backend changes

The shared Edge Function schema now validates phone presence/normalization, password policy, full name, valid past DOB, and both required acknowledgements. It ignores legacy health fields and does not persist them. Auth user creation, duplicate-phone handling, generic backend errors, origin controls, service-role RPC use, and Auth-user rollback after patient persistence failure are preserved.

## 7. Database changes

Forward-only migrations `20261004120000_registration_consent_types.sql` and `20261004130000_registration_consent_document_identity.sql` add distinct Terms and Privacy consent types and a constrained `consents.document_key`. The enum extension is isolated so the new values are committed before later SQL uses them. Existing consent rows remain unchanged with a null document key. The registration RPC creates profile and patient identity with a fixed `patient` role, uses the same Auth UUID for profile/patient links, leaves removed health fields unset/defaulted, and records the two new consent rows transactionally.

## 8. Consent evidence design

The Terms row has `document_key='terms_of_service'`, `consent_type='terms_of_service'`, and version `terms-v1`. The Privacy row has `document_key='privacy_policy'`, `consent_type='privacy_policy'`, and version `privacy-v1`. Each row has its own database acceptance timestamp (`granted_at`), status, patient ID, and accepting profile ID. New public Edge Function registrations must provide both acknowledgements; the database rejects either explicit false value. The enum extension is additive; existing family, teleconsultation, AI, care, and data-processing types retain their values and semantics.

## 9. Terms handling

The UI says “I agree to the Terms of Service” and the database records a separate Terms document key/version. No Terms route/page exists in the inspected app, so no legal text was invented or linked. Product/legal must publish and bind the actual immutable `terms-v1` document before production signup relies on this acknowledgement.

## 10. Privacy handling

The UI says “I acknowledge the Privacy Policy and information handling” and records a separate Privacy Policy key/version. No Privacy Policy route/page exists in the inspected app. Product/legal must publish and bind the actual immutable `privacy-v1` document before production signup relies on this acknowledgement.

## 11. Identity/security preservation

Auth user creation remains server-side. The browser cannot supply a role, provider identity, user ID, or patient ID through the validated registration contract. SQL fixes the new profile role to `patient`, creates linked profile/patient identities from the Auth user created by the Edge Function, and the RPC remains service-role-only. Phone/password login and session restoration code were not changed. Database transaction rollback covers profile, patient, and consent insertion; Edge Function cleanup removes the Auth user if persistence fails.

## 12. Minor behavior

DOB remains required and must be a valid past date. A valid minor DOB continues to register; no guardian or dependent behavior was added. Existing adult-only Family eligibility remains unchanged.

## 13. Legacy compatibility

The Edge Function accepts old payloads containing the former gender/address/emergency/medical fields because extra object keys are stripped by validation, but these fields are ignored and not persisted. Both consent acknowledgements remain mandatory. The service-role database RPC retains a compatibility branch for trusted internal legacy calls with no acknowledgement keys; it writes legacy generic consent rows without document keys. The public Edge Function does not use this branch because its schema requires both acknowledgements.

## 14. Tests added/updated

- Client registration tests cover the minimal contract, phone normalization and rejection, password policy/mismatch, name and DOB validation, minor acceptance, independent Terms/Privacy checks, ignored fields/role/identity inputs, and payload shape.
- Registration page tests cover visible fields, absence of removed health fields, accessible required checkboxes, validation feedback, and dashboard routing.
- Edge Function tests cover minimal signup, legacy field tolerance without persistence, server rejection cases, duplicate phone handling, minor behavior, and Auth-user rollback.
- Database migration tests cover separate consent identifiers and full migration replay; identity integration verifies timestamp, document key/version, attribution, unchanged identity, and rollback behavior.

## 15. Regression results

Established repository regression suite passed: **84 test files, 1,223 tests passed**. It excludes duplicate `.kilo/**` worktree copies and the three documented stale tests (`bookableDoctorSeed.test.js`, `phase4DatabaseSchema.test.js`, and `phase9AppointmentManagement.test.js`) that reference removed migrations. Coverage included Patient Login/session, dashboard, adult Family, Family Health, Provider Login/workspace and relationship authorization, provider Care Plan authoring, `/my-care-plan`, `/family/health`, Home Care, rolling horizon/maintenance, and Repairs 1–15.

Focused registration, consent, auth, and session suite passed: **8 files, 73 tests**; it includes the clean migration replay test.

## 16. Build result

**PASS.** `npm run build` completed. Vite emitted the existing large JavaScript chunk advisory (881.81 kB minified); no build errors occurred.

## 17. Migration replay result

**PASS.** The complete ordered migration chain replayed in isolated PGlite/PostgreSQL, including the new migration. The test created a minimal patient, confirmed fixed patient role and preserved Auth/profile/patient UUID links, verified no health intake persistence, checked both separate consent evidence rows, and rejected an explicitly unchecked acknowledgement.

## 18. Known limitations

- Actual Terms of Service and Privacy Policy content/routes are absent. Legal/product must publish the exact immutable documents represented by `terms-v1` and `privacy-v1` before production signup uses these acknowledgements.
- Old trusted service-role callers that omit acknowledgement keys receive legacy generic consent rows without document identity; the public Edge Function always requires both explicit acknowledgements.
- Health-profile onboarding and provenance-aware clinical intake remain future phases, as requested.
- Build retains the existing chunk-size advisory.

## 19. Phase B readiness

**Safe to start Phase B** for the post-registration onboarding shell and optional profile completion. Keep health writes out of canonical clinical tables until provenance-aware permissions and APIs are designed. Phase A does not implement Phase B.

## 20. Files changed

- `src/features/auth/RegisterPage.jsx`
- `src/features/auth/RegisterPage.test.jsx`
- `src/features/auth/registrationSchema.js`
- `src/features/auth/registrationSchema.test.js`
- `src/services/registrationService.js`
- `supabase/functions/_shared/registration-core.ts`
- `supabase/functions/_shared/registration-core.test.js`
- `supabase/migrations/20261004120000_registration_consent_types.sql`
- `supabase/migrations/20261004130000_registration_consent_document_identity.sql`
- `src/lib/databaseMigration.test.js`
- `src/lib/patientProfileIdentity.integration.test.js`
- `src/lib/registrationConsentMigration.integration.test.js`
- `docs/EASYCARE_PHASE_A_REGISTRATION_CONSENT_REPORT.md`
