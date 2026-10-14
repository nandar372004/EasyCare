# EasyCare Database V2 technical handoff

Prepared **2026-10-03, Asia/Rangoon**. Repository branch inspected: `database-v2-repair`.

## 1. Read this first

This is a documentation-only handoff for the AI that will design the next phase. The existing local database is substantially beyond the original telehealth schema: patient health profiles, labs, clinical documents, enhanced vitals/medications/alerts, AI summaries and an AI overview pipeline **already exist**. Do not generate a command that creates them again.

The user reports that Security Repairs 1–15 are complete and the latest security sign-off is **READY FOR DATABASE V2**, with Critical/High/Medium = 0 and remaining Low findings accepted as documented debt. This task treats that security foundation as frozen. The older Repairs 1–10 audit in this chat is superseded: its alert, medication, appointment/request and complaint findings were addressed by subsequent migrations, with the nullable-complaint residual described below. This handoff does not issue a new independent security sign-off.

Fresh evidence collected for this handoff:

| Item | Result |
|---|---|
| Clean migration replay | **44 / 44 applied** in an isolated PGlite database |
| Public application tables | **48** |
| Public-table foreign keys | **113**, counting retained simple and newer composite FKs separately |
| Public RLS policies | **102** |
| Storage policies supplied by this repository | **6**; separate from the public count |
| Public indexes | **126**, including PK/UNIQUE/exclusion backing indexes |
| User-defined public triggers | **40**; internal FK triggers excluded |
| Application public functions | **29**; extension-owned functions excluded |
| Widest non-legacy test run | **987 passed, 0 failed, 67 files** |

The complete final catalog is in **[database-v2-schema-map.md](database-v2-schema-map.md)**. It contains every table's columns, PostgreSQL types, nullability, defaults/generated expressions, PK/FK/UNIQUE/CHECK/exclusion constraints, indexes, triggers, full RLS expressions, ACLs, final function definitions, enums, migration lineage, storage policies, explicit migration privilege statements and runtime/test source references. It is part of this handoff, not optional background reading when designing SQL.

Evidence precedence: final replayed catalog and executable migration SQL > application queries > existing prose documentation. Some older documentation describes the schema before later repairs or overstates enforcement. For example, `MATCH SIMPLE` does not enforce a composite FK when a referencing component is NULL; owners able to disable triggers or remove constraints remain trusted administrators.

### Non-negotiable boundaries for the next implementation command

- Preserve working data, auth/login, booking, foreign-key integrity and Repairs 1–15.
- Use small forward-only migrations; do not rewrite applied migrations, reset the database, recreate existing tables or silently rewrite inconsistent clinical records.
- Retain `patients.auth_user_id`, `patients.care_preferences`, canonical `patients.blood_type`, and supported standalone records unless separately approved migration requirements justify a change.
- Extend existing authorization helpers and policies only under explicit requirements. Identity, authorization and relational integrity are separate concerns.
- Do not equate a passing unit suite, synthetic UI, or clean empty database with deployed end-to-end readiness.
- New AI data must remain derived, provenance-bearing and patient-scoped; AI must not insert diagnoses into authoritative conditions automatically.
- No deployment is authorized by this handoff.

## 2. Inventory, purpose and actual application usage

Classification is based on runtime code under `src/` and `supabase/functions/`, not tests alone. **ACTIVE** means a real read/write path is present; it does not assert hosted deployment. **PARTIALLY USED** means database support exists but runtime use is limited, read-only or still accompanied by synthetic screens. **DATABASE-ONLY** means no direct runtime consumer was found; helpers, policies or triggers can still depend critically on it. There is no separate `src/hooks/` directory in this checkout; hooks within feature files were included in the search.

Abbreviations: **D** = `src/services/repositories/patientDashboardRepository.js`; **R** = `src/services/repositories/supabaseRepository.js`; **C** = `supabase/functions/_shared/health-context.ts`; **O** = `supabase/functions/ai-health-overview/index.ts`. Exact line references and tests per table are in the schema map's source reference index.

| Table | Purpose | Usage and principal evidence |
|---|---|---|
| profiles | Auth-linked identity, role, status and demographics | ACTIVE: registration RPC; O and guardian authentication; all ownership helpers |
| patients | Patient entity and retained auth-linked demographics | ACTIVE: `authService.loadAuthorizedPatient`; R profile reads/updates; D overview; registration |
| providers | Clinical provider identity, verification, directory and fee | ACTIVE: R directory/booking; D directory; authorization and pricing helpers |
| family_authorizations | Per-patient delegated permission flags | PARTIALLY USED: enforced by `can_access_patient`; no real family-management runtime query found |
| consents | Versioned care/data/family/AI consent records | PARTIALLY USED: registration writes care/data_processing consent; no general consent-management flow found |
| partner_clinics | Clinic organizations and locations | DATABASE-ONLY: clinic membership and preferred-clinic FK; legacy `hospitals` query is not this table |
| clinic_staff | Clinic profile/provider membership and administrative role | DATABASE-ONLY: access helper dependency |
| care_coordinators | Coordinator identity/status and capacity | DATABASE-ONLY: access helper and patient/request assignment dependency |
| specialties | Provider specialty catalog | ACTIVE read via nested R/D provider queries |
| provider_specialties | Provider-to-specialty junction, primary specialty | ACTIVE read via R/D nested queries |
| provider_credentials | Licenses/certifications and verification evidence | DATABASE-ONLY; no credential-management client found |
| provider_availability | Provider booking slots | ACTIVE: R `listAvailabilitySlots`, booking FK and pricing trigger |
| care_requests | Patient need, service, urgency and coordinator queue | DATABASE-ONLY runtime orchestration; authorization helpers use it |
| care_assignments | Coordinator/provider match for a request, optional appointment | DATABASE-ONLY runtime orchestration; helper and Repair 14 dependency |
| appointments | Scheduled provider service, price, booking identifier | ACTIVE: R booking/list/detail; D next appointment; C upcoming context |
| visit_status_events | Appointment visit progress history | DATABASE-ONLY: R incorrectly queries a different `appointment_events` table |
| teleconsultation_sessions | Appointment room/link and session lifecycle | DATABASE-ONLY; consultation demo does not establish a working room integration |
| care_encounters | Actual clinical consultation, assessment and text care plan | PARTIALLY USED: D recent health records and C context reads; no real clinician authoring flow found |
| clinical_notes | Authored notes belonging to encounters | DATABASE-ONLY runtime authoring/reading; RLS resolves ownership through encounter |
| vital_readings | Timestamped measurements and provenance | PARTIALLY USED: D latest/history and C trends; database tests exercise insertion; do not infer a live input screen |
| patient_conditions | Longitudinal condition list and coding metadata | ACTIVE read in D overview and C; no complete authoring UI found |
| patient_allergies | Longitudinal allergies, reaction, verification metadata | ACTIVE read in D overview and C; no complete authoring UI found |
| medical_history_items | Dated surgery/hospitalization/vaccination/imaging/other history | PARTIALLY USED: D recent records; separate health-record page remains presentation-based |
| prescriptions | Encounter-linked clinician prescription header | PARTIALLY USED: R `listPrescriptions`; separate prescription page uses presentation data |
| prescription_items | Medication instructions within a prescription | DATABASE-ONLY runtime writer; repaired medication-origin chain depends on it |
| patient_medications | Patient's medication course/read model | ACTIVE read: R medication page, D current/today, C context; trusted writer needed |
| medication_schedules | Recurrence and timezone for a medication | ACTIVE read nested in R/D and directly in C; no schedule authoring client found |
| medication_events | Scheduled-dose occurrence and confirmation history | PARTIALLY USED: D/C reads; taken/skipped RPC exists and is tested, no runtime invocation found |
| follow_ups | Assigned post-encounter action and due/completion state | DATABASE-ONLY runtime workflow; extensively tested RLS and parent-chain protections |
| patient_health_profiles | One-to-one baseline measurements/lifestyle/preferred care | ACTIVE read by D; no independent blood-type column |
| lab_orders | Clinical laboratory order and lifecycle | DATABASE-ONLY runtime order-entry; results reference it |
| lab_results | Typed result value, range, abnormality and verification | PARTIALLY USED: D/C and R reads; dedicated lab page still presentation-based |
| clinical_documents | Metadata for private Storage files | PARTIALLY USED: D recent records; Storage provisioning script exists; no complete upload/download UI found |
| monitoring_alerts | Patient health/system condition requiring attention | PARTIALLY USED: D/C read; no runtime alert producer found |
| notifications | Delivery to a recipient profile | DATABASE-ONLY runtime delivery/mark-read; database RPC and tests exist |
| ai_health_summaries | Versioned derived health overview and provenance | ACTIVE: D read, O cache/read/write through service-only RPC, dashboard AI component |
| ai_interactions | Summarized AI input/output event and review indicator | DATABASE-ONLY persistence: guardian conversation is not written here by current Edge code |
| ai_overview_leases | Patient-specific generation lease/cooldown | ACTIVE via O `claim_ai_overview` / `save_ai_overview` |
| ai_overview_request_limits | Patient-specific AI overview request budget | ACTIVE via O `consume_ai_overview_request` |
| service_catalog | Sellable care services and base catalog price | DATABASE-ONLY; current doctor booking price comes from provider configuration |
| pricing_rules | Optional service surcharge/commission rules | DATABASE-ONLY; do not assume current appointment pricing consumes all these rules |
| care_packages | Commercial package catalog | PARTIALLY USED: nested D subscription query |
| package_services | Package included service quantities | DATABASE-ONLY |
| subscriptions | Patient's purchased commercial package | PARTIALLY USED: D `getActiveCarePlans` reads subscriptions; this is not a clinical care-plan model |
| payments | Payer, patient and appointment/subscription payment ledger | DATABASE-ONLY runtime payment processing; tested RLS and relationship helpers |
| complaints | Submitter-owned service complaint, optional patient/appointment | DATABASE-ONLY; no complaint writer found; known NULL-patient residual |
| feedback | Rating/comment for completed appointment | DATABASE-ONLY |
| audit_logs | Trigger-generated row-change audit | ACTIVE database infrastructure; no dedicated application read-audit UI |

