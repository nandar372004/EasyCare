# Phase 9 AI health summary model

AI summaries are derived information, not authoritative clinical records. This migration does not generate summaries, implement medical rules, send notifications, or insert AI conclusions into patient_conditions. No generation/application code changes are included.

The existing id, patient_id, period_start, period_end, summary_type, summary_text, source_snapshot, review_status, and created_at columns remain. Daily/weekly summary types and generated/reviewed/hidden review statuses are unchanged.

Added fields:

| Fields | Type / contract |
| --- | --- |
| overall_status | Optional nonblank descriptive text; no invented medical classification |
| things_to_watch, recommended_actions | Optional JSONB arrays; new rows default to empty arrays |
| urgency_level | Existing care_urgency enum: unassessed, routine, urgent, emergency; new rows default to unassessed |
| source_data_hash | Optional lowercase 64-character SHA-256 digest; requires a non-null snapshot |
| model_provider, model_name, model_version, prompt_version | Optional nonblank provenance identifiers |
| generated_at | Finite timestamp; defaults to statement time for new rows |
| expires_at | Optional finite timestamp after generated_at |
| reviewed_by_profile_id, reviewed_at | Optional paired reviewer FK/timestamp; supplied metadata requires reviewed/hidden status and a timestamp no earlier than generation |
| superseded_by_id | Optional same-patient successor FK; cannot reference itself |

All new columns remain nullable for compatibility. Existing finite created_at values provide the historical generated_at fallback. Existing source snapshots and summary text are preserved exactly; unknown hashes, model identifiers, and review attribution remain NULL. Previously reviewed summaries need not acquire invented reviewer details.

Producers must preserve the patient-scoped generation inputs, source record IDs/times, model identifiers and prompt version. The database checks digest format, not correspondence to the snapshot; future generation code must define canonical serialization and validate the digest. Existing arbitrary source_snapshot JSON remains valid for compatibility. The database cannot determine whether a JSON payload contains another patient's data, so trusted producers must validate that boundary.

Authenticated clients retain the existing can_access_patient(patient_id, 'clinical') read policy and hidden-summary exclusion. This includes authorized family/clinical access, not unrestricted cross-patient reads. Anonymous users have no access. Browser clients cannot insert, update, delete, or assign a review. Service code can insert/update; DELETE/TRUNCATE privileges are withheld to discourage loss of historical summaries. Service code bypasses RLS and must validate authorization and provenance itself.

Supersession retains old rows and their snapshots. The original all-history period uniqueness is replaced by a partial unique index permitting one unsuperseded row per patient/type/period. To create a replacement for the same period, trusted code must use one transaction:

1. Generate the new UUID and defer ai_summaries_superseded_patient_fk.
2. Set the old row's superseded_by_id to that UUID.
3. Insert the replacement row, including its own snapshot/model/prompt provenance.
4. Commit (or force the deferred constraint immediate before commit).

A missing or cross-patient successor fails FK validation. Do not rewrite old generated content or form circular supersession chains; beyond direct self-reference, chain acyclicity is a trusted-producer responsibility. The service retains UPDATE for review/supersession, so historical payload immutability is not database-enforced. Existing source content is not automatically copied into replacements.

Consumers seeking a current summary should filter superseded_by_id IS NULL and (expires_at IS NULL OR expires_at > now()). Expired/superseded history remains readable under existing RLS; expiry is freshness metadata, not a new access restriction. Existing clients using ON CONFLICT with the old four-column unique constraint will need a predicate-aware conflict target or the replacement transaction before adopting revisions; no such usage was found in this repository.

Indexes cover current-period uniqueness, patient/generated time, supersession FK lookup, and reviewer FK lookup. The existing patient FK and period_end > period_start check remain.

Tests apply the real migration chain to isolated PostgreSQL with simulated managed Auth/Storage schemas. Hosted migration application and generation-service integration are separate deployment work.
