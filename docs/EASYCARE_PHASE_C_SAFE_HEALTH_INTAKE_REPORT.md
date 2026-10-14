# EasyCare Phase C — Safe Patient Health Intake

## 1. Status

**VERIFIED.** Phase C implementation, the staging migration, and hosted patient intake verification are complete. Patient-entered health reports remain explicitly patient-reported and unverified, separate from clinician-authored clinical records. Phase C is closed; Phase D has not been started.

## 2. Data model

The forward-only migration `20261005110000_patient_reported_health_intake.sql` creates `patient_reported_health_items` for patient-reported allergy, condition, and medication items, plus `patients` provenance metadata for blood type. Reported item categories distinguish item entries from safe `none_known` and `unknown` markers. Flexible item details are validated by the RPCs. Existing canonical clinical tables remain in place.

## 3. Provenance model

The backend sets source to `patient_reported`, binds the reporting user and patient to `auth.uid()`, and records timestamps and an unverified state. Review metadata is reserved for a future authorized provider workflow. Patient RPC arguments cannot set source, verification, reviewer, provider, prescription, or role fields.

## 4. Allergy design

Patients add and edit reported allergy items, including reaction details, and can archive their own unverified reports. These records are stored in the dedicated intake table and are not inserted into or used to weaken write controls on `patient_allergies`.

## 5. Condition design

Patients can report conditions with optional context. The item remains patient-reported and unverified; it does not create or update a clinician-confirmed diagnosis in `patient_conditions`.

## 6. Medication design

Patients can report a medication name, dose/strength, frequency, reason, and supported optional details. Reports do not create `patient_medications`, prescriptions, prescription items, medication schedules, or source-backed Care Plan medication tasks.

## 7. Health basics

Blood type reuses the existing `patients.blood_type` field and adds provenance/status metadata. Unknown/not sure is supported. Patient writes go through a session-bound RPC, and direct authenticated updates to `blood_type` are revoked. Height, weight, smoking, and alcohol fields were not added because this flow did not establish a need for new medical fields.

## 8. Onboarding integration

The onboarding flow now includes personal, contact, health, and review steps. Health intake is optional: the patient can skip it and still complete onboarding. The existing “I’ll Do This Later” onboarding behavior remains available.

## 9. Profile Settings alignment

Profile Settings and onboarding reuse `PatientReportedHealthIntake` and the same RPC-backed service. The previous free-text allergy, condition, medication, and blood-type settings inputs were removed; the application no longer uses `care_preferences` as the active source for those fields. Existing `care_preferences` values are preserved and copied into the new table as unverified legacy patient reports with a deduplication key. The migration does not delete or rewrite the original JSON.

## 10. Patient permissions

Authenticated patients use session-bound RPCs to read their own reports, add/update/archive their own unverified report rows, and record their own blood type. No arbitrary patient/profile ID is accepted for identity. The intake table has no browser role grants or direct-write policy. Cross-patient item identifiers are rejected, and reviewed items are read-only to patients.

## 11. Provider boundary

Canonical provider-write clinical tables and provider authorization were not changed. The new schema reserves review metadata, but this phase does not implement a provider reconciliation UI or a conversion from patient reports to confirmed clinical records.

## 12. Family behavior

No Family projection or authorization changes were made. No new Family policy exposes patient-reported items; existing Family permission scopes remain authoritative.

## 13. Care Plan safety

Care Plan source reconciliation continues to use canonical medication and schedule sources. Reported medication rows are not written to those sources, so patient reports cannot satisfy clinician-medication source tasks. Care Plan authority and maintenance behavior were not changed.

## 14. Database changes

One forward-only migration was added and applied to EasyCare Staging (`xyprybspwrtthvhnumdp`) using a single-file SQL execution. Staging migration history was recorded as applied only after SQL succeeded. No other migration version was newly applied; no database reset or full migration push was run. Remote checks confirmed the intake table, all five RPCs, blood-type provenance fields, denied direct authenticated table access, denied direct blood-type updates, and four copied unverified legacy reports. Every RPC is security-definer with an empty search path, executable by authenticated but not anon, and uses `auth.uid()` to resolve the patient through `patients.auth_user_id`; no RPC accepts a patient/profile ID. Hosted verification found patient-reported allergy, condition, and blood-type data. The authorized patient then submitted one Amlodipine 5 mg once-daily report through Profile Settings. The running frontend served project ref `xyprybspwrtthvhnumdp`; the RPC created exactly one matching active report, the authenticated reporter matched the patient identity, and the report remained visible after a page refresh. Local migration replay also passed.