All specifically requested existing health tables are present. Missing future structures are explicitly listed in section 9. Tests are not evidence of live UI integration. No unknown external integrations have been assumed; consumers outside this repository are **UNKNOWN**.

## 3. Exact identity and ownership model

```text
auth.users.id = auth.uid() for the authenticated JWT
  -> profiles.id (PK and FK to auth.users.id)
      -> patients.profile_id (NOT NULL, UNIQUE, FK)
         patients.auth_user_id (NOT NULL, UNIQUE, FK to auth.users)
         CHECK patients.profile_id = patients.auth_user_id
         patients.id is a separate UUID: clinical patient_id references use THIS ID
      -> providers.profile_id (nullable, UNIQUE, FK to profiles)
         providers.id is a separate UUID: clinical provider_id references use THIS ID
```

`patients.profile_id` was nullable originally, then safely backfilled/validated and made NOT NULL by `20260928090000_patient_profile_identity_repair.sql`. Do not infer final nullability from the original creation migration. `providers.profile_id` remains nullable: a provider catalog record without an auth-linked profile is not an authenticated clinician.

Registration: `patient-register` creates managed Auth identity, then service-only `create_patient_registration(registration jsonb)` atomically inserts a patient-role profile, a patient with both identity columns equal to the Auth ID, and two consent records. It does **not** create a health-profile row, coded conditions/allergies, medication courses or a family group. Registration's free-text health answers are retained in `patients.care_preferences`; blood type goes to `patients.blood_type`.

Login still derives an internal email from normalized phone and uses Supabase `signInWithPassword`. `src/services/authService.js:5–17` resolves the patient by `auth_user_id` and requires patient status `active`. R profile lookup/update also filters `auth_user_id`. O verifies `profile_id`. These mechanisms are consistent because of the equality CHECK; the legacy auth column must not be dropped without migrating those callers.

Profiles and patients both retain demographic/status fields. The identity equality constraint does not synchronize every demographic field. Patient self-service updates do not imply corresponding profile changes. Preserve this compatibility and decide separately which record owns future onboarding/profile fields.

### Authorization is more than ownership

`can_access_patient(patient_id, permission_name)` is the central SECURITY DEFINER helper, with a pinned empty search path and authenticated-only execution. Its final definition is reproduced in the schema map. It first requires `clinical_identity_is_current()` and then evaluates:

- Patient self: `patients.auth_user_id = auth.uid()`.
- Main administrator: existing administrative helper, subject to the identity gate in this helper.
- Family: an **active** `family_authorizations` row for the caller and patient; `appointments`, `medications`, `payments`, `alerts` map to their corresponding booleans; other permission names, including `clinical`, map to `can_view_records`.
- Provider: role doctor/nurse/caregiver, verified provider linked to caller, and either an appointment for the patient or an assigned/accepted care assignment through that patient's request. Appointment linkage is not time-limited in this helper.
- Coordinator: only view/appointments/alerts and a primary-patient or request assignment.
- Clinic administrator: only appointments/alerts through active clinic membership linking to the appointment's provider.

The clinical identity gate rejects inactive/suspended staff profiles, unverified/suspended providers, inactive coordinators and invalid clinic-admin membership. Patient/family roles retain their existing semantics rather than automatically receiving the staff status rules. Restrictive `clinical_identity_required` policies AND with permissive relationship policies; they do not independently grant access.

`is_appointment_provider`, `can_manage_care_encounter`, `can_manage_follow_up`, and `can_create_payment_for_appointment` add operation-specific checks. Do not substitute “any verified provider” for these relationship checks.

Family authorization is a patient-to-profile delegation, not a household or kinship graph. Flags do not guarantee every RPC supports family mutation: `record_medication_event_status` currently requires the patient's own profile, even when family can read/manage through other policies. There is no expiration column or expiration check; active authorization persists until revoked. Unique `(patient_id,family_profile_id)` and a partial unique primary-contact index constrain the model.

`service_role` bypasses RLS and runs registration/AI/trusted ingestion paths. Structural composite FKs and chain triggers still apply under normal operation. Actual hosted grants were not inspected; schema-map ACLs are from the replay harness and must not be treated as hosted privileges. Never expose service-role credentials to the browser.

## 4. Detailed health-table semantics

Every exact field/default/type/constraint/policy is in the schema map. These are the semantic details that affect V2 design:

