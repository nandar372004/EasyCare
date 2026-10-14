# EasyCare Phase H — Secure Medical Document Intake

## Status

**Implementation status: PARTIAL (local implementation complete; hosted deployment and verification remain).**

Phase H adds patient-owned medical document intake and read-only document access using the existing clinical-document metadata and authorization foundation. The implementation does not extract or infer medical facts. It does not create diagnoses, medications, prescriptions, Care Plan tasks, or provider identities. Phase I has not started.

## Architecture

- Reuses `public.clinical_documents`, introduced by the existing clinical document foundation, instead of creating a parallel patient document model.
- Adds a separate private `medical-documents` Storage bucket for patient uploads. The existing `clinical-documents` bucket and its established data remain distinct.
- Adds `public.record_my_medical_document(...)`, a `SECURITY DEFINER` RPC that derives the patient and uploader from `auth.uid()`. It accepts no patient or uploader ID and only records a matching object already present in the private bucket.
- Adds the `medical-document-intake` Edge Function for authenticated upload/removal operations. It verifies the authenticated user and active patient identity, checks that the bucket is private, validates file content and metadata, and uses the service role only on the server.
- Adds a patient Medical Documents page with document type, optional title/date, camera/photo/file selection, upload state, list, view/download, and confirmed removal actions.
- Adds read-only document links to the existing Family health and relationship-scoped Provider patient views. Those reads use existing `can_access_patient(..., 'clinical')` authorization and Storage RLS; no new Family scope or provider reach was added.

## Database changes

Forward-only migration: `20261006140000_patient_medical_document_intake.sql`.

It extends `clinical_documents` with original filename, bucket, source, active/removed lifecycle state, update/removal timestamps, constraints, and a patient upload index. Existing metadata defaults to the existing clinical-record source, existing clinical bucket, and active status. The clinical document metadata read policy now hides removed rows. Direct browser metadata writes remain revoked; authenticated users retain read access under RLS, and the service role retains server-side table access.

The new RPC permits only supported document types, a safe filename, matching extension/MIME type, a nonempty file no larger than 10 MiB, a valid optional date, a patient/document-bound randomized path, and an existing object in `medical-documents`. It records `patient_upload` and uploader identity itself. The RPC is executable by `authenticated`, not `anon` or `PUBLIC`.

The migration was replayed in the focused PGlite integration suite after the existing clinical-document foundation and seeded legacy rows. This was a relevant isolated replay, not a full repository migration-history replay. The migration has **not** been applied to Staging.

## Storage design and upload flow

The provisioning script creates or verifies `medical-documents` as private, with a 10 MiB size limit and PDF/JPEG/PNG allowlist. It refuses a public or incompatible existing bucket. Browser roles are denied direct writes and deletes by restrictive policies; Edge code performs Storage operations.

Allowed extensions are PDF, JPG, JPEG, and PNG. Both file signature and declared MIME/extension are checked. Object paths are randomized and scoped as patient UUID / document UUID / generated filename. The original filename is kept only in metadata. The upload flow writes the Storage object first, then calls the owner-bound metadata RPC. If metadata creation fails, the Edge Function removes the uploaded object and reports cleanup failure distinctly if cleanup cannot be confirmed.

The Edge Function responds to OPTIONS and limits allowed origins through `MEDICAL_DOCUMENT_ALLOWED_ORIGINS`. Localhost origins are defaults for local development. Before Staging use, configure the actual Staging frontend origin and deploy the function.

## Document lifecycle and removal

Active patient uploads appear in the patient list. View/download first re-reads the active metadata row under the signed-in user's RLS context, then requests a 60-second signed URL from the private bucket. Removal requires an authenticated active patient, and the selected row must belong to that user's patient and uploader identity and have `source = patient_upload` and `status = active`.

Storage and Postgres cannot share a transaction. Removal therefore downloads a temporary in-memory copy, removes the Storage object, marks the metadata row removed, then verifies both outcomes. If metadata update fails after Storage removal, it attempts to restore the object and retain the active row. If restoration or final verification fails, it returns an explicit partial-operation error and does not report success. Removed rows are hidden by RLS and list queries. No browser-side metadata-only delete path is provided.

## Access boundaries

