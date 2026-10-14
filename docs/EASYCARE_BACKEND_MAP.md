# EasyCare backend, services and deployment current-state map

Inspected 2026-10-03. Companion to [primary handoff](EASYCARE_CURRENT_STATE_HANDOFF.md). This is runtime tracing, not a deployment claim or implementation instruction. Environment variable **names only** are documented.

## 1. What the backend is

The app has no Express/Node REST server, NestJS, Django, FastAPI or independent application server. Vite is a development/build server. Production-facing backend code is Supabase Auth/PostgREST/PostgreSQL RPC/RLS plus **three Deno Edge Functions**. Trusted local scripts perform provisioning/validation when explicitly run. React often calls PostgREST directly through repositories rather than through an Edge endpoint.

Browser `src/lib/supabase.js` reads VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, validates URL/key and rejects service-role/secret-like browser keys. Configured client has persistSession=true, autoRefreshToken=true, detectSessionInUrl=false. Missing/invalid settings yield null client and fixture configuration, surfaced by DevelopmentConfigNotice. This is not a production API health check.

Real user clients carry the Auth session and rely on database RLS. AI functions build a user-scoped client from incoming Authorization plus a separate admin client. Clinical overview context uses the user client; service client is limited in architecture to limiter/lease/summary persistence and suppression checks after authorization. Registration uses service-role Auth Admin/RPC because callers do not yet have an account.

## 2. Application service inventory

| Service / exported methods | Inputs → output | Calls / consumer | Current state |
|---|---|---|---|
| authService: loadAuthorizedPatient | auth UUID → active patient or null | patients.auth_user_id; AuthContext | Real |
| authService: signInPatient | phone/password → session/user/patient | deriveInternalEmail, Auth signInWithPassword, patient lookup | Real; generic login errors |
| authService: signOutPatient | client → completion | Auth signOut local; context/header/settings | Real |
| registrationService: submitRegistration | form → validation errors or normalized non-password payload | Zod registrationSchema; RegisterPage | Local validation only |
| registrationService: registerPatient | form → success/error result | patient-register invoke, mapped errors; RegisterPage | Real backend path, no returned session |
| bookingService | booking objects/time → validity/errors; code/key generators; eligibility predicates | DoctorsPage, AppointmentsPage, fixtureRepository | Local business/form utility, not payment/API server |
| patientDashboardService | patient ID / metric / period → repository data | wraps D methods; named API available | Real read API; many exports not currently used by dashboard page |
| dashboardPageService: loadDashboardPage | patient ID → overview/appointment/medications/providers/plans statuses | D + appointment events/provider enrichment; DashboardPage | Real, per-section allSettled; missing events dependency isolated |
| aiHealthOverviewService: getAIHealthOverview | patient ID → summary/cache flag or safe fallback | ai-health-overview invoke; AIHealthOverview.jsx | Real conditional path; validates patient/visibility/time/actions |
| guardianGatewayService: requestGuardianGuidance | message/language → validated guidance | client screening, ai-health-guardian invoke with conversation=[]; HealthGuardianPage | Missing server limiter; safe local fallback; prototype skips Edge |
| passwordResetDemoService | phone/code/password → local validation/challenge state | three recovery screens | Deliberate simulation, no Auth/network/storage mutation |

bookingService exports BookingConflictError, AppointmentLifecycleError, validateBooking, isSlotCompatible, isFutureEligibleAppointment, canJoinWaitingRoom, createBookingCode/createIdempotencyKey. Its ACTIVE_APPOINTMENT_STATUSES includes presentation-only checked_in/in_progress absent from current SQL. No adherence, notifications, family, payment gateway, upload or clinical authoring service exists.

## 3. Repository inventory and method contracts

`repositories/index.js` chooses createSupabaseRepository or createFixtureRepository. The misleading presentationRepository variable name does not determine the data source. Explicit prototype selects persistent fixtures. R below is supabaseRepository.js, D is patientDashboardRepository.js.