| Area | Current behavior and extension boundary |
|---|---|
| `profiles`, `patients`, `providers` | Separate patient/provider UUIDs; auth/profile equality only on the auth-linked identity columns. Provider display_name/qualification/consultation_fee_mmk are directory fields; role lives on profiles. No generic profile role `provider`. |
| `patient_health_profiles` | Unique patient FK; height_cm, baseline_weight_kg, smoking_status, alcohol_use, pregnancy_status, primary_physician_id, preferred_clinic_id, last_health_review_at and timestamps. Positive finite measurements, constrained lifestyle values, updated_at trigger. **Blood type remains patients.blood_type.** Do not duplicate baseline weight as a replacement for timestamped vital weight. |
| `patient_conditions` | condition_name and active/resolved/historical status; diagnosed_at, recorded_by, notes; code_system/condition_code must be paired; severity/onset/resolved dates. Resolved date cannot be attached to an active condition. Longitudinal condition list, not encounter diagnosis coding. |
| `patient_allergies` | allergen, reaction, severity, active/inactive status, recorded_by; allergen_type/onset; verifier FK and timestamp must be paired. No separate structured no-known-allergies assertion model. |
| `vital_readings` | Real columns are systolic_bp, diastolic_bp, heart_rate, **spo2, temperature_c, glucose_mg_dl**, weight_kg; nullable encounter. `source` is writable enum; `source_type` is generated from it, not an independent writer input. measurement_context is bounded text, not a fixed clinical vocabulary. No device_id because patient_devices does not exist. |
| `medical_history_items` | Patient-scoped category/title/date/details/document_url; not the private Storage document model. Historical URL should not become an alternative authoritative upload mechanism. |
| `appointments` | Required patient/provider, slot link nullable structurally but normal patient booking requires valid availability; type/channel must agree; authoritative price trigger. Time overlap exclusion and active-slot uniqueness exist. Cancellation timestamp consistency required. |
| `care_requests`, `care_assignments` | Request owns the patient; assignment has no patient_id and derives it via request. Assignment can exist before an appointment. Same patient does not require same request ID on the appointment. |
| `care_encounters` | Required, unique appointment_id: one encounter per appointment under the present schema. Required patient/provider; assessment_summary and care_plan are text. Not normalized care plans/tasks or encounter diagnoses. |
| `clinical_notes` | Required encounter and author, type/content, amendment timestamp. Patient ownership is inherited through encounter, not copied onto note. |
| `prescriptions`, `prescription_items` | Prescription encounter_id is **NOT NULL** in the current schema; patient and doctor required. Items inherit ownership through prescription and have name/strength/dose/route/frequency/duration/instructions. Do not assume independent prescriptions are currently supported. |
| `patient_medications` | Optional prescription_item_id permits standalone courses. Active/paused/completed/discontinued; prescribing_provider_id, reason, discontinued_at/reason added. Final created_by_profile_id is nullable after read-model migration. Client access is deliberately restricted; trusted service writes. |
| `medication_schedules` | Medication FK; local time, optional days 0–6 (Sunday=0), timezone, reminders, validity dates. No patient_id, no materialized adherence totals. |
| `medication_events` | Schedule FK plus explicit patient_id; scheduled_at and pending/taken/missed/skipped/unknown; confirmation profile/time. Existing authenticated RPC allows only taken/skipped for own patient. Event generation/deduplication/overdue classification must be designed; schema does not guarantee one event per schedule/time. |
| `follow_ups` | Required encounter/patient, optional assigned profile; call/appointment/monitoring/medication, instructions/due/status/completion. It is an action record, not a structured multi-task care plan. |
| `lab_orders` | Required patient, ordering provider and unique order_code; optional encounter; lifecycle times, lab name/notes. Encounter linkage must match patient. |
| `lab_results` | Required order and matching patient; numeric/text value, units/reference bounds, abnormality, observed/verified times. Final/corrected status requires verified_at; preliminary/final/corrected need a value. Ordinary patients have read access, not result modification. |
| `clinical_documents` | Metadata only; required uploader, file size/MIME/type/title/path, optional encounter/date. Private bucket `clinical-documents`, path `patientUUID/documentUUID/filename`, unique path. Storage RLS reads through authorized metadata. Trusted upload service required; bucket provisioning is a separate Storage API script, not automatically accomplished by this migration. |
| `monitoring_alerts` | Health/system condition, **not notification delivery**. Patient, optional vital, severity/message/status, source_type/source_id/title/rule_code/detected_at. Vital FK is patient-bound; generic source_id remains polymorphic metadata without an FK. No approved threshold rules are implemented merely by adding these fields. |
| `ai_health_summaries` | Existing period/type/text plus status/watch/actions/provenance/hash/model/prompt/time/review/supersession fields. JSON arrays constrained; SHA-256 hash requires source snapshot; reviewer/time paired; successor must belong to same patient. Partial uniqueness allows one unsuperseded summary per patient/type/period. Legacy metadata can remain NULL. |
| `payments`, `subscriptions` | Commercial ledger and purchased package. Payments require at least one appointment/subscription link; both may be populated if patient-consistent. These are not clinical plan progress structures. |
| `notifications` | Recipient profile, optional patient, channel/type/content/status and delivery/read timestamps. No created_at column. Authenticated clients must use `mark_notification_read`; direct UPDATE is revoked. |
| `complaints` | Optional patient and appointment, required submitting profile, subject/description and workflow state. Composite FK checks non-NULL patient+appointment pairs; NULL patient remains a documented exception. |

## 5. Verified relationship map and enforcement

Simple patient/provider/profile FKs exist in addition to the protections below. RLS controls who may act; a FK/trigger controls which records may be linked. Both must survive extensions.

| Chain/link | Database enforcement | Authorization / qualification |
|---|---|---|
| Auth → profile → patient | PK/FKs, unique profile/auth columns and identity equality CHECK | Registration service-only; self/clinical/family policies |
| Profile → provider | Nullable unique simple FK | Verified + active identity and patient relationship required for clinical access |
| Patient → care request | Simple patient FK | Request creation/read and coordinator policies |
| Request → appointment | Composite `(care_request_id,patient_id)` FK to request `(id,patient_id)`; Repair 13 | NULL request permits standalone booking |
| Request → assignment → appointment | Simple parent FKs plus Repair 14 chain and two parent-mutation triggers | Derive assignment patient from request; linked appointment must have same patient, not necessarily same request ID |
| Appointment → encounter | Composite `(appointment_id,patient_id)` FK; unique encounter appointment; Repair 5 | `can_manage_care_encounter` checks provider/appointment authorization |
| Encounter → clinical note | Simple required FK | RLS resolves access through encounter; author identity checks |
| Encounter → prescription | Composite `(encounter_id,patient_id)` FK; Repair 1 | Doctor identity, encounter provider and patient authorization on insert |
| Prescription → item | Simple required FK | RLS inherits prescription visibility |
| Item → patient medication | Simple FK plus Repair 12 trigger comparing medication patient with item's prescription patient; parent guards on item/prescription | Standalone NULL item preserved; trusted medication writes |
| Medication → schedule → event | Simple FKs plus Repair 10 child chain check and parent guards on schedule/medication | Event patient must match schedule's medication patient; own-patient taken/skipped RPC |
| Patient → vital → alert | Patient FK; Repair 11 composite `(vital_reading_id,patient_id)` FK | Standalone alert permitted; generic source_id not equivalent to validated vital_reading_id |
| Encounter → vital | Repair 8 composite encounter/patient FK | NULL encounter supported; clinical/patient policies remain |
| Encounter → follow-up | Composite FK plus Repair 2 chain/parent guards and helper | Cannot self-assign to gain foreign patient access |
| Patient → lab order → result | Simple patient/provider FKs; order/encounter and result/order composite patient FKs | Related authorized clinical roles write; patients read their authorized results |
| Patient → clinical document | Simple patient/uploader FKs, optional composite encounter/patient FK | Authorized metadata read; Storage read depends on metadata; normal client file writes denied |
| Patient → AI summary → successor | Patient FK and composite successor/patient FK | Authorized reads, service-only generation/persistence; derived content |
| Appointment/subscription → payment | Separate composite parent/patient FKs; Repairs 6 and 9 | Payer/helper and pending-only patient insert policies; service settlement |
| Appointment → complaint | Composite patient FK plus Repair 15 parent guard | Submitter/admin read; NULL patient bypasses composite check and remains Low debt |

