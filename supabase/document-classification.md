# Phase I Step 2: document classification boundary

`functions/_shared/document-classification-service.js` exports
`createDocumentClassificationService({ userClient, serviceClient, modelAdapter })`.
This is a server-only boundary with an injected classifier. It does not install an
HTTP endpoint, configure a live AI provider, or start detailed fact extraction.

The server must construct `userClient` with the caller's JWT and `serviceClient`
with its private service-role credential. `modelAdapter` provides trusted
`metadata: { provider, name, version }` and an asynchronous `classify` method.
The adapter receives bounded source bytes, MIME type, the source document ID,
classification instructions, and the strict output schema. A future provider
adapter must enforce its own request timeout and return a parsed object.

`classifyForDocument(documentId)` verifies the caller, uses the Step 1 request RPC
to derive patient ownership, reads the active patient upload through RLS, and
downloads through the caller's Storage permissions. Access is checked again
before and after the model call. It validates the output and saves only a
classification candidate using the service-only recording RPC.

The output contains `document_type`, `confidence`, `review_required`,
`source_document_id`, `extraction_id`, `review_status`, `schema_version`, and
`prompt_version`. Every AI classification requires human review, including
confidence at or above 0.8. Ambiguous sources use `other`; unknown categories,
out-of-range confidence, unknown fields, or a substituted source ID are rejected.

The taxonomy reuses Phase H's seven categories and adds `referral` and
`progress_note` only for classification candidates. The upload taxonomy and
`clinical_documents.document_type` are unchanged. Model and prompt/schema
provenance are stored on the ownership-bound extraction run. No detailed facts,
diagnoses, medications, prescriptions, Care Plans, or provider verification are
written. Classification-only runs end in `needs_review` with no summary or facts.

The separate migration is
`20261007110000_document_classification_candidates.sql`. Apply it explicitly
before integrating this boundary into a server endpoint. It has not been
deployed by this implementation. Existing Step 1 callers and RLS remain intact.
Failed classification attempts leave the pending request available for retry;
completed candidate runs cannot be overwritten by the recording RPC.