| Method | Table/RPC | Consumer | Compatibility |
|---|---|---|---|
| R getPatient | patients | Adapter API | Current fields exist; direct UI use not found |
| R getPatientProfile/updatePatientProfile | patients, id + auth_user_id filters | PatientSettingsPage | Current schema, authorized column writes |
| R listDoctors/getDoctor | providers/provider_specialties/specialties | discovery, consultation, search, appointments | Current; doctor/verified filter and RLS |
| R listAvailabilitySlots | provider_availability | discovery/booking, fixture-only reschedule panel | Current; available status, optional provider filter |
| R listAppointments/getAppointment | appointments with explicit provider FK join | list/detail/search/waiting room | Current; get/list can filter patient; RLS required regardless |
| R createAppointment | appointments INSERT | BookingForm | Current payload; price excluded; DB derives it |
| R listAppointmentEvents | appointment_events | dashboard; detail fixture path | **Missing table**; no automatic visit_status_events substitution |
| R rescheduleAppointment | patient_reschedule_appointment | Real adapter, UI guarded off in real mode | **Missing RPC** |
| R cancelAppointment | patient_cancel_appointment | Real adapter, UI guarded off in real mode | **Missing RPC** |
| R listMedications | patient_medications nested medication_schedules | MedicationsPage, GlobalSearch | Current read model; validates UUID; maps UI names |
| R getHealthSummary | delegates D getLatestAIHealthSummary | Adapter API | Corrected existing summary source, not health_summaries |
| R listPrescriptions | prescriptions | Adapter API, fixture screen not connected | Table exists; no complete real viewer |
| R listLabResults | lab_results | Adapter API, fixture screen not connected | Table exists |
| R listHospitals | hospitals | Discovery only when rows synthetic | **Missing table** in real adapter |
| R listMessages | messages | Unused by current MessagesPage | **Missing table** |
| R listInvoices | invoices | Unused by current PaymentsPage | **Missing table** |
| R listNearbyFacilities | nearby_facilities | Unused by current Location page | **Missing table** |
| R reset | None | No real reset flow | Explicitly throws; remote reset unsupported |
| D getDashboardOverview | patients, health_profiles, allergies, conditions | dashboardPageService | Current real data, active health records |
| D getDashboardProviders/getDashboardAppointmentProvider | providers/specialties | dashboardPageService | Current; directory subset not AI ranking |
| D getActiveCarePlans | subscriptions joined care_packages | dashboardPageService | Current schema; semantic commercial/clinical mismatch |
| D getLatestVitals | vital_readings per metric | patientDashboardService, aggregate API | Current; not called by dashboardPageService |
| D getVitalHistory | vital_readings patient/type/period | patientDashboardService | Current; no trend screen |
| D getTodayMedications | courses/schedules/events | dashboardPageService | Current read-only recurrence/timezone composition |
| D getNextAppointment | appointments | dashboardPageService | Current, future pending/confirmed |
| D getActiveAlerts | monitoring_alerts | aggregate/read API | Current; no dedicated dashboard card |
| D getRecentHealthRecords | encounters/documents/history | aggregate/read API | Current merged records; not HealthRecordsPage source |
| D getRecentLabResults | lab_results | aggregate/read API | Current preliminary/final/corrected, bounded recent list |
| D getLatestAIHealthSummary | ai_health_summaries | aggregate/R summary API | Current visible/nonfuture/unexpired/unsuperseded query |
| D getPatientDashboard | all above + profile and 30-day vitals/current meds | patientDashboardService | Available aggregate API; actual DashboardPage uses smaller composition |

D rows become camelCase; nested clinical JSON remains intact. Vital semantic aliases map to actual spo2/temperature_c/glucose_mg_dl. Patient ID validation/filtering is not authorization; RLS remains mandatory. Real adapter throws rather than silently substituting fixtures on query failure. FixtureRepository mirrors presentation methods and simulates lifecycle/conflicts/local persistence; it is not a database migration specification.

## 4. Authentication transaction boundaries

1. RegisterPage uses frontend Zod validation and maps data via registrationService. Password is supplied only to the Edge invocation and cleared after success/failure handling; it is not manually persisted by application code.
2. patient-register validates method/origin/config, hashes a forwarded-address key with AUTH_RATE_LIMIT_PEPPER and applies an **in-memory per-isolate** rate window (5/15 minutes). It validates JSON with server Zod, normalizes phone and derives internal email using shared phone identity logic.
3. A service client checks patients.primary_phone for duplicate, creates managed Auth user with email_confirm=true, then invokes create_patient_registration. No SMS verification is performed. The RPC inserts profile/patient/consents atomically; Auth creation is outside that transaction.
4. On persistence failure registration-core attempts Auth-user cleanup. Failed cleanup remains an operational failure to inspect, not a proof of cross-service atomicity.
5. Response reports success; frontend separately signs in with original phone/password. If login fails after registration, account creation may still have succeeded; RegisterPage stays on the form and displays a message instructing the user to sign in. It does not automatically navigate to login on that failure.
6. authService derives the same internal email, uses Auth signInWithPassword, resolves patients.auth_user_id, requires active status, and signs out locally if unresolved.
7. AuthProvider restores SDK session, subscribes to Auth events, rejects stale hydration and exposes state to guards. Logout is local scope; remember-me UI does not change persistence configuration.

