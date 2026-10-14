# Clinical documents (Phase 6)

Apply `20260929130000_clinical_documents.sql` after Phase 5. It adds metadata and Storage object policies; it does not upload files or change other buckets. Supabase's managed Storage schema and RLS must be present.

Provision the bucket using `node supabase/scripts/setup_clinical_documents_storage.mjs` with server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The script uses the Storage API, creates a private bucket, accepts an existing private bucket, and refuses an existing public bucket. Do not expose the service key to browsers or make this bucket public.

Trusted upload workflow:
1. Authenticate and authorize the uploader against the target patient; never trust client-supplied patient/uploader identifiers without checking them.
2. Generate a document UUID and a safe filename. Upload using the Storage API with `upsert: false` to `patientUUID/documentUUID/filename` in `clinical-documents`.
3. Insert metadata with that UUID/path, actual MIME type and byte length, and the authenticated uploader's profile ID. An optional encounter must belong to that patient. `document_type` is an extensible lowercase identifier such as `discharge_summary`, `referral`, or `scan`.
4. If metadata insertion fails, clean up the upload through the Storage API. Storage and PostgreSQL writes are not one transaction. Objects without metadata cannot be read by clients.

Patients read their own documents. Existing `can_access_patient(..., 'clinical')` rules also allow verified providers with care relationships, active main admins, and active family authorizations with `can_view_records`. Revoking these relationships blocks subsequent authenticated reads. No browser role can create, alter, or delete document metadata/files. This phase does not add an upload UI or server endpoint.

Download through authenticated Storage requests. Signed URLs remain usable until expiry, so avoid long-lived URLs; never persist them in `storage_path`. The service role bypasses RLS and must enforce authorization before issuing signed URLs. Do not serve clinical files from public buckets.

No FK to managed `storage.objects` is added: upload, replacement, and deletion must use Storage API operations. Trusted code must keep paths, size, and MIME metadata consistent and remove obsolete objects through that API. Tests exercise PostgreSQL constraints and RLS with a minimal Storage schema fixture; actual Storage HTTP/binary transfer requires a deployed Supabase smoke test.