Parent mutation protection matters even for service writers. New nullable parent links must retain standalone semantics where documented. Do not add redundant patient_id columns to schedules/items/assignments without a deliberate migration design; current trigger chains exist specifically because those tables derive ownership.

## 6. Frozen Security Repairs 1–15

Migration names below are relative to `supabase/migrations/`. Every listed migration is present, replayed, and its integration suite passed in this run. This is regression evidence, not a hosted deployment claim.

| # | Problem fixed / tables | Migration | Principal enforcement |
|---|---|---|---|
| 1 | Prescription patient differs from encounter; prescriptions/encounters | `20261001090000_prescription_patient_integrity.sql` | `prescriptions_encounter_patient_fk`; qualified doctor/encounter INSERT policy |
| 2 | Follow-up ownership and self-assignment bypass; follow_ups/encounters/appointments | `20261001100000_follow_up_patient_integrity.sql` | Composite FK, `can_manage_follow_up`, `check_follow_up_parent_chain` and parent guards |
| 3 | Suspended/inactive/unverified staff clinical access; clinical tables/helpers | `20261001110000_suspended_provider_clinical_access.sql` | `clinical_identity_is_current`; strengthened patient/provider helpers; restrictive policies |
| 4 | Client-controlled appointment pricing; appointments/availability/providers | `20261001120000_appointment_pricing_integrity.sql` | `enforce_appointment_pricing`, authoritative doctor fee/MMK and immutable booking/pricing fields |
| 5 | Encounter attached to foreign patient's appointment | `20261002090000_encounter_appointment_integrity.sql` | `appointments_id_patient_key`, composite encounter FK, `can_manage_care_encounter` |
| 6 | Payment attached to foreign patient's appointment | `20261002100000_payment_appointment_integrity.sql` | Composite payment FK and `can_create_payment_for_appointment` |
| 7 | Notification mark-read allowed arbitrary edits | `20261002110000_notification_mark_read_integrity.sql` | Direct UPDATE revocations; scoped `mark_notification_read(uuid)` RPC |
| 8 | Vital attached to foreign patient's encounter | `20261002120000_vital_encounter_integrity.sql` | `vital_readings_encounter_patient_fk` and child index |
| 9 | Payment attached to foreign patient's subscription | `20261002130000_subscription_payment_integrity.sql` | Subscription composite key, payment composite FK/index |
| 10 | Event patient differs from schedule's medication patient | `20261002140000_medication_event_patient_integrity.sql` | `check_medication_event_patient_chain`; child trigger plus schedule/medication parent guards |
| 11 | Alert linked to foreign patient's vital | `20261002150000_monitoring_alert_vital_patient_integrity.sql` | `vital_readings_id_patient_key`, `monitoring_alerts_vital_patient_fk`, partial child index |
| 12 | Medication origin points to foreign prescription item | `20261002160000_medication_prescription_patient_integrity.sql` | `check_medication_prescription_patient_chain`; medication/item/prescription guards and child index |
| 13 | Appointment points to foreign patient's care request | `20261002170000_appointment_care_request_patient_integrity.sql` | Request `(id,patient_id)` key and composite appointment FK |
| 14 | Care assignment links request and appointment of different patients | `20261002180000_care_assignment_appointment_patient_integrity.sql` | `check_care_assignment_patient_chain`; assignment/request/appointment guards |
| 15 | Complaint explicitly names a patient different from its appointment | `20261002190000_complaint_appointment_patient_integrity.sql` | `complaints_appointment_patient_fk`; appointment complaint guard; NULL patient residual retained |

The last five repairs preserve existing RLS rather than replacing it. Repair preflights fail on conflicting historical links instead of rewriting them. Matching validation scripts are under `supabase/scripts/`. Actual constraint names, trigger event columns, function bodies and privileges are in the schema map.

## 7. Application paths and current mismatches

### Real dashboard and AI overview

`patientDashboardService.js` exposes getPatientDashboard/getLatestVitals/getVitalHistory/getTodayMedications/getNextAppointment/getActiveAlerts/getRecentHealthRecords/getRecentLabResults/getLatestAIHealthSummary. D composes these into R. `DashboardPage.jsx` calls `dashboardPageService.loadDashboardPage`, which currently requests overview, upcoming appointment, medications, provider suggestions and subscription-derived plans. The existence of the wider data-access API does not mean every section has a live dashboard widget.

D scopes patient queries, uses real database columns, paginates history, and returns camelCase models without rewriting nested clinical JSON. It reads latest values separately by metric; a displayed set may comprise readings from different times. History periods accept 7d/30d/90d/365d or start/end. Today's medications use schedule timezone and validity dates and attach existing event rows; this read does not create dose occurrences. Adherence should be computed from events after defining the denominator and handling pending/unknown/skipped.

`AIHealthOverview.jsx` calls `aiHealthOverviewService.js` → `ai-health-overview` → `_shared/health-overview.ts` and `health-context.ts`. Context uses the **user-scoped client**, 30-day data and bounded 500-row sources with truncation flags; latest measurements may predate the trend window. Deterministic safety checks, gateway contract validation, source snapshot/hash and model/prompt metadata precede service-only cache persistence. The cache uses a 90-second generation lease, two-minute retry cooldown and 60 requests per 15-minute window. Source/version changes affect the hash. No clinical table is written by this summary flow. Family generation is not supported merely because family can read some patient records: this Edge authorization requires the caller's own patient profile.

The older `ai-health-guardian` gateway is separate. It authenticates a profile and invokes a model/safety contract, but does not provide durable conversation/message storage. Its missing rate-limit RPC is documented below; do not confuse it with the working overview-specific rate-limit tables/RPCs.

### Confirmed schema/reference mismatches and compatibility debt