Profile role handling is mostly backend. Patient AuthContext does not provide a clinician/family/admin session product; it expects a patient row. auth.uid() is the Auth/profile UUID, not patients.id or providers.id. Identity equality and legacy auth_user_id compatibility are detailed in the DB handoff. Family delegation is SQL infrastructure, not registration of households/dependents.

## 5. All deployable Edge Functions

| Function | Caller / authentication | Input / output | DB/external calls | State and known problem |
|---|---|---|---|---|
| patient-register | registrationService; public endpoint, config verify_jwt=false; origin/method/schema checks | password + account/profile/emergencyContact/medicalProfile/consent → success or generic/error result | patients phone lookup; Auth Admin create/delete; create_patient_registration | Real code; isolate limiter; hosted execution unverified |
| ai-health-overview | aiHealthOverviewService; verify_jwt=true plus getUser/profile active patient and own patient check | exactly `{patientId}` → summary/cached or hidden/pending/fallback/error | user-scoped context reads; summary reads; consume_ai_overview_request/claim_ai_overview/save_ai_overview service RPCs; optional model HTTP | Complete architecture, local tests; no live model/deployment certification |
| ai-health-guardian | guardianGatewayService; verify_jwt=true plus bearer/profile active patient | message/language/conversation contract → data + metadata or structured error | profiles read; **consume_auth_rate_limit** twice (user/IP); model HTTP | Missing RPC in current migrations blocks configured model request before generation; client safety fallback remains |

No other Edge endpoint exists. `_shared` holds:

- registration-core.ts: server registration schema and create/persist/cleanup orchestration.
- phone-identity.ts: phone normalization and deterministic internal email derivation.
- health-context.ts: user-scoped overview data assembly, limits/truncation and trends.
- health-overview.ts: ownership/rate/cache/lease/safety/generation/save flow.
- guardian-contract.ts: input/output schemas, deterministic screening, redaction and unsafe-output checks.
- guardian-gateway.ts: identity/limiter/safety/model timeout/validation.
- guardian-provider.ts: configurable OpenAI-compatible adapter and strict JSON schema.

`supabase/functions/deno.json` maps SDK 2.109.0 and Zod 4.0.17. Vite aliases the npm:zod import to browser-installed Zod 4.4.3 in tests, so test runtime is not identical to deployed Deno dependency resolution.

## 6. AI Health Overview end to end

AIHealthOverview.jsx invokes on patient identity changes. Service rejects returned records with wrong patient, hidden/superseded state, invalid/future generation time, expired/nonfinite expiry or malformed summary/actions, and supplies safe fallback on failures. Component shows derived-not-diagnosis disclaimer and generated time. Browser refresh may make an endpoint request, but does not necessarily regenerate a model summary.

Server requires active patient profile and patients.profile_id equal caller. It consumes overview request budget before context/cache lookup. Clinical reads use the caller's JWT; admin client cannot be substituted for context authorization.

Verified context sources and exact meaning:

| Source | Included data |
|---|---|
| vital_readings | Latest non-null value per metric even outside window; 30-day recorded measurements, actual timestamps and source_type |
| patient_conditions | Active name/status/severity/onset |
| patient_allergies | Active allergen/reaction/severity/status |
| patient_medications | Active/date-valid name/dose/frequency/start/end |
| medication_events | 30-day schedule ID/time/status/confirmed_at |
| medication_schedules | IDs and medication links for context courses |
| lab_results | Recent preliminary/final/corrected values/units/ranges/flags/verification |
| care_encounters | Recent type/status/chief complaint/assessment/care_plan text/timestamps |
| appointments | Future pending/confirmed type/time; upcoming selected |
| monitoring_alerts | Active alert type/severity/message/status/detection/source metadata |

Sources are bounded at 500 with an extra row to detect truncation; patient fields are checked. No household data, profile contact fields, binary document files or unrelated patient context is intentionally queried. UUIDs remain in context/provenance; recursive string redaction is not certified anonymization.

