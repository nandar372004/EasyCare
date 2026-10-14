# Patient Dashboard AI Health Overview

Flow: authenticated database reads → structured health context → deterministic safety checks → existing Guardian model adapter/system safety prompt → Guardian response schema/clinical-output checks → ai_health_summaries → dashboard.

## Authorization and records

The new ai-health-overview Edge Function verifies the bearer token, active patient profile, and patient/profile ownership. The browser supplies only patientId; supplied clinical context or additional request fields are rejected. All context reads use the caller's JWT and RLS, with explicit patient filters. Service credentials are used only for rate limits, cache leases, hidden-fingerprint suppression checks and the summary-save RPC. They are never given to the model or browser.

The context includes latest measurements (with original timestamps), descriptive 30-day vital trends, active conditions/allergies, current medications, recent medication events, recent lab results, recent encounters, upcoming appointment, and active monitoring alerts. Current medication dates use Asia/Yangon. Each source retains its table, record IDs and source timestamps. Sources are capped at 500 rows and mark truncation; truncated or oversized contexts use the safety fallback rather than misleadingly claiming completeness. The context is not a transactionally consistent cross-table snapshot; capture time and query window are recorded.

Trend deltas are descriptive arithmetic, not diagnoses or medical thresholds. Existing critical alert/lab flags, invalid numeric measurements, insufficient/incomplete input and instruction-override text prevent model generation. Historical diagnosis names are not interpreted as current emergency symptoms. No new numeric medical thresholds were introduced.

The gateway reuses createGuardianFallback, guardianResponseSchema, hasUnsafeClinicalOutput, the existing safety system prompt and OpenAI-compatible adapter. The model has no tools or database access. Its output is validated before persistence; unsafe/invalid output and timeouts use the static fallback. Guidance remains non-diagnostic and requires clinician review. These guardrails do not constitute clinical validation of generated content.

Only the derived summary table and operational lease/rate-limit tables are written. patient_conditions and all other clinical tables remain unchanged. The save RPC cannot accept a model-supplied patient ID, reviewer, table name or clinical mutation. New summaries remain review_status=generated. Prior same-period summaries are linked atomically through superseded_by_id, preserving their provenance.

## Cache and provenance

Every request rebuilds the authorized context before cache lookup so changed recorded data invalidates the cache. SHA-256 covers the deterministic context plus context/redaction/policy/prompt versions and configured provider/model identifiers. Volatile captured_at/query_window metadata is stored but excluded from this hash to avoid invalidating unchanged data on every refresh. Original authorized source JSON is retained; model-bound strings use existing email/phone/identifier redaction. No raw context, prompts or provider output are logged.

Successful model summaries expire after six hours; safety fallbacks after ten minutes. A patient-scoped 90-second database lease prevents duplicate workers; a two-minute retry cooldown also limits repeated failed requests. Stale lease tokens cannot save. Pending requests return safe fallback advice instead of regenerating or showing a stale summary. Hidden summaries with the same fingerprint are not automatically regenerated. User request rate is limited to 60 per 15 minutes using a new service-only database request limiter. The legacy consume_auth_rate_limit RPC is absent from the migration chain and is not a dependency of this endpoint.

Provider/model identifiers record attempted generation even if validation/provider failure produces a fallback. model_version remains NULL because the existing adapter does not expose a verified resolved provider model version. When the model is not called, model_name is not_called. Overall status identifies model/fallback provenance, not a clinical health grade.

The dashboard shows the persisted generation timestamp in Asia/Yangon, labels fallback versus model output, and states that the overview is derived information rather than a diagnosis. It invokes once per patient mount, with caching enforced server-side across refreshes/devices. Missing deployment/configuration, rate limits or source failures show the existing safe fallback without fabricating health information. Old patient responses are discarded on account changes.

## Deployment

Apply 20260929170000_ai_overview_cache.sql after the previous phases, then deploy ai-health-overview with JWT verification enabled. Required runtime configuration: Supabase URL/anon/service-role credentials and AI_ALLOWED_ORIGINS. Model generation additionally requires AI_PROVIDER_API_KEY, AI_PROVIDER_URL, AI_MODEL_NAME and AI_GUARDIAN_POLICY_VERSION; AI_PROVIDER_NAME is optional (defaults to endpoint hostname). Missing model configuration uses a cached safety fallback; missing database/auth/rate-limit configuration cannot generate or persist a summary.

Do not expose provider/service credentials in VITE variables. No hosted migration, function deployment or live provider call was performed during implementation.

Integration tests execute the migration chain, context SELECTs and cache/save RPCs against isolated PostgreSQL with real RLS. Managed Auth identity and the external model are simulated; the Edge HTTP/CORS/runtime boundary still needs a deployed smoke test. Tests cover provenance, source changes/expiry, cache reuse, leases, authorization, read failures, unsafe/invalid output, timeouts, clinical-record preservation and dashboard rendering.