| File/reference | Code expects | Actual final schema | Likely impact |
|---|---|---|---|
| R `listAppointmentEvents`, line 97; `dashboardPageService.js:14` | `appointment_events` with event_type/from_status/to_status | Table absent; `visit_status_events` exists with a different contract | Dashboard event load fails and is isolated as eventsError; cannot simply rename without adapting semantics |
| R `rescheduleAppointment`, line 108 | `patient_reschedule_appointment` RPC | No such function in 44 migrations | Remote invocation fails; current presentation lifecycle is not evidence of server support |
| R `cancelAppointment`, line 113 | `patient_cancel_appointment` RPC | No such function | Same; Repair 4 freezes important booking fields, so a replacement needs an explicit compatible design |
| R mapping lines 3–5, methods 77/133–135 | `hospitals`, `messages`, `invoices`, `nearby_facilities` | All absent | Those remote methods fail; clinics/payments are not drop-in equivalents |
| `ai-health-guardian/index.ts:181,187` | `consume_auth_rate_limit` | Absent function and backing implementation | Rate-limit dependency errors lead to gateway unavailable behavior; no silent substitute authorized |
| `supabase/seed.sql` profile/provider inserts | profiles.display_name/is_active; role provider; providers.specialty/timezone/default_slot_minutes/is_public | Absent columns; profile roles distinguish doctor/nurse/caregiver | Seed is incompatible even when its safety switches/Auth prerequisites are satisfied |
| Same seed patient/booking inserts | member_code/address_city/emergency_contact/medical_profile, `availability_slots`, appointment availability_slot_id/consultation_type/fee_mmk/idempotency_key | Actual patient flat fields/care_preferences; provider_availability; appointment provider_availability_id/channel/fee_amount | Multiple independent incompatibilities; do not run as current catalog/bootstrap seed |
| `authService.js:5–17`, R lines 75–76 | patients.auth_user_id identity lookup | Present and equality-bound to profile_id | Supported legacy path, not a current failure; dropping auth_user_id would break login/settings |
| `HealthPages.jsx` prescription tab | Presentation status `past` | DB prescription enum active/completed/cancelled | UI is explicitly fixture-based; requires an adapter when connected, not a new enum value by assumption |
| D `getActiveCarePlans`, line 111 | Commercial subscription displayed as care plan | subscriptions + care_packages; encounter care_plan is text | Semantic mismatch; do not build clinical tasks/progress on a purchased package implicitly |
| Existing Repair 15 prose | NULL-patient appointment complaint described as nonblocking preflight | Migration preflight uses `IS DISTINCT FROM`, so an existing NULL-patient linked complaint also triggers abort | Document runtime exception and migration-preflight behavior separately; prose must not drive future SQL |
| Legacy tests listed in section 14 | Removed 20260810/20260813 migrations and old tables | Files absent from migration directory | Excluded load-time failures are not passes |

No nonexistent column was found in the selected real dashboard query lists: aliases such as oxygen_saturation/temperature/blood_glucose intentionally map to spo2/temperature_c/glucose_mg_dl. Do not add duplicate columns to satisfy UI labels. No general proof of every possible dynamic external query is claimed.

`src/services/repositories/index.js` can choose fixture mode when Supabase is not configured or prototype mode is explicit. The real dashboard service bypasses fixture fallback and reports missing configuration/data errors. `HealthPages.jsx` still uses presentation health records, prescriptions and lab results; its medication path is database-backed. These screens must not be used to infer missing tables or deployed clinical writes.

## 8. Controlled values and naming contract

The schema map includes **all enums** and **all CHECK expressions**. Important health values are reproduced here for command authors:

| Field/type | Existing allowed values |
|---|---|
| profile_role | patient, family, doctor, nurse, caregiver, coordinator, clinic_admin, main_admin |
| profile_status / patient status text | active, suspended, inactive |
| provider_type | doctor, nurse, nurse_aide, caregiver |
| verification_status | pending, verified, rejected, suspended |
| appointment_status | pending, confirmed, cancelled, completed, no_show, rescheduled |
| encounter_status | open, completed, amended |
| encounter_type | teleconsultation, home_visit, nursing_care, caregiver_visit |
| care_request_type | teleconsultation, doctor_home_visit, nurse_home_visit, caregiver |
| service_mode | teleconsultation, home_visit |
| care_request_status | new, triaged, matching, booked, escalated, closed, cancelled |
| assignment_status | suggested, assigned, accepted, rejected, cancelled |
| care_urgency | unassessed, routine, urgent, emergency |
| condition_status | active, resolved, historical |
| condition severity text | mild, moderate, severe, unknown; nullable |
| allergy status / severity | active/inactive; mild/moderate/severe |
| allergen_type text | medication, food, environmental, insect, latex, other, unknown; nullable |
| patient_medication_status | active, paused, completed, discontinued |
| medication_event_status | pending, taken, missed, skipped, unknown |
| prescription_status | active, completed, cancelled |
| vital_source / generated source_type | manual, provider, device |
| monitoring alert source_type text | vital, lab, medication, appointment, ai, manual; nullable |
| alert_severity / alert_status | info, warning, critical / open, acknowledged, escalated, resolved |
| follow_up_type / status | call, appointment, monitoring, medication / pending, completed, cancelled |
| lab order status text | ordered, collected, processing, completed, cancelled |
| lab result status text | pending, preliminary, final, corrected, cancelled |
| lab abnormal_flag text | unknown, normal, low, high, critical_low, critical_high, abnormal |
| ai_summary_type / ai_review_status | daily, weekly / generated, reviewed, hidden |
| ai_interaction_type | health_assistant, symptom_screening, provider_matching |
| family_authorization_status | pending, active, revoked |
| smoking / alcohol / pregnancy | never,former,current,unknown / none,former,current,unknown / pregnant,not_pregnant,not_applicable,unknown |
| subscription_status | pending, active, paused, cancelled, expired |
| payment_status | pending, authorized, paid, failed, refunded, partially_refunded |
| notification_status | queued, sent, delivered, failed, read |
| complaint_status | open, investigating, resolved, closed |

`clinical_documents.document_type` is a validated lowercase identifier, not a fixed enum. `ai_health_summaries.overall_status` is bounded text, not a medical classification enum. Condition code_system is bounded text rather than a mandated coding standard. No future vocabulary should be inferred from example feature names.

## 9. Database V2 gap analysis

“Ready” means reusable schema exists for the stated current use, not that every writer/UI/deployment is ready.

| Requested concept | Classification | Evidence and decision |
|---|---|---|
| patient_health_profiles | **EXISTS AND READY / SHOULD NOT BE DUPLICATED** | One per patient, baseline/lifestyle/care preferences FKs; extend only for named onboarding requirements; blood_type stays on patients |
| patient_conditions | **EXISTS BUT NEEDS EXTENSION** only if new feature requires it | Current coded longitudinal list is ready; provenance/confirmation/versioning or encounter coding require explicit design |
| patient_allergies | **EXISTS AND READY / NEEDS DESIGN DECISION** | Verification metadata exists; distinguish no known allergy from no data before migration of onboarding text |
| vital_readings | **EXISTS AND READY / NEEDS DESIGN DECISION** | Current metrics/history ready; device ingestion, units and new measurements need scoped extensions |
| patient_health_goals | **MISSING** | No goals, target metrics, ownership or progress model |
| lab_orders | **EXISTS AND READY / SHOULD NOT BE DUPLICATED** | Clinical order lifecycle and patient-bound encounter FK; ingestion/provider UI still needed later |
| lab_results | **EXISTS AND READY / SHOULD NOT BE DUPLICATED** | Typed results/ranges/verification, patient-bound order FK |
| clinical_documents | **EXISTS AND READY / SHOULD NOT BE DUPLICATED** | Metadata + private Storage policies; trusted upload workflow and bucket provisioning need operational completion |
| monitoring_alerts | **EXISTS BUT NEEDS EXTENSION** for new sources/workflows | Existing source metadata and vital binding; other polymorphic source ownership and approved rule producer require decisions |
| ai_health_summaries | **EXISTS AND READY / SHOULD NOT BE DUPLICATED** | Provenance/version/cache already implemented; family use and new plan context require explicit scope |
| encounter_diagnoses | **MISSING** | Existing assessment text and patient_conditions are not a coded per-encounter diagnosis relation |
| clinical_procedures | **MISSING** | Historical surgery category is not a performed/proposed procedure lifecycle |
| patient_devices | **MISSING** | Vital source=device is only provenance label; no device registry or device FK |
| record_access_logs | **MISSING / NEEDS DESIGN DECISION** | audit_logs records writes, not SELECT access; decide audit entrypoint and retention before adding a similarly named table |
| AI conversation/message storage | **NEEDS DESIGN DECISION; normalized storage MISSING** | ai_interactions stores summarized events; no conversation/message tables or runtime persistence. Do not duplicate clinical summaries as chat messages |