Safety rejects nonfinite measurements, oversized context, truncation, empty records, existing critical alert/lab flags and detected instruction-injection phrases. Trends are arithmetic descriptions, not newly approved medical threshold rules. Model prompt forbids diagnoses/new conditions/medication changes/clinical writes. Shared response schema plus unsafe-output checks and alert/risk consistency filter output. Failure yields a safe fallback, not fabricated health facts.

Persistence: source hash binds context/version/redaction/policy/prompt/model identifiers. Same-source visible current cache is reused; hidden matching summary suppresses regeneration. Lease token prevents stale worker save. RPCs write only operational cache state and ai_health_summaries, never conditions or prescriptions. Model summaries expire in **6 hours**; fallbacks in **10 minutes**. Request budget **60/15 minutes**, lease **90 seconds**, retry cooldown **2 minutes**. Source snapshots retain provenance and exact query window; superseded summaries remain history. No new summary table or cache should be created accidentally.

## 7. AI Health Guardian end to end

HealthGuardianPage passes current typed message/language; service explicitly supplies `conversation: []`. Client guardianSafety screens red flags/unsafe requests and validates output. Prototype/no-client paths return deterministic guidance without network. With client, Edge invocation occurs; service returns safe/deterministic fallback on errors.

Edge verifies active patient profile, calls missing consume_auth_rate_limit for user/IP before model, validates payload, runs deterministic safety, then model timeout/response checks. Guardian model content is **redacted language/message/conversation only**, not vitals/medications/labs/encounters. Default timeout **8 seconds**. Response includes sourceMode, riskLevel, summary, guidance, specialty suggestion, redFlags, disclaimer, allowed actions and review flag. No durable ai_interactions or conversation insert occurs. UI stores one scenario in React state. AI interaction enum values symptom_screening/provider_matching are not implemented workflows by themselves.

Both AI paths reuse guardian-provider.ts: POST to configured endpoint with Authorization, model, system/user messages, strict JSON response_format, max_tokens=700 and temperature=0; reads choices[0].message.content then JSON parses. Provider brand/model/version cannot be inferred from the adapter name. No live external request was made for this report.

## 8. Database and Storage in application context

Use [DB handoff](../supabase/database-v2-handoff.md) for all 48 table classifications and [schema map](../supabase/database-v2-schema-map.md) for exact SQL. Active app tables include identities/directory/slots/appointments/patient medications, health overview records and AI cache. Partial use includes labs/documents/encounters/subscriptions. Family/coordinator/clinical authoring/payment/notification infrastructure is mostly database-only. patients.auth_user_id and care_preferences remain intentional compatibility mechanisms. Security Repairs 1–15 are frozen.

Clinical documents: actual content belongs in private `clinical-documents` Storage; PostgreSQL stores metadata/path, MIME, size, date, uploader and patient/optional encounter. Required path is patientUUID/documentUUID/filename. Storage read policies consult authorized metadata; restrictive policies block ordinary client insert/update/delete and anonymous document access. No binary in PostgreSQL, no FK to managed Storage objects, no automatic upload transaction. Trusted code must reconcile metadata and file lifecycle.

`supabase/scripts/setup_clinical_documents_storage.mjs` uses service-role Storage API to inspect/create the private bucket, refuses a public bucket, and needs SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY. It is **not** a document upload service and was not executed. No frontend storage.upload/download/createSignedUrl path was found. Legacy medical_history_items.document_url and provider credential document_url fields do not constitute a secure file workflow.

## 9. Configuration names and absence behavior

No values or secrets are included. Existence of a variable name in an env file does not establish valid deployment configuration.

