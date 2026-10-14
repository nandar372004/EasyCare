# Phase I manual test pipeline

This local-only workflow exercises the existing Phase I classification, candidate-fact, explanation, review, and dashboard boundaries with one deterministic synthetic lab report. It does not invoke a live model, change a clinical truth table, or confirm a candidate automatically.

## Local setup

1. Start the repository's local Supabase stack with the current migrations applied.
2. In the ignored `supabase/functions/.env` file, set `EASYCARE_PHASE_I_TEST_PIPELINE=true` alongside the local Supabase URL, anon key, and service-role key used by local Edge Functions. Keep those values local; never copy the service-role key into Vite/browser settings.
3. Serve the `document-pipeline-test` function locally, supplying that env file. The function also rejects non-local Supabase URLs, even when its test flag is set.
4. Run the website with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` pointed at the same local stack.

The action and sample download are compiled into development/test builds only. The server action also requires the explicit local test flag. Production AI configuration is not read by this path.

## Browser workflow

1. Sign in as an active patient and open Medical Documents.
2. Download **Synthetic Lab Report PDF**, select **Lab Report**, and upload the PDF.
3. On that uploaded row, choose **Process document for testing**. The server verifies the current patient's ownership, active upload status, Lab Report category, and the synthetic PDF marker and source excerpt.
4. Open the dashboard. Health Intelligence should show an HbA1c candidate with value 6.4%, source page 1, confidence, and **AI extracted — review needed**. It is explicitly labelled synthetic and is not a diagnosis.
5. Choose **View related details**. The candidate should open in Lab Results with its fact identifier focused. Choose **View source** to open the private uploaded PDF; the dashboard source link and the document-list focus both retain source-document identity.
6. Choose **Mark reviewed** to confirm a candidate, or upload a second copy of the sample and choose **Not accurate** to reject it. Rejected candidates are removed from active intelligence.

The current Phase I PostgreSQL integration suite verifies that review changes only candidate/review records and leaves conditions, allergies, medications, prescriptions, and prescription items unchanged. The candidate stays separate from those clinical truth tables after confirmation.

## Safety boundaries

- Upload does not start extraction automatically.
- Only the exact synthetic sample text is accepted by the deterministic test adapter. Other PDFs are not sent through this fixture path.
- Classification and fact extraction use the existing server services; persistence uses the existing trusted RPCs; reads use the patient's JWT and RLS; explanations use the existing deterministic explanation contract.
- Every candidate starts as `needs_review`. Classification and explanations retain source document, page, excerpt, confidence, and extraction provenance.
- No SQL migration is needed. No database reset or push is part of this workflow.