Also missing: a normalized clinical care-plan/task/progress model, household/group membership model, explicit dependent/guardian onboarding model, and a durable general health-goal model. These are feature design candidates, not instructions to create particular table names now.

## 10. Future feature data requirements

| Feature | Support now | Existing foundation | Missing structures / decisions |
|---|---|---|---|
| Family Health Command Center: “Who needs me today?” | **PARTIALLY SUPPORTED** | family_authorizations; patient records, alerts, meds/events, appointments | Household membership vs delegated access; dependents without Auth; consent/expiry; cross-patient authorized aggregation; attention-ranking semantics; clinical plans/tasks. A family relationship alone must not grant clinical access |
| AI Health Guardian | **PARTIALLY SUPPORTED** | Authorized context builder, safety/gateway/response contract, cache/provenance, AI summaries | Family/delegate generation rules; structured clinical plan context; durable chats if desired; resolve separate guardian rate-limit dependency under another task |
| Smart Care Plan | **PARTIALLY SUPPORTED** | Encounter care_plan text, prescriptions, schedules/events, follow_ups | Normalized plan identity/version/author, tasks/actions, dependencies/scheduling, completion actor/evidence, progress and patient/family delegation. Subscription is not a substitute |
| Health Story | **PARTIALLY SUPPORTED** | Encounters, vitals, meds, labs, document metadata, history, follow-ups | Unified authorized timeline query/event contract, clinical vs derived labeling, amendment/version handling, pagination, plan events. Prefer reading existing sources over duplicating them into authoritative records |
| One-Tap “I Need Care” | **PARTIALLY SUPPORTED** | Request→assignment/booking→encounter patient relationships already enforced | Actual request/triage/matching runtime, family request scope, service vocabulary mapping, care-plan handoff; avoid changing frozen booking invariants implicitly |

Personalized onboarding can reuse profiles/patients/health profiles/conditions/allergies, but needs a defined completion/version model and rules for transforming self-reported text into verified clinical records. Trends can use existing vital and lab histories. Lab/document tables need producer workflows more than duplicate schema.

## 11. Query and index requirements

These are catalog-based suitability assessments, not benchmark results. Do not add indexes solely because a name is absent; validate future filters/sorts with realistic data and EXPLAIN first.

| Query | Current source / useful existing indexes | Gap or design note |
|---|---|---|
| Patient identity/profile | patients_auth_user_uidx, patients_profile_id_key; health_profiles patient unique key | Existing lookup supported; keep auth compatibility |
| Latest vitals / history | vital_readings_patient_recorded_idx `(patient_id,recorded_at DESC)` | Good baseline. Per-metric non-NULL predicates and id tie-breaks may need tuning only at scale |
| Current medications | patient_medications_patient_status_idx `(patient_id,status)` | Date validity evaluated too; current scale/performance unmeasured |
| Today's schedule/events | medication_schedules_medication_idx; medication_events_patient_scheduled_idx; medication_events_schedule_idx | Existing event range and medication joins covered. Timezone recurrence expansion is application logic |
| Adherence | medication_events patient/time index | Define denominator and missing-event semantics; do not add adherence table by default |
| Next appointment | appointments_patient_start_idx | Good baseline; status filter can be evaluated with patient/time scan |
| Active alerts | monitoring_alerts_patient_status_idx plus open-only partial index | Covers active-status retrieval; generic source index is not ownership enforcement |
| Recent health records | clinical_documents_patient_created_idx | care_encounters lacks patient+time index; medical_history_items lacks patient+occurred_on index. Composite `(id,patient_id)` is not patient-leading |
| Recent labs | lab_results_patient_observed_idx `(patient_id,observed_at DESC NULLS LAST)`; order patient/date index | Result status/additional created_at sort may need profiling |
| Conditions/allergies | patient_conditions_patient_idx; patient_allergies_patient_idx | Patient scope covered; do not duplicate these indexes |
| Latest valid summary | ai_summaries_patient_generated_idx and current-period partial uniqueness | Expiry/hidden/supersession filter present; no benchmark for large history |
| Active subscriptions | subscriptions has PK and `(id,patient_id)` unique key | No patient-leading status/time index; current D plan lookup may scan |
| Active clinical care plan | No normalized clinical plan table | Schema and query contract decision first |
| Family members needing attention | family_authorizations_family_idx `(family_profile_id,status)` and patient/family unique | Authorization lookup covered; attention aggregation/tasks missing |
| Upcoming follow-ups | follow_ups_encounter_patient_idx | No patient-leading due/status index; assess future family/plan queues |
| Care assignment matching | request queue index `(status,urgency_level,created_at)` | care_assignments parent/provider filtering lacks supporting secondary indexes; Repair 14 trigger joins also merit scale review |
| Notifications | notifications_recipient_status_idx `(recipient_profile_id,status,scheduled_at)` | No created_at; choose ordering based on actual columns |

Several FKs lack child indexes (for example prescription_items.prescription_id and complaint appointment links). PostgreSQL does not automatically index referencing columns. This is performance/locking debt, not proof of broken integrity. The schema map lists every index so the next design can avoid duplicate unique/index structures required by frozen composite FKs.

## 12. Migration lineage

The complete ordered list is appended below. The schema map records **CREATED BY** and **MODIFIED BY** for every table using actual catalog snapshots after each migration. Modified-by includes changes to columns, constraints, indexes, triggers, policies and privileges. A replaced shared helper can change authorization without changing a table's catalog signature: consult Repair 3 and the migration-reference lists as well.

Important creation groups:

- Identity/profile: `20260820010000_identity.sql`; patients/family/consents: `20260820010100_patient_family.sql`; provider/clinic supply: `20260820010200_provider_supply.sql`.
- Booking/request/assignment: `20260820010300_booking.sql`; encounters/conditions/allergies/history/vitals/notes: `20260820010400_clinical.sql`. Teleconsultation sessions are installed in `20260820010900_ai_security.sql`.
- Prescriptions/items/medications/schedules/events: `20260820010500_medication.sql`.
- Coordinators/follow-ups/alerts/notifications: `20260820010600_coordination.sql`.
- Commercial catalog/packages/subscriptions/payments: `20260820010700_commercial.sql`.
- Feedback/complaints/audit: `20260820010800_governance.sql`.
- AI interactions/summaries and consolidated security: `20260820010900_ai_security.sql`.
- Health profiles/labs/documents: their existing 20260929 migrations, not future work.

Do not infer execution order from feature names; the full clean replay succeeds in filename order.