- **Patient:** identity is resolved through `auth.uid()` and the active patient/profile relationship. A browser-supplied patient ID is not accepted by upload or removal.
- **Family:** document reads follow the existing records authorization as resolved by `can_access_patient(..., 'clinical')`; access is read-only. No Family upload or removal path was added.
- **Provider:** document reads use the existing current provider-patient authorization helper through RLS. Verification alone does not grant access; unrelated patients remain outside the provider's authorized rows.
- **Anonymous users:** no medical-bucket read/write/delete policy permits access. Bucket privacy remains an explicit deployment precondition.
- **Admin:** no new admin-wide document browse capability is introduced.

The Storage read policies require a matching active metadata row and the same existing patient access helper. Restrictive policies prevent broader permissive Storage policies from overriding those requirements for this bucket.

## Provenance and clinical authority

Metadata preserves patient ID, uploader profile ID, original filename, MIME type, byte size, document type, optional document date, bucket-relative path, and server creation time. The object path stores neither a public URL nor a signed URL. Source is server-set to `patient_upload`. No text extraction or clinical write is performed; document upload does not create or update conditions, medications, prescriptions, schedules, Care Plans, or verification state.

## Verification

- Focused Phase H suites: **70 tests passed** across 7 files during initial validation.
- Expanded regression suites: **506 tests passed** across 47 files. Coverage included auth/session and registration, consent, onboarding, reported health, Family, Provider applications/workspace, Care Plans, Phase G routing, document validation/storage contracts, owner-bound service behavior, document UI, and focused migration replay.
- Production build: **PASS**. Vite emitted its existing warning that the main minified JavaScript chunk exceeds 500 kB.
- `git diff --check`: **PASS**. Git printed line-ending conversion notices only.
- Edge Function Deno type-check: **NOT RUN** because Deno is not installed in the environment.
- Browser camera/file-picker behavior and real Storage API behavior: **NOT hosted-verified**.

## Known limitations and deployment requirements

The Staging database migration, bucket provisioning script, and Edge Function have not been deployed. Consequently, this local implementation does not establish that the Staging bucket is private, a real signed URL expires after 60 seconds, a direct public URL is denied, or a hosted upload/removal succeeds. Those checks require applying only the Phase H migration, provisioning/verifying the private bucket, deploying `medical-document-intake`, configuring the allowed Staging origin, and running a hosted smoke test. No database reset, migration push, or hosted data operation was performed as part of this implementation.

## Phase H UX follow-up

The Medical Documents page now offers only **Choose Photo** and **Choose File**; camera capture controls and `capture` attributes are removed. The patient page calls `listMine(profileId)` and never sends a patient ID for listing or signed URL generation. The backend RLS check remains authoritative, and upload/removal identity remains server-derived. Provider views retain their existing selected-patient filter, with the existing relationship RLS check.

View now requests an inline signed URL; Download requests a signed URL with download disposition. The page opens a blank tab synchronously from the click, removes the opener reference, and navigates to the signed URL after it is returned to avoid popup blockers. Listing has a 15-second abort, signed URL creation a 15-second UI timeout, and Edge upload/removal a 60-second abortable invocation timeout. A synchronous UI lock plus disabled controls prevents repeated upload/removal submissions while an operation is in progress.

The open local browser is connected to project ref `xyprybspwrtthvhnumdp`. Its current page displays the retryable “We could not load your medical documents” state. The known deployment state is that the Phase H migration is not yet on Staging, while the list request selects columns introduced by that migration. This is the leading explanation for the load failure. The browser inspection did not expose the Network panel, so the raw PostgREST status/error was not captured. No file was uploaded or removed during this UX audit.