| Name | Reader / responsibility | Missing behavior |
|---|---|---|
| VITE_SUPABASE_URL | Browser Supabase client | null client/fixture configuration |
| VITE_SUPABASE_PUBLISHABLE_KEY | Browser Supabase client | same; secret/service-like values rejected |
| VITE_HACKATHON_PROTOTYPE | prototypeMode.js | defaults off unless exact true string |
| VITE_SUPABASE_ANON_KEY | `.env.test` key name | **Not consumed by current browser client**; legacy name, not equivalent to publishable key reader |
| SUPABASE_URL | Three Edge Functions, Storage script | registration config error; AI unavailable/error |
| SUPABASE_ANON_KEY | AI user-scoped clients | AI configuration/runtime failure |
| SUPABASE_SERVICE_ROLE_KEY | Edge admin clients, trusted Storage script | registration/AI/provisioning unavailable; never a VITE variable |
| ALLOWED_ORIGINS | patient-register CORS | local loopback defaults; loopback development origins specially allowed |
| AUTH_RATE_LIMIT_PEPPER | patient-register address hashing | registration returns configuration failure |
| AI_ALLOWED_ORIGINS | AI endpoints CORS | loopback defaults; deployed origin must be allowed |
| AI_RATE_LIMIT_PEPPER | Guardian user/IP limiter hashing | Guardian configuration failure |
| AI_PROVIDER_API_KEY | model adapter | Guardian configuration failure; Overview uses safety fallback when model absent |
| AI_MODEL_NAME | configured model | same model dependency behavior |
| AI_PROVIDER_URL | model HTTP endpoint | same; no hardcoded provider assumed |
| AI_GUARDIAN_POLICY_VERSION | shared prompt/policy provenance | Guardian configuration failure; Overview marks not_configured/fallback |
| AI_PROVIDER_NAME | Overview provenance label | derives from endpoint hostname if available, otherwise not_configured |

`.env.example` and `.env.local` define the browser URL/publishable-key names; `.env.test` defines URL and legacy anon-key name. Values were not disclosed. No secret-validity check, token dump, connected account query or deployment action was performed.

## 10. Error handling and silent fallbacks

Registration maps backend errors to field/generic/config/network messages. R unwrap hides raw database details behind generic repository errors; D preserves an error code with a generic dashboard message. Booking maps unique/exclusion conflicts and permission errors, refreshes slots and does not fabricate success on error. dashboardPageService isolates section failures. AI services convert unavailable/unsafe responses to safe fallbacks. Edge endpoints enforce methods/origins, validate payloads and return controlled error statuses; registration includes operational stage logging.

Not all errors are surfaced equally: GlobalSearch catches without showing a failure; WaitingRoomGate initial async call lacks rejection handling; header logout navigation does not await signOut; fixture repository corruption falls back to synthetic defaults. The config notice and demo banners help distinguish simulation but cannot make screenshots prove data provenance.

## 11. Tests and deployment

Current test architecture and counts are in the primary handoff and existing DB handoff. Node PGlite tests exercise SQL with simulated Auth/Storage roles; frontend tests inject repositories; AI tests inject model outputs; no real external model/Storage/payment/media service is exercised. Test success is not proof that absent RPCs exist: dormant adapters and mocked services can remain unexercised against final hosted schema.

Deployment inventory:

| Artifact/target | Classification | Facts |
|---|---|---|
| Vite static build | CONFIGURED | package scripts, index.html, source/public assets; build not rerun to avoid replacing generated dist |
| Vercel | CONFIGURED partially / NOT VERIFIED | vercel.json SPA rewrite only, no deployment evidence |
| Cloudflare Pages/Workers | NOT CONFIGURED in main checkout | no wrangler config, Worker entrypoint or Cloudflare pipeline found; hosting outside repo UNKNOWN |
| Supabase DB | PARTIAL / NOT VERIFIED hosted | 44 migrations, preflight scripts, manual CLI documentation; current hosted migration history/data not inspected |
| Supabase functions | CONFIGURED source / NOT VERIFIED deployment | three entrypoints; config verify_jwt false registration, true AI functions |
| Storage | PARTIAL | private bucket provisioning script and SQL policies; bucket not verified |
| AI external provider | NOT VERIFIED | configurable endpoint/key/model, no live call |
| CI | NOT CONFIGURED in inspected main source | no GitHub Actions/other automated release pipeline found |

README manual procedures mention Supabase linking, migration push, function serving/deploy and secrets configuration. These are documentation, not actions taken. In particular do not run its database reset example against working data. supabase/seed.sql and reset_synthetic_data.sql are legacy synthetic tooling, not verified current provisioning. A Supabase CLI dev dependency now exists, contradicting older notes that the package is absent; no CLI authentication or remote operation was attempted.

## 12. Operational/product gaps, without redesign

No production password recovery, durable distributed registration throttle, clinician/coordinator/family app, request matching service, media session provider, reminder sender, message transport, payment gateway/webhook, private file workflow, normalized clinical plan/task progress, goals/devices or durable family-aware AI conversation implementation is present. Existing tables and RPCs should be reused under a separate scoped command rather than duplicated to make UI labels look complete.

No backend code, migrations, configuration or security was changed for this map.