## 13. Known technical debt and operational limits

1. **Provider `protect_security_managed_fields` issue.** The shared trigger function refers to profile-only `new.role`/`new.status` in a compound condition before the providers branch. PostgreSQL record-field evaluation can raise an undefined-field error for a provider row on affected authenticated update paths. This is known update-availability debt, not permission to weaken role/verification protection. See the exact final function body and `providers_protect_security_fields` trigger in the map; no change made here.
2. **Nullable patient on linked complaints.** Runtime `MATCH SIMPLE` accepts NULL patient with appointment_id; submitter/admin RLS remains. Separately, Repair 15's preflight rejects such existing links because it compares using `IS DISTINCT FROM`. Do not repeat the prose claim that all such preexisting rows are nonblocking.
3. **Stale seed and catalog provisioning.** `supabase/seed.sql` targets removed presentation schema. Clean migrations do not supply usable provider/availability/specialty/package catalog records. Empty data must be an empty state, never invented health values. No production catalog was inspected.
4. **Legacy suites and presentation adapters.** Three obsolete suites refer to removed migrations. Fixture-driven health screens and remote placeholders remain; a green non-legacy suite does not make those real workflows complete.
5. **Family permission duration and scope.** No expires_at, consent expiry or household membership. Medication status RPC and AI overview generation remain own-patient scoped. A future family command must define these deliberately without broadening all RLS.
6. **Polymorphic alert provenance.** source_id has no general FK/ownership enforcement for arbitrary sources. Validated vital_reading_id is distinct. Future consumers must not treat source_id as an authorization grant.
7. **Clinical self-report duplication.** care_preferences holds onboarding allergy/condition/medication strings beside structured tables. No automatic clinical reconciliation/verification exists. Demographics are also present on both patients and profiles.
8. **Read auditing.** audit_logs and audit_row_change are write auditing, not a comprehensive clinical record-access log. Table creation alone cannot make SELECT requests auditable.
9. **Care plan terminology.** Subscription cards use “care plan”; actual clinical plan is encounter text. Resolve the terminology and ownership before creating a plan/task model.
10. **Dose occurrence generation.** Existing schedules/events/RPCs do not constitute a complete background scheduling pipeline. No unique schedule/time event key in current catalog; missing events must not automatically count as taken or normal adherence.
11. **Operational deployment evidence absent.** No hosted project/schema/data inspected; private Storage bucket creation, deployed Edge functions, actual grants, model configuration and concurrency need separate staging validation. PGlite simulates Auth/Storage scaffolding, not Supabase services or PostgREST.
12. **Existing dirty working tree.** Much earlier work is uncommitted/untracked. This task adds only documentation and does not stage, revert, commit or deploy any existing work. A future implementation should inspect working-tree state before editing.

## 14. Reproducible test baseline

Framework: **Vitest 3.2.7**, React Testing Library/jsdom for UI, node-environment **PGlite** for PostgreSQL integration. Real PostgreSQL constraints, triggers, grants and RLS execute in PGlite; Auth identity and Storage schemas/roles are simulated. Repository query-serialization/unit tests often mock network responses and are not hosted integration tests.

Command run successfully on 2026-10-03 from repository root:

```powershell
& 'C:/Program Files/nodejs/node.exe' node_modules/vitest/vitest.mjs run --exclude '**/.kilo/**' --exclude '**/bookableDoctorSeed.test.js' --exclude '**/phase4DatabaseSchema.test.js' --exclude '**/phase9AppointmentManagement.test.js'
```

Result: **987 passed / 0 failed, 67 test files**, duration about 55 seconds. No tests were edited. The 15 repair suites account for **404 tests**; the separate appointment pricing payload unit test adds one further security-related check. Do not add these counts to 987: they are subsets of it.

Security suites: prescriptionPatientIntegrity, followUpPatientIntegrity, suspendedProviderClinicalAccess, appointmentPricingIntegrity, encounterAppointmentIntegrity, paymentAppointmentIntegrity, notificationMarkReadIntegrity, vitalEncounterIntegrity, subscriptionPaymentIntegrity, medicationEventIntegrity, monitoringAlertVitalIntegrity, medicationPrescriptionIntegrity, appointmentCareRequestIntegrity, careAssignmentAppointmentIntegrity, complaintAppointmentIntegrity (all under `src/lib/`, suffix `.integration.test.js`).

Health/identity integration suites: patientProfileIdentity, patientHealthProfiles, vitalReadingsDashboard, patientConditionsAllergies, laboratoryData, clinicalDocuments, medicationSchema, monitoringAlerts, aiHealthSummaryModel, aiHealthOverview. Other suites cover Storage contracts, repositories/dashboard UI, authentication/registration, appointment payloads, guardian safety/gateway and existing application behavior. The appended test-file inventory makes the full scope discoverable.

Repair tests commonly replay a baseline prefix, create deliberate historical fixtures, then apply the target repair. They test before/after exploits, preserved rows/policies and migration aborts; not every individual suite represents all 44 migrations. For this handoff a separate clean replay applied **all 44 in order**, then introspected catalogs to generate the final schema map and per-migration lineage.

**Excluded, not passed:** `bookableDoctorSeed.test.js` expects `20260813000300_seed_bookable_test_doctors.sql`; `phase4DatabaseSchema.test.js` expects `20260810000000_core_presentation_schema.sql` and `20260810000200_phase4_schema_rls.sql`; `phase9AppointmentManagement.test.js` expects `20260813000200_phase9_appointment_management.sql`. Those migration files do not exist. `.kilo/worktrees/**` duplicates were excluded as instructed.

No browser registration/login loop, hosted Auth, real Storage uploads, live model call or production-data inspection was performed during this documentation task. No concurrency certification is implied.

## 15. Decisions the next AI must resolve before issuing an exact command

1. Choose a bounded next phase based on the actual gaps, not an instruction to recreate the earlier V2 health tables.
2. Define household/dependent/guardian identity and consent separately from existing patient-to-family permissions. Current patients require Auth/profile identity; dependent patients without login require an explicit compatibility design.
3. Define clinical plan/version/task/completion ownership; reuse medications, events and follow-ups rather than cloning them or treating subscriptions as clinical plans.
4. Decide self-reported onboarding vs clinician-confirmed facts, canonical demographic fields, no-known-allergy assertions and health-review provenance. Blood type remains canonical on patients for now.
5. Decide whether encounter diagnoses link to longitudinal conditions, which coding vocabulary applies, and how corrections are retained. No AI auto-diagnosis insertion.
6. Define AI conversation persistence/retention and family authority separately from derived summary caching. Preserve existing source provenance, suppression and safety fallback.
7. Define generic alert source ownership before giving polymorphic source_id operational meaning; keep alert conditions separate from notification delivery.
8. Decide how Health Story reads existing records, how amendments/supersession appear and what access logging is needed; avoid duplicated clinical sources of truth.
9. Specify which writers are service-only vs clinician/patient/family, and how future UI requirements interact with existing column grants/RPCs. Do not assume read permission implies write permission.
10. Separate compatibility cleanup (seed, absent RPCs, synthetic screens) from the approved new schema scope. Preserve the frozen security foundation and leave accepted debt untouched unless explicitly authorized.

This handoff supplies facts and decision boundaries; it does not implement or prescribe an unapproved schema design.

## Appendix A. Complete migration execution order

