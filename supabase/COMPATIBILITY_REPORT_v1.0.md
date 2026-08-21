# EasyCare database v1.0 compatibility report

Scope: static inspection only. No application code, remote database, or Edge Function was changed or deployed.

| File | Old reference | Database v1.0 correspondence | Required later change | Affected layer |
|---|---|---|---|---|
| `src/services/authService.js` | `profiles.display_name`, `profiles.is_active` | `profiles.full_name`, `profiles.status = 'active'` | Update profile projection and active-state mapping. | Frontend service |
| `src/services/repositories/supabaseRepository.js` | `profiles(display_name)`, `patients.member_code` | `profiles(full_name)`; no `member_code` in the authoritative specification | Map `full_name`; remove or product-define member code before adding it. | Frontend repository |
| Same | Provider fields `name`, `specialty`, `image`, `is_available`, `consultation_fee`, `currency` | Provider identity is joined through `providers.profile_id -> profiles`; specialties are normalized; pricing is in `service_catalog`/`pricing_rules`; availability is in `provider_availability` | Replace flat provider mapping with explicit joins and pricing/availability queries. | Frontend repository |
| Same | `availability_slots`, `starts_at` | `provider_availability`, `start_at`, `end_at`, `status` | Rename query and mapping; include service type and range. | Frontend repository |
| Same | `appointments.slot_id`, `idempotency_key`, `notes`, joined `availability_slots` | `appointments.scheduled_start`, `scheduled_end`, `reason_symptoms`, canonical care request relationship | Rework booking payload/read model. Idempotency is not specified in v1.0 and must be designed before adding. | Frontend repository |
| Same | `appointment_events` | `visit_status_events` | Rename and map `status`, `actor_profile_id`, optional location and notes. | Frontend repository |
| Same | RPCs `patient_reschedule_appointment`, `patient_cancel_appointment` | No RPCs specified | Design transactional v1.0 booking functions after schema approval; do not reuse old RPC contracts silently. | Backend/database |
| Same | `hospitals` | `partner_clinics` is the closest specified directory | Confirm product semantics, then change the read model. | Frontend repository |
| Same | `health_summary` | `ai_health_summaries` plus normalized vitals/conditions | Build a safe presentation query/view after schema approval. | Backend + frontend |
| Same | `medications` | `patient_medications`, `medication_schedules`, `medication_events` | Replace legacy presentation table query with normalized queries/view. | Backend + frontend |
| Same | `prescriptions` | `prescriptions` and `prescription_items` | Add item join and adapt fields. | Frontend repository |
| Same | `lab_results` | None; laboratory scope is explicitly excluded | Remove/disable this repository path when application compatibility work is authorized. | Frontend repository |
| Same | `messages` | No general chat table; only `notifications` is specified | Product decision required; do not reinterpret notifications as two-way messages. | Frontend/backend |
| Same | `invoices` | `payments` is payment state, not an invoice ledger | Product decision required before implementing invoicing. | Frontend/backend |
| Same | `nearby_facilities` | `partner_clinics` is the closest specified table | Confirm intended facility types, then adapt. | Frontend repository |
| `supabase/functions/patient-register/index.ts` | RPC `consume_auth_rate_limit`; RPC `create_patient_registration` with old arguments | Registration is explicitly deferred until schema verification; target flow is Auth -> `profiles` -> `patients` | After approval, implement a transaction-safe registration contract and rate-limit storage without weakening RLS. | Edge Function/database |
| Same | Profile uniqueness check by normalized `phone` | `profiles.phone` has normalized, partial uniqueness | This lookup remains conceptually compatible. | Edge Function |
| `supabase/functions/ai-health-guardian/index.ts` | `profiles.is_active`; RPC `consume_auth_rate_limit` | `profiles.status`; rate-limit function not part of v1.0 | Update status query and design rate limiting after schema approval. Keep AI writes server-side. | Edge Function/database |
| `src/services/registrationService.js` | Invokes `patient-register` | Function name may remain, but its old database RPC contract is incompatible | Update only after the approved registration integration is implemented. | Frontend service/Edge Function |

## Configuration note

The frontend reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. This report does not validate or alter secret values. The local Supabase project reference was verified as `xyprybspwrtthvhnumdp`; no remote command was run.

## Authoritative-document ambiguity

The requested filename `EasyCare_Database_Structure_v1.0(6).docx` was not present. The only matching source found was `EasyCare_Database_Structure_v1.0.docx`, and it was used as the authoritative specification. The document represents several paired fields in one row (for example `period_start / period_end` and teleconsultation join URLs); these were implemented as separate columns. It allows `input_summary` and `output_summary` as `text/jsonb`; JSONB was selected to keep sanitized structured summaries. It does not specify a general messaging model, invoices, member codes, registration RPCs, rate-limit tables, or idempotency columns, so none were invented.