## 15. Tests

The focused Phase C, onboarding, Profile Settings, and dashboard tests passed again: **8 files, 38 tests**. Coverage includes ownership, reviewed-item protection, no canonical clinical writes, blood type unknown handling, direct-write denial, legacy-data preservation, and optional onboarding health intake. The two provider UI tests that previously timed out passed individually (**2/2**).

## 16. Regression results

The isolated provider Care Plan verification suite passed: **66/66 tests**. The two provider UI tests that timed out in the parallel full-suite run also passed individually (**2/2**). A full suite run excluding the nested `.kilo` checkout had **92 passing files and 1,251 passing tests, with 2 parallel-run provider UI timeouts**. Three other test files could not start because these historical migration files are absent from this checkout:

- `supabase/migrations/20260813000300_seed_bookable_test_doctors.sql`
- `supabase/migrations/20260810000000_core_presentation_schema.sql`
- `supabase/migrations/20260813000200_phase9_appointment_management.sql`

The provider timeouts did not reproduce individually, and no Phase C or provider regression was found. The three missing migration files are a test-checkout limitation. Tests were not weakened and the absent historical files were not fabricated or changed.

## 17. Build

`npm run build` passed after staging deployment verification. Vite reported the large-chunk advisory (main bundle approximately 899 kB minified); it did not fail the build.

`git diff --check` completed without whitespace errors. Git printed line-ending conversion notices for existing working-copy files.

## 18. Known limitations

- The hosted Settings flow was exercised with the authorized staging patient. The successful Amlodipine report was verified in the database and remained visible after refresh. The RPC response and resulting row confirm the save succeeded; the browser integration did not expose a raw Network panel status code.
- No matching prescription, prescription item, canonical `patient_medications` row, or medication schedule was created for the reported Amlodipine. The patient reporter matched the authenticated patient identity; source remained `patient_reported`; status remained `unverified`; provider/reviewer fields were unset. No Care Plan source or authority was changed.
- Profile Settings and onboarding use the same health-intake component/service and underlying RPC data. No `care_preferences.currentMedications` value was introduced.
- Legacy `care_preferences` strings are copied with the migration-time creation timestamp because the source is unstructured text and has no per-item timestamp. The original JSON remains preserved.
- A future provider-authorized review/reconciliation UI and workflow is still required before any patient report can become authoritative clinical data.
- The earlier medication entry that prompted the trace was absent from staging; its original request outcome could not be recovered. The subsequent authorized test submission succeeded through the correct project and persisted after refresh.

## 19. Phase D readiness

**Yes.** Allergy, condition, medication, and blood-type flows were verified; persistence and Profile Settings reuse were confirmed; patient reports stayed outside canonical clinical medication authority; Family and Provider authorization remained unchanged; and no real regression was found. Phase C is closed. Phase D may start as a separate phase when requested.

## 20. Files changed

Phase C-specific files include:

- `supabase/migrations/20261005110000_patient_reported_health_intake.sql`
- `src/services/patientReportedHealthService.js` and its tests
- `src/features/health/PatientReportedHealthIntake.jsx` and its tests
- `src/features/onboarding/PatientOnboardingPage.jsx` and its tests
- `src/features/secondary/PatientSettingsPage.jsx` and its contract tests
- `src/services/repositories/supabaseRepository.js`
- `src/services/repositories/patientDashboardRepository.js` and its tests
- `src/lib/patientOnboarding.integration.test.js`
- `src/lib/patientReportedHealthMigration.integration.test.js`
- `src/lib/patientReportedHealthMigration.test.js`
- `src/styles/global.css`

The working tree also contains unrelated earlier EasyCare phase changes; this report does not attribute those files to Phase C.