The upload request path is: browser multipart POST to `medical-document-intake` → server validates authenticated patient and file → private `medical-documents` Storage upload → authenticated `record_my_medical_document` RPC records owner-bound metadata. Listing is a PostgREST select of active `patient_upload` rows (the patient list additionally filters by the authenticated profile's own uploader ID), protected by RLS. View/Download first re-read the metadata row under RLS, then request a 60-second signed URL. Removal is a JSON POST to `medical-document-intake` → owner-bound row lookup → Storage removal → metadata soft-removal → verification/compensation. Metadata path and Storage object path are the same value.

Follow-up focused validation: **136 tests passed across 15 files**, including Medical Documents page/service, document storage/removal operations, Phase H migration replay, AuthContext/AuthService/route guards, Family document access, and Provider document access. The Vite build and `git diff --check` pass. The main JavaScript bundle size warning remains.

## Phase I readiness

**Not ready to start Phase I hosted work yet.** First deploy and verify the Phase H migration, bucket, Edge Function, signed URL expiry and denial boundaries, supported PDF/image upload, authorized Family/provider reads, and compensating removal behavior on Staging. Phase H intentionally contains no extraction or clinical interpretation foundation beyond source-preserving metadata.

## Staging deployment preflight — 2026-10-06

Target confirmed from the linked Supabase project: **EasyCare Staging, `xyprybspwrtthvhnumdp`**.

Read-only Staging preflight found:

- `public.patients`, `public.profiles`, `storage.objects`, `storage.buckets`, and `public.can_access_patient(uuid,text)` exist.
- **`public.clinical_documents` is missing.** Its metadata columns, policies, and existing clinical-document Storage policies are therefore also absent.
- The migration history query returned no rows for `20260929130000` (clinical document foundation) or `20261006140000` (Phase H).
- No `medical-documents` bucket exists.
- `record_my_medical_document(...)` is absent, as expected before Phase H.

The Phase H migration alters `public.clinical_documents` and drops/recreates its existing policies, so the missing table is a hard prerequisite failure. Per the deployment instructions, work stopped here. No migration, migration-history repair, bucket provisioning, Edge Function deployment, or Staging data operation was performed. The current Medical Documents page error is explained by the absent table; the app's raw browser Network status was not captured.

**Staging deployment status: BLOCKED.** Restore and verify the canonical clinical-document foundation before retrying Phase H. Do not mark either migration applied based on this failed preflight.

## Clinical-document foundation reconciliation — 2026-10-06

The complete source for `20260929130000_clinical_documents.sql` was reviewed. It creates one metadata table, `public.clinical_documents`, with UUID primary key/default, required patient/uploader IDs, nullable encounter ID, document type/title/description, Storage path, MIME type, byte size, optional document date, and server creation timestamp. It adds patient, uploader, and composite encounter/patient foreign keys; type/title/path/MIME/size/date/timestamp checks; and patient-created, encounter, and uploader indexes. It defines no enum, function, or trigger. It enables table RLS, adds one authenticated read policy using `can_access_patient(patient_id, 'clinical')`, grants authenticated SELECT and service-role table access, and revokes browser write privileges. For Storage it adds six policies: a metadata-bound authenticated read policy and restrictive guards for authenticated read, anonymous read, insert, update, and delete. It requires RLS on `storage.objects`; an existing `clinical-documents` bucket must not be public. It does not create a bucket; private bucket setup is handled separately.

Read-only Staging comparison for `xyprybspwrtthvhnumdp` found the migration's external prerequisites present: `patients`, `profiles`, `providers`, `care_encounters`, Storage `objects`/`buckets`, `can_access_patient`, current provider relationship helpers, Family authorization tables, and current identity/admin helpers. `patients` has `id`, `profile_id`, `auth_user_id`, and `status`; `profiles` has `id`, `role`, and `status`; `providers` has provider type and verification status. The required unique `care_encounters(id, patient_id)` key exists, and Storage object RLS is enabled. The legacy `clinical-documents` bucket and its named policies are absent; absence is allowed by the SQL preflight and is not a migration blocker. `clinical_documents` itself is absent because this is the migration that creates it. No document rows exist to violate new constraints; no existing rows are rewritten. The history entry for `20260929130000` is absent.

The migration does **not** replace `can_access_patient()` or mutate Family, provider, or patient-self authorization helpers. It adds document-only read policies that delegate to the current helper. Staging records both `20261004100000` provider hardening and `20261006110000` authorization reconciliation; read-only checks confirmed the current helper retains patient self-access, current provider relationship checks, Family records scope, separate Care Plan scope, active Family group membership, and verified-provider/active-assignment predicates. No later hardening is required after applying this foundation on the current Staging state.

Local replay was extended through the complete current chain: the pre-hardening migration prefix including `20260929130000`, provider hardening, Family/Care Plan authorization reconciliation, workspace ACL and the intervening provider-application document migration, followed by `20261006140000`. The replay and related Phase H, Family, provider authorization, auth, and patient identity suites passed (**207 tests across 8 selected files in the final replay run**; the preceding broader related run passed 320 tests across 23 files). `git diff --check` passed. The clinical-document foundation is **safe to apply by itself** to Staging; it has not been applied. Afterward, Phase H can proceed only after verifying the new objects and provisioning its own private `medical-documents` bucket. No Staging changes were made.