1. `20260820010000_identity.sql`
2. `20260820010100_patient_family.sql`
3. `20260820010200_provider_supply.sql`
4. `20260820010300_booking.sql`
5. `20260820010400_clinical.sql`
6. `20260820010500_medication.sql`
7. `20260820010600_coordination.sql`
8. `20260820010700_commercial.sql`
9. `20260820010800_governance.sql`
10. `20260820010900_ai_security.sql`
11. `20260820011000_patient_registration.sql`
12. `20260820011100_simplify_patient_auth.sql`
13. `20260821090000_patient_registration_service_role_lookup.sql`
14. `20260821091000_patient_authenticated_self_read.sql`
15. `20260821100000_patient_doctor_directory.sql`
16. `20260821101000_patient_availability_read_access.sql`
17. `20260821102000_patient_appointment_booking.sql`
18. `20260821103000_patient_profile_self_service.sql`
19. `20260821104000_patient_medication_read_model.sql`
20. `20260928090000_patient_profile_identity_repair.sql`
21. `20260929090000_patient_health_profiles.sql`
22. `20260929100000_vital_readings_dashboard_metadata.sql`
23. `20260929110000_patient_conditions_allergies_metadata.sql`
24. `20260929120000_laboratory_data.sql`
25. `20260929130000_clinical_documents.sql`
26. `20260929140000_medication_schema_improvements.sql`
27. `20260929150000_monitoring_alert_metadata.sql`
28. `20260929160000_ai_health_summary_model.sql`
29. `20260929170000_ai_overview_cache.sql`
30. `20261001090000_prescription_patient_integrity.sql`
31. `20261001100000_follow_up_patient_integrity.sql`
32. `20261001110000_suspended_provider_clinical_access.sql`
33. `20261001120000_appointment_pricing_integrity.sql`
34. `20261002090000_encounter_appointment_integrity.sql`
35. `20261002100000_payment_appointment_integrity.sql`
36. `20261002110000_notification_mark_read_integrity.sql`
37. `20261002120000_vital_encounter_integrity.sql`
38. `20261002130000_subscription_payment_integrity.sql`
39. `20261002140000_medication_event_patient_integrity.sql`
40. `20261002150000_monitoring_alert_vital_patient_integrity.sql`
41. `20261002160000_medication_prescription_patient_integrity.sql`
42. `20261002170000_appointment_care_request_patient_integrity.sql`
43. `20261002180000_care_assignment_appointment_patient_integrity.sql`
44. `20261002190000_complaint_appointment_patient_integrity.sql`

## Appendix B. Test-file inventory

Excluded legacy suites are explicitly marked; the three obsolete files are not part of the 67 passing files.

- `src/features/appointments/consultationDemo.test.js`
- `src/features/auth/AuthContext.test.jsx`
- `src/features/auth/PasswordResetDemoFlow.test.jsx`
- `src/features/auth/RegisterPage.test.jsx`
- `src/features/auth/registrationSchema.test.js`
- `src/features/dashboard/AIHealthOverview.test.jsx`
- `src/features/dashboard/DashboardPage.test.jsx`
- `src/features/doctors/patientBookingContext.test.js`
- `src/features/guardian/guardianSafety.test.js`
- `src/features/health/HealthPages.test.jsx`
- `src/features/health/medicationBackendContract.test.js`
- `src/features/localization/localization.test.jsx`
- `src/features/secondary/SecondaryPages.test.jsx`
- `src/features/secondary/patientSettingsContract.test.js`
- `src/lib/aiHealthOverview.integration.test.js`
- `src/lib/aiHealthSummaryModel.integration.test.js`
- `src/lib/appointmentCareRequestIntegrity.integration.test.js`
- `src/lib/appointmentPricingIntegrity.integration.test.js`
- `src/lib/authSecurityBoundary.test.js`
- `src/lib/bookableDoctorSeed.test.js` ? **EXCLUDED OBSOLETE**
- `src/lib/careAssignmentAppointmentIntegrity.integration.test.js`
- `src/lib/clinicalDocuments.integration.test.js`
- `src/lib/clinicalDocumentsStorage.test.js`
- `src/lib/complaintAppointmentIntegrity.integration.test.js`
- `src/lib/databaseMigration.test.js`
- `src/lib/encounterAppointmentIntegrity.integration.test.js`
- `src/lib/followUpPatientIntegrity.integration.test.js`
- `src/lib/laboratoryData.integration.test.js`
- `src/lib/medicationEventIntegrity.integration.test.js`
- `src/lib/medicationPrescriptionIntegrity.integration.test.js`
- `src/lib/medicationSchema.integration.test.js`
- `src/lib/monitoringAlertVitalIntegrity.integration.test.js`
- `src/lib/monitoringAlerts.integration.test.js`
- `src/lib/notificationMarkReadIntegrity.integration.test.js`
- `src/lib/patientAppointmentBookingMigration.test.js`
- `src/lib/patientAuthenticatedSelfReadMigration.test.js`
- `src/lib/patientAvailabilityReadAccessMigration.test.js`
- `src/lib/patientConditionsAllergies.integration.test.js`
- `src/lib/patientDoctorDirectoryMigration.test.js`
- `src/lib/patientHealthProfiles.integration.test.js`
- `src/lib/patientMedicationReadModelMigration.test.js`
- `src/lib/patientProfileIdentity.integration.test.js`
- `src/lib/patientProfileSelfServiceMigration.test.js`
- `src/lib/patientRegistrationServiceRoleGrant.test.js`
- `src/lib/paymentAppointmentIntegrity.integration.test.js`
- `src/lib/phase11Routes.test.js`
- `src/lib/phase12Routes.test.js`
- `src/lib/phase13Accessibility.test.js`
- `src/lib/phase4DatabaseSchema.test.js` ? **EXCLUDED OBSOLETE**
- `src/lib/phase9AppointmentManagement.test.js` ? **EXCLUDED OBSOLETE**
- `src/lib/prescriptionPatientIntegrity.integration.test.js`
- `src/lib/simplifiedPatientAuthMigration.test.js`
- `src/lib/subscriptionPaymentIntegrity.integration.test.js`
- `src/lib/supabase.test.js`
- `src/lib/suspendedProviderClinicalAccess.integration.test.js`
- `src/lib/vitalEncounterIntegrity.integration.test.js`
- `src/lib/vitalReadingsDashboard.integration.test.js`
- `src/services/aiHealthOverviewService.test.js`
- `src/services/authService.test.js`
- `src/services/bookingService.test.js`
- `src/services/dashboardPageService.test.js`
- `src/services/guardianGatewayService.test.js`
- `src/services/passwordResetDemoService.test.js`
- `src/services/repositories/appointmentPricingPayload.test.js`
- `src/services/repositories/appointmentRepositoryContract.test.js`
- `src/services/repositories/patientDashboardRepository.test.js`
- `src/services/repositories/repositories.test.js`
- `supabase/functions/_shared/guardian-gateway.test.js`
- `supabase/functions/_shared/guardian-provider.test.js`
- `supabase/functions/_shared/registration-core.test.js`

## Appendix C. Documentation-only changes

Created `supabase/database-v2-handoff.md` and `supabase/database-v2-schema-map.md`. No database migrations, application code, tests, RLS, functions, deployment configuration or seed files were edited. All database replay activity used disposable local PGlite instances, not the project database.
