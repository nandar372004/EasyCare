# EasyCare current schema map

Generated 2026-10-03 from a clean replay of all 44 repository migrations. This is the final cumulative schema, including Repairs 1?15. See database-v2-handoff.md for interpretation and application usage.

## Scope and grant caveat

Public application tables only; managed auth/storage tables are not included in the table count. Auth/Storage were simulated for PGlite replay. The harness grants broad default table privileges to anon/authenticated/service_role before migrations; catalog ACLs below therefore describe that harness plus migration revocations, NOT verified hosted Supabase grants. Explicit grant/revoke migration statements are separately listed below. RLS expressions and schema objects are real migration outputs. Owners/BYPASSRLS roles bypass RLS; they do not ordinarily bypass constraints/triggers, but privileged operators can disable/drop enforcement.

Counts: 48 tables; 113 FKs; 102 public RLS policies; 6 storage policies; 126 indexes; 40 user triggers.

## Controlled enum values

- **active_status**: active, inactive.
- **ai_interaction_type**: health_assistant, symptom_screening, provider_matching.
- **ai_review_status**: generated, reviewed, hidden.
- **ai_summary_type**: daily, weekly.
- **alert_severity**: info, warning, critical.
- **alert_status**: open, acknowledged, escalated, resolved.
- **allergy_severity**: mild, moderate, severe.
- **appointment_status**: pending, confirmed, cancelled, completed, no_show, rescheduled.
- **assignment_status**: suggested, assigned, accepted, rejected, cancelled.
- **availability_status**: available, held, booked, unavailable.
- **billing_period**: one_time, monthly, quarterly.
- **care_request_status**: new, triaged, matching, booked, escalated, closed, cancelled.
- **care_request_type**: teleconsultation, doctor_home_visit, nurse_home_visit, caregiver.
- **care_urgency**: unassessed, routine, urgent, emergency.
- **catalog_service_type**: teleconsultation, home_visit, nursing, caregiver.
- **clinic_role**: doctor, nurse, caregiver, sub_admin.
- **clinic_status**: pending, active, suspended.
- **clinical_note_type**: assessment, progress, nursing, caregiver, discharge, follow_up.
- **complaint_status**: open, investigating, resolved, closed.
- **condition_status**: active, resolved, historical.
- **consent_status**: granted, withdrawn.
- **consent_type**: care, data_processing, family_access, teleconsultation, AI_assistance.
- **coordinator_status**: active, unavailable, inactive.
- **encounter_status**: open, completed, amended.
- **encounter_type**: teleconsultation, home_visit, nursing_care, caregiver_visit.
- **family_authorization_status**: pending, active, revoked.
- **follow_up_status**: pending, completed, cancelled.
- **follow_up_type**: call, appointment, monitoring, medication.
- **history_category**: surgery, hospitalization, vaccination, imaging, other.
- **medication_event_status**: pending, taken, missed, skipped, unknown.
- **notification_channel**: in_app, push, sms, phone, messenger, viber.
- **notification_status**: queued, sent, delivered, failed, read.
- **notification_type**: booking, visit_status, medication, follow_up, health_alert, family_update.
- **patient_medication_status**: active, paused, completed, discontinued.
- **payment_status**: pending, authorized, paid, failed, refunded, partially_refunded.
- **prescription_status**: active, completed, cancelled.
- **pricing_rule_type**: night_surcharge, travel, emergency, commission.
- **pricing_value_type**: fixed, percentage.
- **profile_role**: patient, family, doctor, nurse, caregiver, coordinator, clinic_admin, main_admin.
- **profile_status**: active, suspended, inactive.
- **provider_type**: doctor, nurse, nurse_aide, caregiver.
- **renewal_type**: manual, automatic.
- **service_mode**: teleconsultation, home_visit.
- **subscription_status**: pending, active, paused, cancelled, expired.
- **teleconsultation_status**: scheduled, active, completed, failed.
- **verification_status**: pending, verified, rejected, suspended.
- **visit_status**: requested, assigned, accepted, en_route, arrived, in_progress, completed, cancelled.
- **vital_source**: manual, provider, device.

## ai_health_summaries

Created by: `20260820010900_ai_security.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260929160000_ai_health_summary_model.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Derived AI information, not an authoritative clinical record. Never automatically promote conclusions to patient_conditions. Preserve source/model/prompt provenance and retain old rows when superseding.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010900_ai_security.sql`
- `20260929160000_ai_health_summary_model.sql`
- `20260929170000_ai_overview_cache.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_id | uuid | NO | ? | ? |
| period_start | timestamp with time zone | NO | ? | ? |
| period_end | timestamp with time zone | NO | ? | ? |
| summary_type | ai_summary_type | NO | ? | ? |
| summary_text | text | NO | ? | ? |
| source_snapshot | jsonb | YES | ? | Generation inputs/provenance; preserve historical JSON unchanged. Trusted producer must include only data belonging to the summary patient and retain source identifiers/times. |
| review_status | ai_review_status | NO | 'generated'::ai_review_status | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |
| overall_status | text | YES | ? | Optional descriptive model output, not a clinical classification or a threshold rule. |
| things_to_watch | jsonb | YES | '[]'::jsonb | ? |
| recommended_actions | jsonb | YES | '[]'::jsonb | ? |
| urgency_level | care_urgency | YES | 'unassessed'::care_urgency | ? |
| source_data_hash | text | YES | ? | Optional lowercase SHA-256 of the producer-canonicalized generation input. Hash format is checked; content equivalence must be verified by the producer. Legacy unknown hashes remain NULL. |
| model_provider | text | YES | ? | ? |
| model_name | text | YES | ? | ? |
| model_version | text | YES | ? | ? |
| prompt_version | text | YES | ? | ? |
| generated_at | timestamp with time zone | YES | statement_timestamp() | Generation time; historical finite created_at is used as the best available fallback. |
| expires_at | timestamp with time zone | YES | ? | ? |
| reviewed_by_profile_id | uuid | YES | ? | ? |
| reviewed_at | timestamp with time zone | YES | ? | ? |
| superseded_by_id | uuid | YES | ? | ? |

### Constraints

```sql
-- ai_health_summaries_check; validated=true
CHECK (period_end > period_start)
```
```sql
-- ai_health_summaries_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- ai_health_summaries_id_not_null; validated=true
NOT NULL id
```
```sql
-- ai_health_summaries_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- ai_health_summaries_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- ai_health_summaries_period_end_not_null; validated=true
NOT NULL period_end
```
```sql
-- ai_health_summaries_period_start_not_null; validated=true
NOT NULL period_start
```
```sql
-- ai_health_summaries_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- ai_health_summaries_review_status_not_null; validated=true
NOT NULL review_status
```
```sql
-- ai_health_summaries_reviewed_by_profile_id_fkey; validated=true
FOREIGN KEY (reviewed_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- ai_health_summaries_summary_text_not_null; validated=true
NOT NULL summary_text
```
```sql
-- ai_health_summaries_summary_type_not_null; validated=true
NOT NULL summary_type
```
```sql
-- ai_summaries_actions_check; validated=true
CHECK (recommended_actions IS NULL OR jsonb_typeof(recommended_actions) = 'array'::text)
```
```sql
-- ai_summaries_expiry_check; validated=true
CHECK (expires_at IS NULL OR isfinite(expires_at) AND generated_at IS NOT NULL AND expires_at > generated_at)
```
```sql
-- ai_summaries_generated_check; validated=true
CHECK (generated_at IS NULL OR isfinite(generated_at))
```
```sql
-- ai_summaries_hash_check; validated=true
CHECK (source_data_hash IS NULL OR source_data_hash ~ '^[a-f0-9]{64}$'::text AND source_snapshot IS NOT NULL AND source_snapshot <> 'null'::jsonb)
```
```sql
-- ai_summaries_id_patient_key; validated=true
UNIQUE (id, patient_id)
```
```sql
-- ai_summaries_model_check; validated=true
CHECK (model_name IS NULL OR length(btrim(model_name)) >= 1 AND length(btrim(model_name)) <= 200)
```
```sql
-- ai_summaries_model_version_check; validated=true
CHECK (model_version IS NULL OR length(btrim(model_version)) >= 1 AND length(btrim(model_version)) <= 200)
```
```sql
-- ai_summaries_not_self_superseded_check; validated=true
CHECK (superseded_by_id IS NULL OR superseded_by_id <> id)
```
```sql
-- ai_summaries_overall_status_check; validated=true
CHECK (overall_status IS NULL OR length(btrim(overall_status)) >= 1 AND length(btrim(overall_status)) <= 100)
```
```sql
-- ai_summaries_prompt_version_check; validated=true
CHECK (prompt_version IS NULL OR length(btrim(prompt_version)) >= 1 AND length(btrim(prompt_version)) <= 200)
```
```sql
-- ai_summaries_provider_check; validated=true
CHECK (model_provider IS NULL OR length(btrim(model_provider)) >= 1 AND length(btrim(model_provider)) <= 200)
```
```sql
-- ai_summaries_review_pair_check; validated=true
CHECK ((reviewed_by_profile_id IS NULL) = (reviewed_at IS NULL))
```
```sql
-- ai_summaries_review_time_check; validated=true
CHECK (reviewed_at IS NULL OR isfinite(reviewed_at) AND (generated_at IS NULL OR reviewed_at >= generated_at) AND (review_status = ANY (ARRAY['reviewed'::ai_review_status, 'hidden'::ai_review_status])))
```
```sql
-- ai_summaries_superseded_patient_fk; validated=true
FOREIGN KEY (superseded_by_id, patient_id) REFERENCES ai_health_summaries(id, patient_id) ON DELETE RESTRICT DEFERRABLE
```
```sql
-- ai_summaries_watch_check; validated=true
CHECK (things_to_watch IS NULL OR jsonb_typeof(things_to_watch) = 'array'::text)
```

### Indexes

```sql
-- ai_health_summaries_pkey
CREATE UNIQUE INDEX ai_health_summaries_pkey ON public.ai_health_summaries USING btree (id)
```
```sql
-- ai_summaries_current_period_key
CREATE UNIQUE INDEX ai_summaries_current_period_key ON public.ai_health_summaries USING btree (patient_id, summary_type, period_start, period_end) WHERE (superseded_by_id IS NULL)
```
```sql
-- ai_summaries_id_patient_key
CREATE UNIQUE INDEX ai_summaries_id_patient_key ON public.ai_health_summaries USING btree (id, patient_id)
```
```sql
-- ai_summaries_patient_generated_idx
CREATE INDEX ai_summaries_patient_generated_idx ON public.ai_health_summaries USING btree (patient_id, generated_at DESC)
```
```sql
-- ai_summaries_reviewer_idx
CREATE INDEX ai_summaries_reviewer_idx ON public.ai_health_summaries USING btree (reviewed_by_profile_id) WHERE (reviewed_by_profile_id IS NOT NULL)
```
```sql
-- ai_summaries_superseded_idx
CREATE INDEX ai_summaries_superseded_idx ON public.ai_health_summaries USING btree (superseded_by_id) WHERE (superseded_by_id IS NOT NULL)
```

### Triggers

None.

### Policies

**ai_summaries_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: ((review_status <> 'hidden'::ai_review_status) AND can_access_patient(patient_id, 'clinical'::text))
WITH CHECK: not specified
```

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,service_role=arwm/postgres,authenticated=r/postgres}`


## ai_interactions

Created by: `20260820010900_ai_security.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20261001110000_suspended_provider_clinical_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Summarized AI input/output event and review indicator.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010900_ai_security.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_id | uuid | YES | ? | ? |
| user_profile_id | uuid | NO | ? | ? |
| interaction_type | ai_interaction_type | NO | ? | ? |
| input_summary | jsonb | YES | ? | ? |
| output_summary | jsonb | YES | ? | ? |
| urgency_level | care_urgency | YES | ? | ? |
| model_version | text | YES | ? | ? |
| human_review_required | boolean | NO | false | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- ai_interactions_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- ai_interactions_human_review_required_not_null; validated=true
NOT NULL human_review_required
```
```sql
-- ai_interactions_id_not_null; validated=true
NOT NULL id
```
```sql
-- ai_interactions_interaction_type_not_null; validated=true
NOT NULL interaction_type
```
```sql
-- ai_interactions_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- ai_interactions_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- ai_interactions_user_profile_id_fkey; validated=true
FOREIGN KEY (user_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- ai_interactions_user_profile_id_not_null; validated=true
NOT NULL user_profile_id
```

### Indexes

```sql
-- ai_interactions_patient_created_idx
CREATE INDEX ai_interactions_patient_created_idx ON public.ai_interactions USING btree (patient_id, created_at DESC) WHERE (patient_id IS NOT NULL)
```
```sql
-- ai_interactions_pkey
CREATE UNIQUE INDEX ai_interactions_pkey ON public.ai_interactions USING btree (id)
```

### Triggers

None.

### Policies

**ai_interactions_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: ((user_profile_id = auth.uid()) AND ((patient_id IS NULL) OR can_access_patient(patient_id, 'view'::text)))
WITH CHECK: not specified
```

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## ai_overview_leases

Created by: `20260929170000_ai_overview_cache.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):


Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Patient-specific generation lease/cooldown.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260929170000_ai_overview_cache.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| patient_id | uuid | NO | ? | ? |
| token | uuid | NO | ? | ? |
| lease_until | timestamp with time zone | NO | ? | ? |
| retry_after | timestamp with time zone | NO | ? | ? |

### Constraints

```sql
-- ai_overview_leases_lease_until_not_null; validated=true
NOT NULL lease_until
```
```sql
-- ai_overview_leases_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- ai_overview_leases_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- ai_overview_leases_pkey; validated=true
PRIMARY KEY (patient_id)
```
```sql
-- ai_overview_leases_retry_after_not_null; validated=true
NOT NULL retry_after
```
```sql
-- ai_overview_leases_token_not_null; validated=true
NOT NULL token
```

### Indexes

```sql
-- ai_overview_leases_pkey
CREATE UNIQUE INDEX ai_overview_leases_pkey ON public.ai_overview_leases USING btree (patient_id)
```

### Triggers

None.

### Policies

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## ai_overview_request_limits

Created by: `20260929170000_ai_overview_cache.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):


Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Patient-specific AI overview request budget.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260929170000_ai_overview_cache.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| patient_id | uuid | NO | ? | ? |
| window_start | timestamp with time zone | NO | ? | ? |
| attempts | integer | NO | ? | ? |

### Constraints

```sql
-- ai_overview_request_limits_attempts_check; validated=true
CHECK (attempts >= 1 AND attempts <= 60)
```
```sql
-- ai_overview_request_limits_attempts_not_null; validated=true
NOT NULL attempts
```
```sql
-- ai_overview_request_limits_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- ai_overview_request_limits_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- ai_overview_request_limits_pkey; validated=true
PRIMARY KEY (patient_id)
```
```sql
-- ai_overview_request_limits_window_start_not_null; validated=true
NOT NULL window_start
```

### Indexes

```sql
-- ai_overview_request_limits_pkey
CREATE UNIQUE INDEX ai_overview_request_limits_pkey ON public.ai_overview_request_limits USING btree (patient_id)
```

### Triggers

None.

### Policies

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## appointments

Created by: `20260820010300_booking.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`
- `20260820011100_simplify_patient_auth.sql`
- `20260821102000_patient_appointment_booking.sql`
- `20261001100000_follow_up_patient_integrity.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261001120000_appointment_pricing_integrity.sql`
- `20261002090000_encounter_appointment_integrity.sql`
- `20261002170000_appointment_care_request_patient_integrity.sql`
- `20261002180000_care_assignment_appointment_patient_integrity.sql`
- `20261002190000_complaint_appointment_patient_integrity.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Scheduled provider service, price, booking identifier.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010300_booking.sql`
- `20260820010400_clinical.sql`
- `20260820010700_commercial.sql`
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`
- `20260820011100_simplify_patient_auth.sql`
- `20260821102000_patient_appointment_booking.sql`
- `20261001100000_follow_up_patient_integrity.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261001120000_appointment_pricing_integrity.sql`
- `20261002090000_encounter_appointment_integrity.sql`
- `20261002100000_payment_appointment_integrity.sql`
- `20261002170000_appointment_care_request_patient_integrity.sql`
- `20261002180000_care_assignment_appointment_patient_integrity.sql`
- `20261002190000_complaint_appointment_patient_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| care_request_id | uuid | YES | ? | ? |
| patient_id | uuid | NO | ? | ? |
| provider_id | uuid | NO | ? | ? |
| booked_by_profile_id | uuid | YES | ? | ? |
| appointment_type | service_mode | NO | ? | ? |
| scheduled_start | timestamp with time zone | NO | ? | ? |
| scheduled_end | timestamp with time zone | NO | ? | ? |
| reason_symptoms | text | YES | ? | ? |
| status | appointment_status | NO | 'pending'::appointment_status | ? |
| fee_amount | numeric(12,2) | NO | 0 | ? |
| currency | character(3) | NO | 'MMK'::bpchar | ? |
| cancelled_at | timestamp with time zone | YES | ? | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |
| updated_at | timestamp with time zone | NO | statement_timestamp() | ? |
| provider_availability_id | uuid | YES | ? | ? |
| consultation_channel | text | NO | ? | ? |
| booking_code | text | NO | ? | ? |

### Constraints

```sql
-- appointments_appointment_type_not_null; validated=true
NOT NULL appointment_type
```
```sql
-- appointments_booked_by_profile_id_fkey; validated=true
FOREIGN KEY (booked_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- appointments_booking_code_not_null; validated=true
NOT NULL booking_code
```
```sql
-- appointments_care_request_id_fkey; validated=true
FOREIGN KEY (care_request_id) REFERENCES care_requests(id) ON DELETE RESTRICT
```
```sql
-- appointments_care_request_patient_fk; validated=true
FOREIGN KEY (care_request_id, patient_id) REFERENCES care_requests(id, patient_id) ON UPDATE RESTRICT ON DELETE RESTRICT
```
```sql
-- appointments_check; validated=true
CHECK (scheduled_end > scheduled_start)
```
```sql
-- appointments_check1; validated=true
CHECK ((status = 'cancelled'::appointment_status) = (cancelled_at IS NOT NULL))
```
```sql
-- appointments_consultation_channel_check; validated=true
CHECK (appointment_type = 'teleconsultation'::service_mode AND (consultation_channel = ANY (ARRAY['video'::text, 'voice'::text])) OR appointment_type = 'home_visit'::service_mode AND consultation_channel = 'home_visit'::text)
```
```sql
-- appointments_consultation_channel_not_null; validated=true
NOT NULL consultation_channel
```
```sql
-- appointments_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- appointments_currency_not_null; validated=true
NOT NULL currency
```
```sql
-- appointments_fee_amount_check; validated=true
CHECK (fee_amount >= 0::numeric)
```
```sql
-- appointments_fee_amount_not_null; validated=true
NOT NULL fee_amount
```
```sql
-- appointments_id_not_null; validated=true
NOT NULL id
```
```sql
-- appointments_id_patient_key; validated=true
UNIQUE (id, patient_id)
```
```sql
-- appointments_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- appointments_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- appointments_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- appointments_provider_availability_id_fkey; validated=true
FOREIGN KEY (provider_availability_id) REFERENCES provider_availability(id) ON DELETE RESTRICT
```
```sql
-- appointments_provider_id_fkey; validated=true
FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE RESTRICT
```
```sql
-- appointments_provider_id_not_null; validated=true
NOT NULL provider_id
```
```sql
-- appointments_provider_no_overlap; validated=true
EXCLUDE USING gist (provider_id WITH =, tstzrange(scheduled_start, scheduled_end, '[)'::text) WITH &&) WHERE (status = ANY (ARRAY['pending'::appointment_status, 'confirmed'::appointment_status, 'rescheduled'::appointment_status]))
```
```sql
-- appointments_scheduled_end_not_null; validated=true
NOT NULL scheduled_end
```
```sql
-- appointments_scheduled_start_not_null; validated=true
NOT NULL scheduled_start
```
```sql
-- appointments_status_not_null; validated=true
NOT NULL status
```
```sql
-- appointments_updated_at_not_null; validated=true
NOT NULL updated_at
```

### Indexes

```sql
-- appointments_active_availability_key
CREATE UNIQUE INDEX appointments_active_availability_key ON public.appointments USING btree (provider_availability_id) WHERE ((provider_availability_id IS NOT NULL) AND (status = ANY (ARRAY['pending'::appointment_status, 'confirmed'::appointment_status, 'rescheduled'::appointment_status])))
```
```sql
-- appointments_booking_code_key
CREATE UNIQUE INDEX appointments_booking_code_key ON public.appointments USING btree (booking_code)
```
```sql
-- appointments_id_patient_key
CREATE UNIQUE INDEX appointments_id_patient_key ON public.appointments USING btree (id, patient_id)
```
```sql
-- appointments_patient_start_idx
CREATE INDEX appointments_patient_start_idx ON public.appointments USING btree (patient_id, scheduled_start)
```
```sql
-- appointments_pkey
CREATE UNIQUE INDEX appointments_pkey ON public.appointments USING btree (id)
```
```sql
-- appointments_provider_no_overlap
CREATE INDEX appointments_provider_no_overlap ON public.appointments USING gist (provider_id, tstzrange(scheduled_start, scheduled_end, '[)'::text)) WHERE (status = ANY (ARRAY['pending'::appointment_status, 'confirmed'::appointment_status, 'rescheduled'::appointment_status]))
```
```sql
-- appointments_provider_start_idx
CREATE INDEX appointments_provider_start_idx ON public.appointments USING btree (provider_id, scheduled_start)
```
```sql
-- appointments_status_idx
CREATE INDEX appointments_status_idx ON public.appointments USING btree (status)
```

### Triggers

```sql
-- appointments_assignment_guard; enabled=O
CREATE TRIGGER appointments_assignment_guard BEFORE UPDATE OF patient_id ON appointments FOR EACH ROW EXECUTE FUNCTION check_care_assignment_patient_chain()
```
```sql
-- appointments_audit; enabled=O
CREATE TRIGGER appointments_audit AFTER INSERT OR DELETE OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION audit_row_change()
```
```sql
-- appointments_complaint_guard; enabled=O
CREATE TRIGGER appointments_complaint_guard BEFORE UPDATE OF patient_id ON appointments FOR EACH ROW EXECUTE FUNCTION check_complaint_appointment_patient_chain()
```
```sql
-- appointments_enforce_pricing; enabled=O
CREATE TRIGGER appointments_enforce_pricing BEFORE INSERT OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION enforce_appointment_pricing()
```
```sql
-- appointments_mark_availability_booked; enabled=O
CREATE TRIGGER appointments_mark_availability_booked AFTER INSERT ON appointments FOR EACH ROW WHEN (new.provider_availability_id IS NOT NULL) EXECUTE FUNCTION mark_booked_provider_availability()
```
```sql
-- appointments_updated_at; enabled=O
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION set_updated_at()
```
```sql
-- follow_ups_appointment_parent_guard; enabled=O
CREATE TRIGGER follow_ups_appointment_parent_guard BEFORE UPDATE OF patient_id ON appointments FOR EACH ROW EXECUTE FUNCTION check_follow_up_parent_chain()
```

### Policies

**appointments_patient_create** ? PERMISSIVE INSERT TO ["authenticated"]

```sql
USING: not specified
WITH CHECK: ((status = 'pending'::appointment_status) AND (cancelled_at IS NULL) AND (booked_by_profile_id IS NULL) AND (EXISTS ( SELECT 1
   FROM patients patient
  WHERE ((patient.id = appointments.patient_id) AND (patient.auth_user_id = auth.uid()) AND (patient.status = 'active'::text)))) AND (EXISTS ( SELECT 1
   FROM providers provider
  WHERE ((provider.id = appointments.provider_id) AND (provider.provider_type = 'doctor'::provider_type) AND (provider.verification_status = 'verified'::verification_status)))) AND (EXISTS ( SELECT 1
   FROM provider_availability availability
  WHERE ((availability.id = appointments.provider_availability_id) AND (availability.provider_id = appointments.provider_id) AND (availability.status = 'available'::availability_status) AND (availability.start_at = appointments.scheduled_start) AND (availability.end_at = appointments.scheduled_end) AND (availability.service_type = appointments.appointment_type)))))
```

**appointments_patient_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: (EXISTS ( SELECT 1
   FROM patients patient
  WHERE ((patient.id = appointments.patient_id) AND (patient.auth_user_id = auth.uid()))))
WITH CHECK: not specified
```

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`

- Column `id`: `{authenticated=r/postgres}`
- Column `patient_id`: `{authenticated=ar/postgres}`
- Column `provider_id`: `{authenticated=ar/postgres}`
- Column `booked_by_profile_id`: `{authenticated=a/postgres}`
- Column `appointment_type`: `{authenticated=ar/postgres}`
- Column `scheduled_start`: `{authenticated=ar/postgres}`
- Column `scheduled_end`: `{authenticated=ar/postgres}`
- Column `reason_symptoms`: `{authenticated=ar/postgres}`
- Column `status`: `{authenticated=ar/postgres}`
- Column `fee_amount`: `{authenticated=ar/postgres}`
- Column `currency`: `{authenticated=ar/postgres}`
- Column `created_at`: `{authenticated=r/postgres}`
- Column `provider_availability_id`: `{authenticated=ar/postgres}`
- Column `consultation_channel`: `{authenticated=ar/postgres}`
- Column `booking_code`: `{authenticated=ar/postgres}`

## audit_logs

Created by: `20260820010800_governance.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Trigger-generated row-change audit.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | bigint | NO | ? | ? |
| actor_profile_id | uuid | YES | ? | ? |
| patient_id | uuid | YES | ? | ? |
| action | text | NO | ? | ? |
| entity_table | text | NO | ? | ? |
| entity_id | text | YES | ? | ? |
| before_data | jsonb | YES | ? | ? |
| after_data | jsonb | YES | ? | ? |
| ip_address | inet | YES | ? | ? |
| user_agent | text | YES | ? | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- audit_logs_action_not_null; validated=true
NOT NULL action
```
```sql
-- audit_logs_actor_profile_id_fkey; validated=true
FOREIGN KEY (actor_profile_id) REFERENCES profiles(id) ON DELETE SET NULL
```
```sql
-- audit_logs_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- audit_logs_entity_table_not_null; validated=true
NOT NULL entity_table
```
```sql
-- audit_logs_id_not_null; validated=true
NOT NULL id
```
```sql
-- audit_logs_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL
```
```sql
-- audit_logs_pkey; validated=true
PRIMARY KEY (id)
```

### Indexes

```sql
-- audit_logs_actor_idx
CREATE INDEX audit_logs_actor_idx ON public.audit_logs USING btree (actor_profile_id, created_at DESC)
```
```sql
-- audit_logs_entity_idx
CREATE INDEX audit_logs_entity_idx ON public.audit_logs USING btree (entity_table, entity_id, created_at DESC)
```
```sql
-- audit_logs_patient_idx
CREATE INDEX audit_logs_patient_idx ON public.audit_logs USING btree (patient_id, created_at DESC) WHERE (patient_id IS NOT NULL)
```
```sql
-- audit_logs_pkey
CREATE UNIQUE INDEX audit_logs_pkey ON public.audit_logs USING btree (id)
```

### Triggers

```sql
-- audit_logs_immutable; enabled=O
CREATE TRIGGER audit_logs_immutable BEFORE DELETE OR UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_immutable_change()
```

### Policies

**audit_admin_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: is_main_admin()
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## care_assignments

Created by: `20260820010300_booking.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002180000_care_assignment_appointment_patient_integrity.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Coordinator/provider match for a request, optional appointment.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010300_booking.sql`
- `20260820010900_ai_security.sql`
- `20260820011100_simplify_patient_auth.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002180000_care_assignment_appointment_patient_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| care_request_id | uuid | NO | ? | ? |
| appointment_id | uuid | YES | ? | ? |
| provider_id | uuid | NO | ? | ? |
| assigned_by_profile_id | uuid | NO | ? | ? |
| match_score | numeric | YES | ? | ? |
| match_reason | jsonb | YES | ? | ? |
| status | assignment_status | NO | ? | ? |
| assigned_at | timestamp with time zone | YES | ? | ? |
| responded_at | timestamp with time zone | YES | ? | ? |

### Constraints

```sql
-- care_assignments_appointment_id_fkey; validated=true
FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE RESTRICT
```
```sql
-- care_assignments_assigned_by_profile_id_fkey; validated=true
FOREIGN KEY (assigned_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- care_assignments_assigned_by_profile_id_not_null; validated=true
NOT NULL assigned_by_profile_id
```
```sql
-- care_assignments_care_request_id_fkey; validated=true
FOREIGN KEY (care_request_id) REFERENCES care_requests(id) ON DELETE RESTRICT
```
```sql
-- care_assignments_care_request_id_not_null; validated=true
NOT NULL care_request_id
```
```sql
-- care_assignments_id_not_null; validated=true
NOT NULL id
```
```sql
-- care_assignments_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- care_assignments_provider_id_fkey; validated=true
FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE RESTRICT
```
```sql
-- care_assignments_provider_id_not_null; validated=true
NOT NULL provider_id
```
```sql
-- care_assignments_status_not_null; validated=true
NOT NULL status
```

### Indexes

```sql
-- care_assignments_pkey
CREATE UNIQUE INDEX care_assignments_pkey ON public.care_assignments USING btree (id)
```

### Triggers

```sql
-- care_assignments_patient_chain; enabled=O
CREATE TRIGGER care_assignments_patient_chain BEFORE INSERT OR UPDATE OF care_request_id, appointment_id ON care_assignments FOR EACH ROW EXECUTE FUNCTION check_care_assignment_patient_chain()
```

### Policies

**assignments_coordinator_manage** ? PERMISSIVE ALL TO ["authenticated"]

```sql
USING: (is_main_admin() OR ((current_profile_role() = 'coordinator'::profile_role) AND (EXISTS ( SELECT 1
   FROM (care_requests cr
     JOIN care_coordinators cc ON ((cc.id = cr.coordinator_id)))
  WHERE ((cr.id = care_assignments.care_request_id) AND (cc.profile_id = auth.uid()))))))
WITH CHECK: (is_main_admin() OR ((current_profile_role() = 'coordinator'::profile_role) AND (EXISTS ( SELECT 1
   FROM (care_requests cr
     JOIN care_coordinators cc ON ((cc.id = cr.coordinator_id)))
  WHERE ((cr.id = care_assignments.care_request_id) AND (cc.profile_id = auth.uid()))))))
```

**assignments_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: (EXISTS ( SELECT 1
   FROM care_requests cr
  WHERE ((cr.id = care_assignments.care_request_id) AND can_access_patient(cr.patient_id, 'appointments'::text))))
WITH CHECK: not specified
```

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## care_coordinators

Created by: `20260820010600_coordination.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Coordinator identity/status and capacity.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010600_coordination.sql`
- `20260820010900_ai_security.sql`
- `20260820011100_simplify_patient_auth.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| profile_id | uuid | NO | ? | ? |
| status | coordinator_status | NO | 'active'::coordinator_status | ? |
| max_active_cases | integer | YES | ? | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- care_coordinators_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- care_coordinators_id_not_null; validated=true
NOT NULL id
```
```sql
-- care_coordinators_max_active_cases_check; validated=true
CHECK (max_active_cases IS NULL OR max_active_cases >= 0)
```
```sql
-- care_coordinators_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- care_coordinators_profile_id_fkey; validated=true
FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- care_coordinators_profile_id_key; validated=true
UNIQUE (profile_id)
```
```sql
-- care_coordinators_profile_id_not_null; validated=true
NOT NULL profile_id
```
```sql
-- care_coordinators_status_not_null; validated=true
NOT NULL status
```

### Indexes

```sql
-- care_coordinators_pkey
CREATE UNIQUE INDEX care_coordinators_pkey ON public.care_coordinators USING btree (id)
```
```sql
-- care_coordinators_profile_id_key
CREATE UNIQUE INDEX care_coordinators_profile_id_key ON public.care_coordinators USING btree (profile_id)
```

### Triggers

None.

### Policies

**coordinators_read_self** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: ((profile_id = auth.uid()) OR is_main_admin())
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## care_encounters

Created by: `20260820010400_clinical.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20260929120000_laboratory_data.sql`
- `20261001100000_follow_up_patient_integrity.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002090000_encounter_appointment_integrity.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Actual clinical consultation, assessment and text care plan.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010400_clinical.sql`
- `20260820010500_medication.sql`
- `20260820010600_coordination.sql`
- `20260820010900_ai_security.sql`
- `20260929120000_laboratory_data.sql`
- `20260929130000_clinical_documents.sql`
- `20261001090000_prescription_patient_integrity.sql`
- `20261001100000_follow_up_patient_integrity.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002090000_encounter_appointment_integrity.sql`
- `20261002120000_vital_encounter_integrity.sql`
- `20261002170000_appointment_care_request_patient_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| appointment_id | uuid | NO | ? | ? |
| patient_id | uuid | NO | ? | ? |
| provider_id | uuid | NO | ? | ? |
| encounter_type | encounter_type | NO | ? | ? |
| started_at | timestamp with time zone | YES | ? | ? |
| ended_at | timestamp with time zone | YES | ? | ? |
| chief_complaint | text | YES | ? | ? |
| assessment_summary | text | YES | ? | ? |
| care_plan | text | YES | ? | ? |
| status | encounter_status | NO | 'open'::encounter_status | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |
| updated_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- care_encounters_appointment_id_fkey; validated=true
FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE RESTRICT
```
```sql
-- care_encounters_appointment_id_key; validated=true
UNIQUE (appointment_id)
```
```sql
-- care_encounters_appointment_id_not_null; validated=true
NOT NULL appointment_id
```
```sql
-- care_encounters_appointment_patient_fk; validated=true
FOREIGN KEY (appointment_id, patient_id) REFERENCES appointments(id, patient_id) ON UPDATE RESTRICT ON DELETE RESTRICT
```
```sql
-- care_encounters_check; validated=true
CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)
```
```sql
-- care_encounters_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- care_encounters_encounter_type_not_null; validated=true
NOT NULL encounter_type
```
```sql
-- care_encounters_id_not_null; validated=true
NOT NULL id
```
```sql
-- care_encounters_id_patient_key; validated=true
UNIQUE (id, patient_id)
```
```sql
-- care_encounters_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- care_encounters_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- care_encounters_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- care_encounters_provider_id_fkey; validated=true
FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE RESTRICT
```
```sql
-- care_encounters_provider_id_not_null; validated=true
NOT NULL provider_id
```
```sql
-- care_encounters_status_not_null; validated=true
NOT NULL status
```
```sql
-- care_encounters_updated_at_not_null; validated=true
NOT NULL updated_at
```

### Indexes

```sql
-- care_encounters_appointment_id_key
CREATE UNIQUE INDEX care_encounters_appointment_id_key ON public.care_encounters USING btree (appointment_id)
```
```sql
-- care_encounters_id_patient_key
CREATE UNIQUE INDEX care_encounters_id_patient_key ON public.care_encounters USING btree (id, patient_id)
```
```sql
-- care_encounters_pkey
CREATE UNIQUE INDEX care_encounters_pkey ON public.care_encounters USING btree (id)
```

### Triggers

```sql
-- care_encounters_updated_at; enabled=O
CREATE TRIGGER care_encounters_updated_at BEFORE UPDATE ON care_encounters FOR EACH ROW EXECUTE FUNCTION set_updated_at()
```
```sql
-- follow_ups_encounter_parent_guard; enabled=O
CREATE TRIGGER follow_ups_encounter_parent_guard BEFORE UPDATE OF appointment_id, patient_id ON care_encounters FOR EACH ROW EXECUTE FUNCTION check_follow_up_parent_chain()
```

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**encounters_provider_manage** ? PERMISSIVE ALL TO ["authenticated"]

```sql
USING: can_manage_care_encounter(appointment_id, patient_id, provider_id)
WITH CHECK: can_manage_care_encounter(appointment_id, patient_id, provider_id)
```

**encounters_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: can_access_patient(patient_id, 'clinical'::text)
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## care_packages

Created by: `20260820010700_commercial.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Commercial package catalog.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010700_commercial.sql`
- `20260820010900_ai_security.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| name | text | NO | ? | ? |
| price | numeric(12,2) | YES | ? | ? |
| billing_period | billing_period | YES | ? | ? |
| active | boolean | NO | true | ? |

### Constraints

```sql
-- care_packages_active_not_null; validated=true
NOT NULL active
```
```sql
-- care_packages_id_not_null; validated=true
NOT NULL id
```
```sql
-- care_packages_name_not_null; validated=true
NOT NULL name
```
```sql
-- care_packages_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- care_packages_price_check; validated=true
CHECK (price IS NULL OR price >= 0::numeric)
```

### Indexes

```sql
-- care_packages_pkey
CREATE UNIQUE INDEX care_packages_pkey ON public.care_packages USING btree (id)
```

### Triggers

None.

### Policies

**packages_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: active
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## care_requests

Created by: `20260820010300_booking.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010600_coordination.sql`
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002170000_appointment_care_request_patient_integrity.sql`
- `20261002180000_care_assignment_appointment_patient_integrity.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Patient need, service, urgency and coordinator queue.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010300_booking.sql`
- `20260820010600_coordination.sql`
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`
- `20260820011100_simplify_patient_auth.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002170000_appointment_care_request_patient_integrity.sql`
- `20261002180000_care_assignment_appointment_patient_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_id | uuid | NO | ? | ? |
| requested_by_profile_id | uuid | NO | ? | ? |
| service_type | care_request_type | NO | ? | ? |
| reason_symptoms | text | NO | ? | ? |
| urgency_level | care_urgency | NO | 'unassessed'::care_urgency | ? |
| preferred_date | date | YES | ? | ? |
| preferred_time | time without time zone | YES | ? | ? |
| address_snapshot | jsonb | YES | ? | ? |
| coordinator_id | uuid | YES | ? | ? |
| status | care_request_status | NO | 'new'::care_request_status | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |
| updated_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- care_requests_coordinator_fk; validated=true
FOREIGN KEY (coordinator_id) REFERENCES care_coordinators(id) ON DELETE SET NULL
```
```sql
-- care_requests_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- care_requests_id_not_null; validated=true
NOT NULL id
```
```sql
-- care_requests_id_patient_key; validated=true
UNIQUE (id, patient_id)
```
```sql
-- care_requests_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- care_requests_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- care_requests_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- care_requests_reason_symptoms_not_null; validated=true
NOT NULL reason_symptoms
```
```sql
-- care_requests_requested_by_profile_id_fkey; validated=true
FOREIGN KEY (requested_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- care_requests_requested_by_profile_id_not_null; validated=true
NOT NULL requested_by_profile_id
```
```sql
-- care_requests_service_type_not_null; validated=true
NOT NULL service_type
```
```sql
-- care_requests_status_not_null; validated=true
NOT NULL status
```
```sql
-- care_requests_updated_at_not_null; validated=true
NOT NULL updated_at
```
```sql
-- care_requests_urgency_level_not_null; validated=true
NOT NULL urgency_level
```

### Indexes

```sql
-- care_requests_id_patient_key
CREATE UNIQUE INDEX care_requests_id_patient_key ON public.care_requests USING btree (id, patient_id)
```
```sql
-- care_requests_pkey
CREATE UNIQUE INDEX care_requests_pkey ON public.care_requests USING btree (id)
```
```sql
-- care_requests_queue_idx
CREATE INDEX care_requests_queue_idx ON public.care_requests USING btree (status, urgency_level, created_at)
```

### Triggers

```sql
-- care_requests_assignment_guard; enabled=O
CREATE TRIGGER care_requests_assignment_guard BEFORE UPDATE OF patient_id ON care_requests FOR EACH ROW EXECUTE FUNCTION check_care_assignment_patient_chain()
```
```sql
-- care_requests_audit; enabled=O
CREATE TRIGGER care_requests_audit AFTER INSERT OR DELETE OR UPDATE ON care_requests FOR EACH ROW EXECUTE FUNCTION audit_row_change()
```
```sql
-- care_requests_updated_at; enabled=O
CREATE TRIGGER care_requests_updated_at BEFORE UPDATE ON care_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at()
```

### Policies

**care_requests_coordinator_update** ? PERMISSIVE UPDATE TO ["authenticated"]

```sql
USING: (is_main_admin() OR ((current_profile_role() = 'coordinator'::profile_role) AND (EXISTS ( SELECT 1
   FROM care_coordinators cc
  WHERE ((cc.id = care_requests.coordinator_id) AND (cc.profile_id = auth.uid()))))))
WITH CHECK: (is_main_admin() OR ((current_profile_role() = 'coordinator'::profile_role) AND (EXISTS ( SELECT 1
   FROM care_coordinators cc
  WHERE ((cc.id = care_requests.coordinator_id) AND (cc.profile_id = auth.uid()))))))
```

**care_requests_create** ? PERMISSIVE INSERT TO ["authenticated"]

```sql
USING: not specified
WITH CHECK: ((requested_by_profile_id = auth.uid()) AND (status = 'new'::care_request_status) AND (urgency_level = 'unassessed'::care_urgency) AND can_access_patient(patient_id, 'appointments'::text))
```

**care_requests_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: can_access_patient(patient_id, 'appointments'::text)
WITH CHECK: not specified
```

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## clinic_staff

Created by: `20260820010200_provider_supply.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Clinic profile/provider membership and administrative role.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010200_provider_supply.sql`
- `20260820010900_ai_security.sql`
- `20260820011100_simplify_patient_auth.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| clinic_id | uuid | NO | ? | ? |
| profile_id | uuid | NO | ? | ? |
| provider_id | uuid | YES | ? | ? |
| clinic_role | clinic_role | NO | ? | ? |
| status | active_status | NO | 'active'::active_status | ? |
| joined_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- clinic_staff_clinic_id_fkey; validated=true
FOREIGN KEY (clinic_id) REFERENCES partner_clinics(id) ON DELETE RESTRICT
```
```sql
-- clinic_staff_clinic_id_not_null; validated=true
NOT NULL clinic_id
```
```sql
-- clinic_staff_clinic_id_profile_id_key; validated=true
UNIQUE (clinic_id, profile_id)
```
```sql
-- clinic_staff_clinic_role_not_null; validated=true
NOT NULL clinic_role
```
```sql
-- clinic_staff_id_not_null; validated=true
NOT NULL id
```
```sql
-- clinic_staff_joined_at_not_null; validated=true
NOT NULL joined_at
```
```sql
-- clinic_staff_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- clinic_staff_profile_id_fkey; validated=true
FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- clinic_staff_profile_id_not_null; validated=true
NOT NULL profile_id
```
```sql
-- clinic_staff_provider_id_fkey; validated=true
FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE RESTRICT
```
```sql
-- clinic_staff_status_not_null; validated=true
NOT NULL status
```

### Indexes

```sql
-- clinic_staff_clinic_id_profile_id_key
CREATE UNIQUE INDEX clinic_staff_clinic_id_profile_id_key ON public.clinic_staff USING btree (clinic_id, profile_id)
```
```sql
-- clinic_staff_pkey
CREATE UNIQUE INDEX clinic_staff_pkey ON public.clinic_staff USING btree (id)
```

### Triggers

None.

### Policies

**clinic_staff_self_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: ((profile_id = auth.uid()) OR is_main_admin())
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## clinical_documents

Created by: `20260929130000_clinical_documents.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20261001110000_suspended_provider_clinical_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Metadata only. Content is in the private clinical-documents Storage bucket. Trusted service code validates uploads and writes metadata.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260929130000_clinical_documents.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_id | uuid | NO | ? | ? |
| encounter_id | uuid | YES | ? | ? |
| document_type | text | NO | ? | ? |
| title | text | NO | ? | ? |
| description | text | YES | ? | ? |
| storage_path | text | NO | ? | Bucket-relative patient UUID/document UUID/filename. Never a public URL or signed URL. |
| mime_type | text | NO | ? | ? |
| file_size | bigint | NO | ? | ? |
| document_date | date | YES | ? | ? |
| uploaded_by_profile_id | uuid | NO | ? | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- clinical_documents_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- clinical_documents_created_check; validated=true
CHECK (isfinite(created_at))
```
```sql
-- clinical_documents_date_check; validated=true
CHECK (document_date IS NULL OR isfinite(document_date))
```
```sql
-- clinical_documents_document_type_not_null; validated=true
NOT NULL document_type
```
```sql
-- clinical_documents_encounter_patient_fk; validated=true
FOREIGN KEY (encounter_id, patient_id) REFERENCES care_encounters(id, patient_id) ON DELETE RESTRICT
```
```sql
-- clinical_documents_file_size_not_null; validated=true
NOT NULL file_size
```
```sql
-- clinical_documents_id_not_null; validated=true
NOT NULL id
```
```sql
-- clinical_documents_mime_check; validated=true
CHECK (mime_type ~ '^[a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+$'::text)
```
```sql
-- clinical_documents_mime_type_not_null; validated=true
NOT NULL mime_type
```
```sql
-- clinical_documents_path_check; validated=true
CHECK (split_part(storage_path, '/'::text, 1) = patient_id::text AND split_part(storage_path, '/'::text, 2) = id::text AND storage_path ~ '^[a-f0-9-]+/[a-f0-9-]+/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'::text)
```
```sql
-- clinical_documents_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- clinical_documents_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- clinical_documents_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- clinical_documents_size_check; validated=true
CHECK (file_size > 0)
```
```sql
-- clinical_documents_storage_path_key; validated=true
UNIQUE (storage_path)
```
```sql
-- clinical_documents_storage_path_not_null; validated=true
NOT NULL storage_path
```
```sql
-- clinical_documents_title_check; validated=true
CHECK (length(btrim(title)) >= 1 AND length(btrim(title)) <= 200)
```
```sql
-- clinical_documents_title_not_null; validated=true
NOT NULL title
```
```sql
-- clinical_documents_type_check; validated=true
CHECK (document_type ~ '^[a-z][a-z0-9_]{0,63}$'::text)
```
```sql
-- clinical_documents_uploaded_by_profile_id_fkey; validated=true
FOREIGN KEY (uploaded_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- clinical_documents_uploaded_by_profile_id_not_null; validated=true
NOT NULL uploaded_by_profile_id
```

### Indexes

```sql
-- clinical_documents_encounter_idx
CREATE INDEX clinical_documents_encounter_idx ON public.clinical_documents USING btree (encounter_id) WHERE (encounter_id IS NOT NULL)
```
```sql
-- clinical_documents_patient_created_idx
CREATE INDEX clinical_documents_patient_created_idx ON public.clinical_documents USING btree (patient_id, created_at DESC)
```
```sql
-- clinical_documents_pkey
CREATE UNIQUE INDEX clinical_documents_pkey ON public.clinical_documents USING btree (id)
```
```sql
-- clinical_documents_storage_path_key
CREATE UNIQUE INDEX clinical_documents_storage_path_key ON public.clinical_documents USING btree (storage_path)
```
```sql
-- clinical_documents_uploader_idx
CREATE INDEX clinical_documents_uploader_idx ON public.clinical_documents USING btree (uploaded_by_profile_id)
```

### Triggers

None.

### Policies

**clinical_documents_authorized_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: can_access_patient(patient_id, 'clinical'::text)
WITH CHECK: not specified
```

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}`


## clinical_notes

Created by: `20260820010400_clinical.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Authored notes belonging to encounters.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010400_clinical.sql`
- `20260820010900_ai_security.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| encounter_id | uuid | NO | ? | ? |
| author_profile_id | uuid | NO | ? | ? |
| note_type | clinical_note_type | NO | ? | ? |
| content | text | NO | ? | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |
| amended_at | timestamp with time zone | YES | ? | ? |

### Constraints

```sql
-- clinical_notes_author_profile_id_fkey; validated=true
FOREIGN KEY (author_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- clinical_notes_author_profile_id_not_null; validated=true
NOT NULL author_profile_id
```
```sql
-- clinical_notes_content_not_null; validated=true
NOT NULL content
```
```sql
-- clinical_notes_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- clinical_notes_encounter_id_fkey; validated=true
FOREIGN KEY (encounter_id) REFERENCES care_encounters(id) ON DELETE RESTRICT
```
```sql
-- clinical_notes_encounter_id_not_null; validated=true
NOT NULL encounter_id
```
```sql
-- clinical_notes_id_not_null; validated=true
NOT NULL id
```
```sql
-- clinical_notes_note_type_not_null; validated=true
NOT NULL note_type
```
```sql
-- clinical_notes_pkey; validated=true
PRIMARY KEY (id)
```

### Indexes

```sql
-- clinical_notes_pkey
CREATE UNIQUE INDEX clinical_notes_pkey ON public.clinical_notes USING btree (id)
```

### Triggers

None.

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**clinical_notes_assigned_create** ? PERMISSIVE INSERT TO ["authenticated"]

```sql
USING: not specified
WITH CHECK: ((author_profile_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM (care_encounters e
     JOIN providers p ON ((p.id = e.provider_id)))
  WHERE ((e.id = clinical_notes.encounter_id) AND (p.profile_id = auth.uid())))) AND
CASE current_profile_role()
    WHEN 'doctor'::profile_role THEN true
    WHEN 'nurse'::profile_role THEN (note_type = ANY (ARRAY['assessment'::clinical_note_type, 'progress'::clinical_note_type, 'nursing'::clinical_note_type, 'follow_up'::clinical_note_type]))
    WHEN 'caregiver'::profile_role THEN (note_type = 'caregiver'::clinical_note_type)
    ELSE false
END)
```

**clinical_notes_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: (EXISTS ( SELECT 1
   FROM care_encounters e
  WHERE ((e.id = clinical_notes.encounter_id) AND can_access_patient(e.patient_id, 'clinical'::text))))
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## complaints

Created by: `20260820010800_governance.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20261002190000_complaint_appointment_patient_integrity.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Submitter-owned service complaint, optional patient/appointment.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`
- `20261002190000_complaint_appointment_patient_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_id | uuid | YES | ? | ? |
| appointment_id | uuid | YES | ? | ? |
| submitted_by_profile_id | uuid | NO | ? | ? |
| subject | text | NO | ? | ? |
| description | text | NO | ? | ? |
| status | complaint_status | NO | 'open'::complaint_status | ? |
| assigned_to_profile_id | uuid | YES | ? | ? |
| resolution | text | YES | ? | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |
| resolved_at | timestamp with time zone | YES | ? | ? |
| updated_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- complaints_appointment_id_fkey; validated=true
FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE RESTRICT
```
```sql
-- complaints_appointment_patient_fk; validated=true
FOREIGN KEY (appointment_id, patient_id) REFERENCES appointments(id, patient_id) ON UPDATE RESTRICT ON DELETE RESTRICT
```
```sql
-- complaints_assigned_to_profile_id_fkey; validated=true
FOREIGN KEY (assigned_to_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- complaints_check; validated=true
CHECK ((status = ANY (ARRAY['resolved'::complaint_status, 'closed'::complaint_status])) = (resolved_at IS NOT NULL))
```
```sql
-- complaints_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- complaints_description_check; validated=true
CHECK (length(btrim(description)) > 0)
```
```sql
-- complaints_description_not_null; validated=true
NOT NULL description
```
```sql
-- complaints_id_not_null; validated=true
NOT NULL id
```
```sql
-- complaints_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- complaints_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- complaints_status_not_null; validated=true
NOT NULL status
```
```sql
-- complaints_subject_check; validated=true
CHECK (length(btrim(subject)) >= 1 AND length(btrim(subject)) <= 200)
```
```sql
-- complaints_subject_not_null; validated=true
NOT NULL subject
```
```sql
-- complaints_submitted_by_profile_id_fkey; validated=true
FOREIGN KEY (submitted_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- complaints_submitted_by_profile_id_not_null; validated=true
NOT NULL submitted_by_profile_id
```
```sql
-- complaints_updated_at_not_null; validated=true
NOT NULL updated_at
```

### Indexes

```sql
-- complaints_pkey
CREATE UNIQUE INDEX complaints_pkey ON public.complaints USING btree (id)
```
```sql
-- complaints_status_created_idx
CREATE INDEX complaints_status_created_idx ON public.complaints USING btree (status, created_at)
```

### Triggers

```sql
-- complaints_audit; enabled=O
CREATE TRIGGER complaints_audit AFTER INSERT OR DELETE OR UPDATE ON complaints FOR EACH ROW EXECUTE FUNCTION audit_row_change()
```
```sql
-- complaints_updated_at; enabled=O
CREATE TRIGGER complaints_updated_at BEFORE UPDATE ON complaints FOR EACH ROW EXECUTE FUNCTION set_updated_at()
```

### Policies

**complaints_create** ? PERMISSIVE INSERT TO ["authenticated"]

```sql
USING: not specified
WITH CHECK: ((submitted_by_profile_id = auth.uid()) AND ((patient_id IS NULL) OR can_access_patient(patient_id, 'view'::text)))
```

**complaints_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: ((submitted_by_profile_id = auth.uid()) OR is_main_admin())
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## consents

Created by: `20260820010100_patient_family.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Versioned care/data/family/AI consent records.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010100_patient_family.sql`
- `20260820010900_ai_security.sql`
- `20260820011000_patient_registration.sql`
- `20260820011100_simplify_patient_auth.sql`
- `20260928090000_patient_profile_identity_repair.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_id | uuid | NO | ? | ? |
| granted_by_profile_id | uuid | YES | ? | ? |
| consent_type | consent_type | NO | ? | ? |
| version | text | NO | ? | ? |
| status | consent_status | NO | ? | ? |
| granted_at | timestamp with time zone | NO | statement_timestamp() | ? |
| withdrawn_at | timestamp with time zone | YES | ? | ? |

### Constraints

```sql
-- consents_check; validated=true
CHECK ((status = 'withdrawn'::consent_status) = (withdrawn_at IS NOT NULL))
```
```sql
-- consents_consent_type_not_null; validated=true
NOT NULL consent_type
```
```sql
-- consents_granted_at_not_null; validated=true
NOT NULL granted_at
```
```sql
-- consents_granted_by_profile_id_fkey; validated=true
FOREIGN KEY (granted_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- consents_id_not_null; validated=true
NOT NULL id
```
```sql
-- consents_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- consents_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- consents_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- consents_status_not_null; validated=true
NOT NULL status
```
```sql
-- consents_version_not_null; validated=true
NOT NULL version
```

### Indexes

```sql
-- consents_patient_idx
CREATE INDEX consents_patient_idx ON public.consents USING btree (patient_id, consent_type, status)
```
```sql
-- consents_pkey
CREATE UNIQUE INDEX consents_pkey ON public.consents USING btree (id)
```

### Triggers

None.

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**consents_owner_manage** ? PERMISSIVE ALL TO ["authenticated"]

```sql
USING: ((EXISTS ( SELECT 1
   FROM patients p
  WHERE ((p.id = consents.patient_id) AND (p.profile_id = auth.uid())))) OR is_main_admin())
WITH CHECK: ((EXISTS ( SELECT 1
   FROM patients p
  WHERE ((p.id = consents.patient_id) AND (p.profile_id = auth.uid())))) OR is_main_admin())
```

**consents_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: can_access_patient(patient_id, 'view'::text)
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## family_authorizations

Created by: `20260820010100_patient_family.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Per-patient delegated permission flags.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010100_patient_family.sql`
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`
- `20260820011100_simplify_patient_auth.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_id | uuid | NO | ? | ? |
| family_profile_id | uuid | NO | ? | ? |
| relationship | text | YES | ? | ? |
| can_view_records | boolean | NO | false | ? |
| can_manage_appointments | boolean | NO | false | ? |
| can_manage_medications | boolean | NO | false | ? |
| can_make_payments | boolean | NO | false | ? |
| can_receive_alerts | boolean | NO | true | ? |
| is_primary_contact | boolean | NO | false | ? |
| authorized_at | timestamp with time zone | YES | ? | ? |
| revoked_at | timestamp with time zone | YES | ? | ? |
| status | family_authorization_status | NO | 'pending'::family_authorization_status | ? |

### Constraints

```sql
-- family_authorizations_can_make_payments_not_null; validated=true
NOT NULL can_make_payments
```
```sql
-- family_authorizations_can_manage_appointments_not_null; validated=true
NOT NULL can_manage_appointments
```
```sql
-- family_authorizations_can_manage_medications_not_null; validated=true
NOT NULL can_manage_medications
```
```sql
-- family_authorizations_can_receive_alerts_not_null; validated=true
NOT NULL can_receive_alerts
```
```sql
-- family_authorizations_can_view_records_not_null; validated=true
NOT NULL can_view_records
```
```sql
-- family_authorizations_check; validated=true
CHECK ((status = 'revoked'::family_authorization_status) = (revoked_at IS NOT NULL))
```
```sql
-- family_authorizations_family_profile_id_fkey; validated=true
FOREIGN KEY (family_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- family_authorizations_family_profile_id_not_null; validated=true
NOT NULL family_profile_id
```
```sql
-- family_authorizations_id_not_null; validated=true
NOT NULL id
```
```sql
-- family_authorizations_is_primary_contact_not_null; validated=true
NOT NULL is_primary_contact
```
```sql
-- family_authorizations_patient_id_family_profile_id_key; validated=true
UNIQUE (patient_id, family_profile_id)
```
```sql
-- family_authorizations_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- family_authorizations_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- family_authorizations_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- family_authorizations_status_not_null; validated=true
NOT NULL status
```

### Indexes

```sql
-- family_authorizations_family_idx
CREATE INDEX family_authorizations_family_idx ON public.family_authorizations USING btree (family_profile_id, status)
```
```sql
-- family_authorizations_patient_id_family_profile_id_key
CREATE UNIQUE INDEX family_authorizations_patient_id_family_profile_id_key ON public.family_authorizations USING btree (patient_id, family_profile_id)
```
```sql
-- family_authorizations_pkey
CREATE UNIQUE INDEX family_authorizations_pkey ON public.family_authorizations USING btree (id)
```
```sql
-- family_authorizations_primary_uidx
CREATE UNIQUE INDEX family_authorizations_primary_uidx ON public.family_authorizations USING btree (patient_id) WHERE (is_primary_contact AND (status = 'active'::family_authorization_status))
```

### Triggers

```sql
-- family_authorizations_audit; enabled=O
CREATE TRIGGER family_authorizations_audit AFTER INSERT OR DELETE OR UPDATE ON family_authorizations FOR EACH ROW EXECUTE FUNCTION audit_row_change()
```

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**family_authorizations_owner_manage** ? PERMISSIVE ALL TO ["authenticated"]

```sql
USING: ((EXISTS ( SELECT 1
   FROM patients p
  WHERE ((p.id = family_authorizations.patient_id) AND (p.profile_id = auth.uid())))) OR is_main_admin())
WITH CHECK: ((EXISTS ( SELECT 1
   FROM patients p
  WHERE ((p.id = family_authorizations.patient_id) AND (p.profile_id = auth.uid())))) OR is_main_admin())
```

**family_authorizations_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: ((family_profile_id = auth.uid()) OR can_access_patient(patient_id, 'view'::text))
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## feedback

Created by: `20260820010800_governance.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Rating/comment for completed appointment.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| appointment_id | uuid | NO | ? | ? |
| submitted_by_profile_id | uuid | NO | ? | ? |
| rating | smallint | NO | ? | ? |
| comments | text | YES | ? | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- feedback_appointment_id_fkey; validated=true
FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE RESTRICT
```
```sql
-- feedback_appointment_id_not_null; validated=true
NOT NULL appointment_id
```
```sql
-- feedback_appointment_id_submitted_by_profile_id_key; validated=true
UNIQUE (appointment_id, submitted_by_profile_id)
```
```sql
-- feedback_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- feedback_id_not_null; validated=true
NOT NULL id
```
```sql
-- feedback_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- feedback_rating_check; validated=true
CHECK (rating >= 1 AND rating <= 5)
```
```sql
-- feedback_rating_not_null; validated=true
NOT NULL rating
```
```sql
-- feedback_submitted_by_profile_id_fkey; validated=true
FOREIGN KEY (submitted_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- feedback_submitted_by_profile_id_not_null; validated=true
NOT NULL submitted_by_profile_id
```

### Indexes

```sql
-- feedback_appointment_id_submitted_by_profile_id_key
CREATE UNIQUE INDEX feedback_appointment_id_submitted_by_profile_id_key ON public.feedback USING btree (appointment_id, submitted_by_profile_id)
```
```sql
-- feedback_pkey
CREATE UNIQUE INDEX feedback_pkey ON public.feedback USING btree (id)
```

### Triggers

None.

### Policies

**feedback_create** ? PERMISSIVE INSERT TO ["authenticated"]

```sql
USING: not specified
WITH CHECK: ((submitted_by_profile_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM appointments a
  WHERE ((a.id = feedback.appointment_id) AND (a.status = 'completed'::appointment_status) AND can_access_patient(a.patient_id, 'view'::text)))))
```

**feedback_read_own** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: ((submitted_by_profile_id = auth.uid()) OR is_main_admin())
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## follow_ups

Created by: `20260820010600_coordination.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20261001100000_follow_up_patient_integrity.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Assigned post-encounter action and due/completion state.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010600_coordination.sql`
- `20260820010900_ai_security.sql`
- `20261001100000_follow_up_patient_integrity.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| encounter_id | uuid | NO | ? | ? |
| patient_id | uuid | NO | ? | ? |
| assigned_to_profile_id | uuid | YES | ? | ? |
| follow_up_type | follow_up_type | NO | ? | ? |
| due_at | timestamp with time zone | YES | ? | ? |
| instructions | text | YES | ? | ? |
| status | follow_up_status | NO | 'pending'::follow_up_status | ? |
| completed_at | timestamp with time zone | YES | ? | ? |

### Constraints

```sql
-- follow_ups_assigned_to_profile_id_fkey; validated=true
FOREIGN KEY (assigned_to_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- follow_ups_check; validated=true
CHECK ((status = 'completed'::follow_up_status) = (completed_at IS NOT NULL))
```
```sql
-- follow_ups_encounter_id_fkey; validated=true
FOREIGN KEY (encounter_id) REFERENCES care_encounters(id) ON DELETE RESTRICT
```
```sql
-- follow_ups_encounter_id_not_null; validated=true
NOT NULL encounter_id
```
```sql
-- follow_ups_encounter_patient_fk; validated=true
FOREIGN KEY (encounter_id, patient_id) REFERENCES care_encounters(id, patient_id) ON UPDATE RESTRICT ON DELETE RESTRICT
```
```sql
-- follow_ups_follow_up_type_not_null; validated=true
NOT NULL follow_up_type
```
```sql
-- follow_ups_id_not_null; validated=true
NOT NULL id
```
```sql
-- follow_ups_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- follow_ups_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- follow_ups_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- follow_ups_status_not_null; validated=true
NOT NULL status
```

### Indexes

```sql
-- follow_ups_encounter_patient_idx
CREATE INDEX follow_ups_encounter_patient_idx ON public.follow_ups USING btree (encounter_id, patient_id)
```
```sql
-- follow_ups_pkey
CREATE UNIQUE INDEX follow_ups_pkey ON public.follow_ups USING btree (id)
```

### Triggers

```sql
-- follow_ups_parent_chain; enabled=O
CREATE TRIGGER follow_ups_parent_chain BEFORE INSERT OR UPDATE OF encounter_id, patient_id ON follow_ups FOR EACH ROW EXECUTE FUNCTION check_follow_up_parent_chain()
```

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**follow_ups_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: can_access_patient(patient_id, 'clinical'::text)
WITH CHECK: not specified
```

**follow_ups_staff_create** ? PERMISSIVE INSERT TO ["authenticated"]

```sql
USING: not specified
WITH CHECK: can_manage_follow_up(patient_id, assigned_to_profile_id)
```

**follow_ups_staff_delete** ? PERMISSIVE DELETE TO ["authenticated"]

```sql
USING: can_manage_follow_up(patient_id, assigned_to_profile_id)
WITH CHECK: not specified
```

**follow_ups_staff_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: can_manage_follow_up(patient_id, assigned_to_profile_id)
WITH CHECK: not specified
```

**follow_ups_staff_update** ? PERMISSIVE UPDATE TO ["authenticated"]

```sql
USING: can_manage_follow_up(patient_id, assigned_to_profile_id)
WITH CHECK: can_manage_follow_up(patient_id, assigned_to_profile_id)
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## lab_orders

Created by: `20260929120000_laboratory_data.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20261001110000_suspended_provider_clinical_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Laboratory orders. Authenticated clients read scoped records; trusted service code manages laboratory workflow.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260929120000_laboratory_data.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_id | uuid | NO | ? | ? |
| encounter_id | uuid | YES | ? | ? |
| ordered_by_provider_id | uuid | NO | ? | ? |
| order_code | text | NO | ('LAB-'::text \|\| upper(replace((gen_random_uuid())::text, '-'::text, ''::text))) | ? |
| status | text | NO | 'ordered'::text | ? |
| laboratory_name | text | YES | ? | ? |
| ordered_at | timestamp with time zone | NO | statement_timestamp() | ? |
| collected_at | timestamp with time zone | YES | ? | ? |
| completed_at | timestamp with time zone | YES | ? | ? |
| notes | text | YES | ? | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |
| updated_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- lab_orders_code_check; validated=true
CHECK (length(btrim(order_code)) >= 1 AND length(btrim(order_code)) <= 100)
```
```sql
-- lab_orders_collected_at_check; validated=true
CHECK (collected_at IS NULL OR isfinite(collected_at) AND collected_at >= ordered_at)
```
```sql
-- lab_orders_collection_check; validated=true
CHECK (status <> 'collected'::text OR collected_at IS NOT NULL)
```
```sql
-- lab_orders_completed_at_check; validated=true
CHECK (completed_at IS NULL OR isfinite(completed_at) AND completed_at >= ordered_at AND (collected_at IS NULL OR completed_at >= collected_at))
```
```sql
-- lab_orders_completion_check; validated=true
CHECK ((status = 'completed'::text) = (completed_at IS NOT NULL))
```
```sql
-- lab_orders_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- lab_orders_encounter_patient_fk; validated=true
FOREIGN KEY (encounter_id, patient_id) REFERENCES care_encounters(id, patient_id) ON DELETE RESTRICT
```
```sql
-- lab_orders_id_not_null; validated=true
NOT NULL id
```
```sql
-- lab_orders_id_patient_key; validated=true
UNIQUE (id, patient_id)
```
```sql
-- lab_orders_laboratory_name_check; validated=true
CHECK (laboratory_name IS NULL OR length(btrim(laboratory_name)) >= 1 AND length(btrim(laboratory_name)) <= 200)
```
```sql
-- lab_orders_order_code_key; validated=true
UNIQUE (order_code)
```
```sql
-- lab_orders_order_code_not_null; validated=true
NOT NULL order_code
```
```sql
-- lab_orders_ordered_at_check; validated=true
CHECK (isfinite(ordered_at))
```
```sql
-- lab_orders_ordered_at_not_null; validated=true
NOT NULL ordered_at
```
```sql
-- lab_orders_ordered_by_provider_id_fkey; validated=true
FOREIGN KEY (ordered_by_provider_id) REFERENCES providers(id) ON DELETE RESTRICT
```
```sql
-- lab_orders_ordered_by_provider_id_not_null; validated=true
NOT NULL ordered_by_provider_id
```
```sql
-- lab_orders_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- lab_orders_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- lab_orders_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- lab_orders_status_check; validated=true
CHECK (status = ANY (ARRAY['ordered'::text, 'collected'::text, 'processing'::text, 'completed'::text, 'cancelled'::text]))
```
```sql
-- lab_orders_status_not_null; validated=true
NOT NULL status
```
```sql
-- lab_orders_updated_at_not_null; validated=true
NOT NULL updated_at
```

### Indexes

```sql
-- lab_orders_encounter_idx
CREATE INDEX lab_orders_encounter_idx ON public.lab_orders USING btree (encounter_id) WHERE (encounter_id IS NOT NULL)
```
```sql
-- lab_orders_id_patient_key
CREATE UNIQUE INDEX lab_orders_id_patient_key ON public.lab_orders USING btree (id, patient_id)
```
```sql
-- lab_orders_order_code_key
CREATE UNIQUE INDEX lab_orders_order_code_key ON public.lab_orders USING btree (order_code)
```
```sql
-- lab_orders_patient_ordered_idx
CREATE INDEX lab_orders_patient_ordered_idx ON public.lab_orders USING btree (patient_id, ordered_at DESC)
```
```sql
-- lab_orders_pkey
CREATE UNIQUE INDEX lab_orders_pkey ON public.lab_orders USING btree (id)
```
```sql
-- lab_orders_provider_ordered_idx
CREATE INDEX lab_orders_provider_ordered_idx ON public.lab_orders USING btree (ordered_by_provider_id, ordered_at DESC)
```

### Triggers

```sql
-- lab_orders_updated_at; enabled=O
CREATE TRIGGER lab_orders_updated_at BEFORE UPDATE ON lab_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at()
```

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**lab_orders_clinical_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: ((current_profile_role() = ANY (ARRAY['doctor'::profile_role, 'nurse'::profile_role, 'main_admin'::profile_role])) AND can_access_patient(patient_id, 'clinical'::text))
WITH CHECK: not specified
```

**lab_orders_patient_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: (EXISTS ( SELECT 1
   FROM patients p
  WHERE ((p.id = lab_orders.patient_id) AND (p.profile_id = auth.uid()))))
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}`


## lab_results

Created by: `20260929120000_laboratory_data.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20261001110000_suspended_provider_clinical_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Laboratory observations linked to an order and the same patient. Final/corrected results require a verification timestamp. Trusted service code controls writes.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260929120000_laboratory_data.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| lab_order_id | uuid | NO | ? | ? |
| patient_id | uuid | NO | ? | ? |
| test_code | text | YES | ? | Optional laboratory test identifier. Not globally unique: an order can contain repeated observations. |
| test_name | text | NO | ? | ? |
| value_numeric | numeric | YES | ? | ? |
| value_text | text | YES | ? | Qualitative result or interpretation. May accompany value_numeric; pending/cancelled results may have neither. |
| unit | text | YES | ? | ? |
| reference_low | numeric | YES | ? | ? |
| reference_high | numeric | YES | ? | ? |
| abnormal_flag | text | NO | 'unknown'::text | ? |
| result_status | text | NO | 'pending'::text | ? |
| observed_at | timestamp with time zone | YES | ? | ? |
| verified_at | timestamp with time zone | YES | ? | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |
| updated_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- lab_results_abnormal_flag_check; validated=true
CHECK (abnormal_flag = ANY (ARRAY['unknown'::text, 'normal'::text, 'low'::text, 'high'::text, 'critical_low'::text, 'critical_high'::text, 'abnormal'::text]))
```
```sql
-- lab_results_abnormal_flag_not_null; validated=true
NOT NULL abnormal_flag
```
```sql
-- lab_results_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- lab_results_id_not_null; validated=true
NOT NULL id
```
```sql
-- lab_results_lab_order_id_not_null; validated=true
NOT NULL lab_order_id
```
```sql
-- lab_results_numeric_check; validated=true
CHECK (value_numeric IS NULL OR value_numeric > '-Infinity'::numeric AND value_numeric < 'Infinity'::numeric)
```
```sql
-- lab_results_observed_at_check; validated=true
CHECK (observed_at IS NULL OR isfinite(observed_at))
```
```sql
-- lab_results_order_patient_fk; validated=true
FOREIGN KEY (lab_order_id, patient_id) REFERENCES lab_orders(id, patient_id) ON DELETE RESTRICT
```
```sql
-- lab_results_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- lab_results_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- lab_results_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- lab_results_reference_high_check; validated=true
CHECK (reference_high IS NULL OR reference_high > '-Infinity'::numeric AND reference_high < 'Infinity'::numeric)
```
```sql
-- lab_results_reference_low_check; validated=true
CHECK (reference_low IS NULL OR reference_low > '-Infinity'::numeric AND reference_low < 'Infinity'::numeric)
```
```sql
-- lab_results_reference_order_check; validated=true
CHECK (reference_low IS NULL OR reference_high IS NULL OR reference_low <= reference_high)
```
```sql
-- lab_results_result_status_not_null; validated=true
NOT NULL result_status
```
```sql
-- lab_results_status_check; validated=true
CHECK (result_status = ANY (ARRAY['pending'::text, 'preliminary'::text, 'final'::text, 'corrected'::text, 'cancelled'::text]))
```
```sql
-- lab_results_test_code_check; validated=true
CHECK (test_code IS NULL OR length(btrim(test_code)) >= 1 AND length(btrim(test_code)) <= 100)
```
```sql
-- lab_results_test_name_check; validated=true
CHECK (length(btrim(test_name)) >= 1 AND length(btrim(test_name)) <= 200)
```
```sql
-- lab_results_test_name_not_null; validated=true
NOT NULL test_name
```
```sql
-- lab_results_unit_check; validated=true
CHECK (unit IS NULL OR length(btrim(unit)) >= 1 AND length(btrim(unit)) <= 64)
```
```sql
-- lab_results_updated_at_not_null; validated=true
NOT NULL updated_at
```
```sql
-- lab_results_value_required_check; validated=true
CHECK ((result_status = ANY (ARRAY['pending'::text, 'cancelled'::text])) OR value_numeric IS NOT NULL OR value_text IS NOT NULL)
```
```sql
-- lab_results_value_text_check; validated=true
CHECK (value_text IS NULL OR length(btrim(value_text)) > 0)
```
```sql
-- lab_results_verification_check; validated=true
CHECK ((result_status = ANY (ARRAY['final'::text, 'corrected'::text])) = (verified_at IS NOT NULL))
```
```sql
-- lab_results_verified_at_check; validated=true
CHECK (verified_at IS NULL OR isfinite(verified_at) AND (observed_at IS NULL OR verified_at >= observed_at))
```

### Indexes

```sql
-- lab_results_order_idx
CREATE INDEX lab_results_order_idx ON public.lab_results USING btree (lab_order_id)
```
```sql
-- lab_results_patient_observed_idx
CREATE INDEX lab_results_patient_observed_idx ON public.lab_results USING btree (patient_id, observed_at DESC NULLS LAST)
```
```sql
-- lab_results_pkey
CREATE UNIQUE INDEX lab_results_pkey ON public.lab_results USING btree (id)
```

### Triggers

```sql
-- lab_results_updated_at; enabled=O
CREATE TRIGGER lab_results_updated_at BEFORE UPDATE ON lab_results FOR EACH ROW EXECUTE FUNCTION set_updated_at()
```

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**lab_results_clinical_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: ((current_profile_role() = ANY (ARRAY['doctor'::profile_role, 'nurse'::profile_role, 'main_admin'::profile_role])) AND can_access_patient(patient_id, 'clinical'::text))
WITH CHECK: not specified
```

**lab_results_patient_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: (EXISTS ( SELECT 1
   FROM patients p
  WHERE ((p.id = lab_results.patient_id) AND (p.profile_id = auth.uid()))))
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}`


## medical_history_items

Created by: `20260820010400_clinical.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Dated surgery/hospitalization/vaccination/imaging/other history.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010400_clinical.sql`
- `20260820010900_ai_security.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_id | uuid | NO | ? | ? |
| category | history_category | NO | ? | ? |
| title | text | NO | ? | ? |
| occurred_on | date | YES | ? | ? |
| details | text | YES | ? | ? |
| document_url | text | YES | ? | ? |

### Constraints

```sql
-- medical_history_items_category_not_null; validated=true
NOT NULL category
```
```sql
-- medical_history_items_id_not_null; validated=true
NOT NULL id
```
```sql
-- medical_history_items_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- medical_history_items_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- medical_history_items_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- medical_history_items_title_not_null; validated=true
NOT NULL title
```

### Indexes

```sql
-- medical_history_items_pkey
CREATE UNIQUE INDEX medical_history_items_pkey ON public.medical_history_items USING btree (id)
```

### Triggers

None.

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**history_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: can_access_patient(patient_id, 'clinical'::text)
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## medication_events

Created by: `20260820010500_medication.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20260929140000_medication_schema_improvements.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002140000_medication_event_patient_integrity.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Scheduled-dose occurrence and confirmation history.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010500_medication.sql`
- `20260820010900_ai_security.sql`
- `20260929140000_medication_schema_improvements.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002140000_medication_event_patient_integrity.sql`
- `20261002160000_medication_prescription_patient_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| schedule_id | uuid | NO | ? | ? |
| patient_id | uuid | NO | ? | ? |
| scheduled_at | timestamp with time zone | NO | ? | ? |
| status | medication_event_status | NO | 'pending'::medication_event_status | ? |
| confirmed_by_profile_id | uuid | YES | ? | ? |
| confirmed_at | timestamp with time zone | YES | ? | ? |

### Constraints

```sql
-- medication_events_confirmed_by_profile_id_fkey; validated=true
FOREIGN KEY (confirmed_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- medication_events_id_not_null; validated=true
NOT NULL id
```
```sql
-- medication_events_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- medication_events_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- medication_events_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- medication_events_schedule_id_fkey; validated=true
FOREIGN KEY (schedule_id) REFERENCES medication_schedules(id) ON DELETE RESTRICT
```
```sql
-- medication_events_schedule_id_not_null; validated=true
NOT NULL schedule_id
```
```sql
-- medication_events_scheduled_at_not_null; validated=true
NOT NULL scheduled_at
```
```sql
-- medication_events_status_not_null; validated=true
NOT NULL status
```

### Indexes

```sql
-- medication_events_patient_scheduled_idx
CREATE INDEX medication_events_patient_scheduled_idx ON public.medication_events USING btree (patient_id, scheduled_at)
```
```sql
-- medication_events_pkey
CREATE UNIQUE INDEX medication_events_pkey ON public.medication_events USING btree (id)
```
```sql
-- medication_events_schedule_idx
CREATE INDEX medication_events_schedule_idx ON public.medication_events USING btree (schedule_id)
```

### Triggers

```sql
-- medication_events_parent_chain; enabled=O
CREATE TRIGGER medication_events_parent_chain BEFORE INSERT OR UPDATE OF schedule_id, patient_id ON medication_events FOR EACH ROW EXECUTE FUNCTION check_medication_event_patient_chain()
```

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**medication_events_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: can_access_patient(patient_id, 'medications'::text)
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## medication_schedules

Created by: `20260820010500_medication.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20260821104000_patient_medication_read_model.sql`
- `20260929140000_medication_schema_improvements.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002140000_medication_event_patient_integrity.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Recurrence and timezone for a medication.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010500_medication.sql`
- `20260820010900_ai_security.sql`
- `20260821104000_patient_medication_read_model.sql`
- `20260929140000_medication_schema_improvements.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002140000_medication_event_patient_integrity.sql`
- `20261002160000_medication_prescription_patient_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_medication_id | uuid | NO | ? | ? |
| time_of_day | time without time zone | NO | ? | ? |
| days_of_week | smallint[] | YES | ? | ? |
| timezone | text | NO | 'Asia/Yangon'::text | ? |
| reminder_enabled | boolean | NO | true | ? |
| valid_from | date | YES | ? | ? |
| valid_until | date | YES | ? | ? |

### Constraints

```sql
-- medication_schedules_check; validated=true
CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
```
```sql
-- medication_schedules_days_of_week_check; validated=true
CHECK (days_of_week IS NULL OR days_of_week <@ ARRAY[0::smallint, 1::smallint, 2::smallint, 3::smallint, 4::smallint, 5::smallint, 6::smallint])
```
```sql
-- medication_schedules_id_not_null; validated=true
NOT NULL id
```
```sql
-- medication_schedules_patient_medication_id_fkey; validated=true
FOREIGN KEY (patient_medication_id) REFERENCES patient_medications(id) ON DELETE RESTRICT
```
```sql
-- medication_schedules_patient_medication_id_not_null; validated=true
NOT NULL patient_medication_id
```
```sql
-- medication_schedules_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- medication_schedules_reminder_enabled_not_null; validated=true
NOT NULL reminder_enabled
```
```sql
-- medication_schedules_time_of_day_not_null; validated=true
NOT NULL time_of_day
```
```sql
-- medication_schedules_timezone_not_null; validated=true
NOT NULL timezone
```

### Indexes

```sql
-- medication_schedules_medication_idx
CREATE INDEX medication_schedules_medication_idx ON public.medication_schedules USING btree (patient_medication_id)
```
```sql
-- medication_schedules_pkey
CREATE UNIQUE INDEX medication_schedules_pkey ON public.medication_schedules USING btree (id)
```

### Triggers

```sql
-- medication_schedules_parent_guard; enabled=O
CREATE TRIGGER medication_schedules_parent_guard BEFORE UPDATE OF patient_medication_id ON medication_schedules FOR EACH ROW EXECUTE FUNCTION check_medication_event_patient_chain()
```

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**medication_schedules_read_own** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: (EXISTS ( SELECT 1
   FROM (patient_medications medication
     JOIN patients patient ON ((patient.id = medication.patient_id)))
  WHERE ((medication.id = medication_schedules.patient_medication_id) AND (patient.auth_user_id = auth.uid()))))
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`

- Column `id`: `{authenticated=r/postgres}`
- Column `patient_medication_id`: `{authenticated=r/postgres}`
- Column `time_of_day`: `{authenticated=r/postgres}`
- Column `days_of_week`: `{authenticated=r/postgres}`
- Column `timezone`: `{authenticated=r/postgres}`
- Column `valid_from`: `{authenticated=r/postgres}`
- Column `valid_until`: `{authenticated=r/postgres}`

## monitoring_alerts

Created by: `20260820010600_coordination.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20260929150000_monitoring_alert_metadata.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002150000_monitoring_alert_vital_patient_integrity.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Patient health/system condition requiring attention.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010600_coordination.sql`
- `20260820010900_ai_security.sql`
- `20260929150000_monitoring_alert_metadata.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002150000_monitoring_alert_vital_patient_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_id | uuid | NO | ? | ? |
| vital_reading_id | uuid | YES | ? | ? |
| alert_type | text | NO | ? | ? |
| severity | alert_severity | NO | ? | ? |
| message | text | NO | ? | ? |
| status | alert_status | NO | 'open'::alert_status | ? |
| reviewed_by_profile_id | uuid | YES | ? | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |
| resolved_at | timestamp with time zone | YES | ? | ? |
| source_type | text | YES | ? | ? |
| source_id | uuid | YES | ? | Optional polymorphic provenance UUID, qualified by source_type. Not a generic FK; producer must validate source existence and patient ownership. Existing vital_reading_id FK is preserved. |
| title | text | YES | ? | ? |
| rule_code | text | YES | ? | Optional producer rule identifier; metadata only, does not execute a rule or imply medical approval. |
| detected_at | timestamp with time zone | YES | statement_timestamp() | Condition detection time. Legacy finite created_at values are used as the best available historical time. |

### Constraints

```sql
-- monitoring_alerts_alert_type_not_null; validated=true
NOT NULL alert_type
```
```sql
-- monitoring_alerts_check; validated=true
CHECK ((status = 'resolved'::alert_status) = (resolved_at IS NOT NULL))
```
```sql
-- monitoring_alerts_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- monitoring_alerts_detected_at_check; validated=true
CHECK (detected_at IS NULL OR isfinite(detected_at))
```
```sql
-- monitoring_alerts_id_not_null; validated=true
NOT NULL id
```
```sql
-- monitoring_alerts_message_not_null; validated=true
NOT NULL message
```
```sql
-- monitoring_alerts_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- monitoring_alerts_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- monitoring_alerts_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- monitoring_alerts_reviewed_by_profile_id_fkey; validated=true
FOREIGN KEY (reviewed_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- monitoring_alerts_rule_code_check; validated=true
CHECK (rule_code IS NULL OR length(btrim(rule_code)) >= 1 AND length(btrim(rule_code)) <= 100)
```
```sql
-- monitoring_alerts_severity_not_null; validated=true
NOT NULL severity
```
```sql
-- monitoring_alerts_source_id_check; validated=true
CHECK (source_id IS NULL OR source_type IS NOT NULL)
```
```sql
-- monitoring_alerts_source_type_check; validated=true
CHECK (source_type IS NULL OR (source_type = ANY (ARRAY['vital'::text, 'lab'::text, 'medication'::text, 'appointment'::text, 'ai'::text, 'manual'::text])))
```
```sql
-- monitoring_alerts_status_not_null; validated=true
NOT NULL status
```
```sql
-- monitoring_alerts_title_check; validated=true
CHECK (title IS NULL OR length(btrim(title)) >= 1 AND length(btrim(title)) <= 200)
```
```sql
-- monitoring_alerts_vital_patient_fk; validated=true
FOREIGN KEY (vital_reading_id, patient_id) REFERENCES vital_readings(id, patient_id) ON UPDATE RESTRICT ON DELETE RESTRICT
```
```sql
-- monitoring_alerts_vital_reading_id_fkey; validated=true
FOREIGN KEY (vital_reading_id) REFERENCES vital_readings(id) ON DELETE RESTRICT
```
```sql
-- monitoring_alerts_vital_source_check; validated=true
CHECK (vital_reading_id IS NULL OR source_type IS NULL OR source_type = 'vital'::text AND (source_id IS NULL OR source_id = vital_reading_id))
```

### Indexes

```sql
-- monitoring_alerts_open_idx
CREATE INDEX monitoring_alerts_open_idx ON public.monitoring_alerts USING btree (patient_id, created_at DESC) WHERE (status = 'open'::alert_status)
```
```sql
-- monitoring_alerts_patient_status_idx
CREATE INDEX monitoring_alerts_patient_status_idx ON public.monitoring_alerts USING btree (patient_id, status, created_at DESC)
```
```sql
-- monitoring_alerts_pkey
CREATE UNIQUE INDEX monitoring_alerts_pkey ON public.monitoring_alerts USING btree (id)
```
```sql
-- monitoring_alerts_source_idx
CREATE INDEX monitoring_alerts_source_idx ON public.monitoring_alerts USING btree (source_type, source_id) WHERE (source_id IS NOT NULL)
```
```sql
-- monitoring_alerts_vital_patient_idx
CREATE INDEX monitoring_alerts_vital_patient_idx ON public.monitoring_alerts USING btree (vital_reading_id, patient_id) WHERE (vital_reading_id IS NOT NULL)
```

### Triggers

None.

### Policies

**alerts_provider_create** ? PERMISSIVE INSERT TO ["authenticated"]

```sql
USING: not specified
WITH CHECK: ((current_profile_role() = ANY (ARRAY['doctor'::profile_role, 'nurse'::profile_role])) AND can_access_patient(patient_id, 'clinical'::text))
```

**alerts_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: can_access_patient(patient_id, 'alerts'::text)
WITH CHECK: not specified
```

**alerts_reviewer_update** ? PERMISSIVE UPDATE TO ["authenticated"]

```sql
USING: ((current_profile_role() = ANY (ARRAY['doctor'::profile_role, 'nurse'::profile_role, 'coordinator'::profile_role, 'main_admin'::profile_role])) AND can_access_patient(patient_id, 'alerts'::text))
WITH CHECK: ((current_profile_role() = ANY (ARRAY['doctor'::profile_role, 'nurse'::profile_role, 'coordinator'::profile_role, 'main_admin'::profile_role])) AND can_access_patient(patient_id, 'alerts'::text) AND ((reviewed_by_profile_id = auth.uid()) OR is_main_admin()))
```

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## notifications

Created by: `20260820010600_coordination.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20261002110000_notification_mark_read_integrity.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Delivery to a recipient profile.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010600_coordination.sql`
- `20260820010900_ai_security.sql`
- `20261002110000_notification_mark_read_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| recipient_profile_id | uuid | NO | ? | ? |
| patient_id | uuid | YES | ? | ? |
| type | notification_type | NO | ? | ? |
| channel | notification_channel | NO | ? | ? |
| title | text | NO | ? | ? |
| body | text | NO | ? | ? |
| status | notification_status | NO | 'queued'::notification_status | ? |
| scheduled_at | timestamp with time zone | YES | ? | ? |
| sent_at | timestamp with time zone | YES | ? | ? |
| read_at | timestamp with time zone | YES | ? | ? |

### Constraints

```sql
-- notifications_body_not_null; validated=true
NOT NULL body
```
```sql
-- notifications_channel_not_null; validated=true
NOT NULL channel
```
```sql
-- notifications_id_not_null; validated=true
NOT NULL id
```
```sql
-- notifications_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- notifications_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- notifications_recipient_profile_id_fkey; validated=true
FOREIGN KEY (recipient_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- notifications_recipient_profile_id_not_null; validated=true
NOT NULL recipient_profile_id
```
```sql
-- notifications_status_not_null; validated=true
NOT NULL status
```
```sql
-- notifications_title_not_null; validated=true
NOT NULL title
```
```sql
-- notifications_type_not_null; validated=true
NOT NULL type
```

### Indexes

```sql
-- notifications_pkey
CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id)
```
```sql
-- notifications_recipient_status_idx
CREATE INDEX notifications_recipient_status_idx ON public.notifications USING btree (recipient_profile_id, status, scheduled_at)
```

### Triggers

None.

### Policies

**notifications_own** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: (recipient_profile_id = auth.uid())
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=ardDxtm/postgres,authenticated=ardDxtm/postgres,service_role=arwdDxtm/postgres}`


## package_services

Created by: `20260820010700_commercial.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Package included service quantities.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010700_commercial.sql`
- `20260820010900_ai_security.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| package_id | uuid | NO | ? | ? |
| service_id | uuid | NO | ? | ? |
| included_quantity | integer | YES | ? | ? |

### Constraints

```sql
-- package_services_included_quantity_check; validated=true
CHECK (included_quantity IS NULL OR included_quantity > 0)
```
```sql
-- package_services_package_id_fkey; validated=true
FOREIGN KEY (package_id) REFERENCES care_packages(id) ON DELETE RESTRICT
```
```sql
-- package_services_package_id_not_null; validated=true
NOT NULL package_id
```
```sql
-- package_services_pkey; validated=true
PRIMARY KEY (package_id, service_id)
```
```sql
-- package_services_service_id_fkey; validated=true
FOREIGN KEY (service_id) REFERENCES service_catalog(id) ON DELETE RESTRICT
```
```sql
-- package_services_service_id_not_null; validated=true
NOT NULL service_id
```

### Indexes

```sql
-- package_services_pkey
CREATE UNIQUE INDEX package_services_pkey ON public.package_services USING btree (package_id, service_id)
```

### Triggers

None.

### Policies

**package_services_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: true
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## partner_clinics

Created by: `20260820010200_provider_supply.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Clinic organizations and locations.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010200_provider_supply.sql`
- `20260820010900_ai_security.sql`
- `20260929090000_patient_health_profiles.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| name | text | NO | ? | ? |
| phone | text | YES | ? | ? |
| email | text | YES | ? | ? |
| address | text | YES | ? | ? |
| township | text | YES | ? | ? |
| city | text | YES | ? | ? |
| latitude | numeric(9,6) | YES | ? | ? |
| longitude | numeric(9,6) | YES | ? | ? |
| status | clinic_status | NO | 'pending'::clinic_status | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |
| updated_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- partner_clinics_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- partner_clinics_id_not_null; validated=true
NOT NULL id
```
```sql
-- partner_clinics_latitude_check; validated=true
CHECK (latitude IS NULL OR latitude >= '-90'::integer::numeric AND latitude <= 90::numeric)
```
```sql
-- partner_clinics_longitude_check; validated=true
CHECK (longitude IS NULL OR longitude >= '-180'::integer::numeric AND longitude <= 180::numeric)
```
```sql
-- partner_clinics_name_not_null; validated=true
NOT NULL name
```
```sql
-- partner_clinics_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- partner_clinics_status_not_null; validated=true
NOT NULL status
```
```sql
-- partner_clinics_updated_at_not_null; validated=true
NOT NULL updated_at
```

### Indexes

```sql
-- partner_clinics_pkey
CREATE UNIQUE INDEX partner_clinics_pkey ON public.partner_clinics USING btree (id)
```

### Triggers

```sql
-- partner_clinics_updated_at; enabled=O
CREATE TRIGGER partner_clinics_updated_at BEFORE UPDATE ON partner_clinics FOR EACH ROW EXECUTE FUNCTION set_updated_at()
```

### Policies

**clinics_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: ((status = 'active'::clinic_status) OR is_main_admin())
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## patient_allergies

Created by: `20260820010400_clinical.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20260929110000_patient_conditions_allergies_metadata.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Longitudinal allergies, reaction, verification metadata.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010400_clinical.sql`
- `20260820010900_ai_security.sql`
- `20260929110000_patient_conditions_allergies_metadata.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_id | uuid | NO | ? | ? |
| allergen | text | NO | ? | ? |
| reaction | text | YES | ? | ? |
| severity | allergy_severity | YES | ? | ? |
| status | active_status | NO | 'active'::active_status | ? |
| recorded_by | uuid | YES | ? | ? |
| allergen_type | text | YES | ? | ? |
| onset_date | date | YES | ? | ? |
| verified_by_profile_id | uuid | YES | ? | Verifier identity, separate from recorded_by. Null means no verification recorded; legacy records are not auto-verified. |
| verified_at | timestamp with time zone | YES | ? | ? |

### Constraints

```sql
-- patient_allergies_allergen_not_null; validated=true
NOT NULL allergen
```
```sql
-- patient_allergies_allergen_type_check; validated=true
CHECK (allergen_type IS NULL OR (allergen_type = ANY (ARRAY['medication'::text, 'food'::text, 'environmental'::text, 'insect'::text, 'latex'::text, 'other'::text, 'unknown'::text])))
```
```sql
-- patient_allergies_id_not_null; validated=true
NOT NULL id
```
```sql
-- patient_allergies_onset_date_check; validated=true
CHECK (onset_date IS NULL OR isfinite(onset_date))
```
```sql
-- patient_allergies_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- patient_allergies_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- patient_allergies_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- patient_allergies_recorded_by_fkey; validated=true
FOREIGN KEY (recorded_by) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- patient_allergies_status_not_null; validated=true
NOT NULL status
```
```sql
-- patient_allergies_verification_pair_check; validated=true
CHECK ((verified_by_profile_id IS NULL) = (verified_at IS NULL))
```
```sql
-- patient_allergies_verified_at_check; validated=true
CHECK (verified_at IS NULL OR isfinite(verified_at))
```
```sql
-- patient_allergies_verified_by_profile_id_fkey; validated=true
FOREIGN KEY (verified_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```

### Indexes

```sql
-- patient_allergies_patient_idx
CREATE INDEX patient_allergies_patient_idx ON public.patient_allergies USING btree (patient_id)
```
```sql
-- patient_allergies_pkey
CREATE UNIQUE INDEX patient_allergies_pkey ON public.patient_allergies USING btree (id)
```

### Triggers

None.

### Policies

**allergies_provider_create** ? PERMISSIVE INSERT TO ["authenticated"]

```sql
USING: not specified
WITH CHECK: ((recorded_by = auth.uid()) AND (current_profile_role() = ANY (ARRAY['doctor'::profile_role, 'nurse'::profile_role])) AND can_access_patient(patient_id, 'clinical'::text) AND ((verified_by_profile_id IS NULL) OR (verified_by_profile_id = auth.uid())))
```

**allergies_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: can_access_patient(patient_id, 'clinical'::text)
WITH CHECK: not specified
```

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`

- Column `patient_id`: `{authenticated=a/postgres}`
- Column `allergen`: `{authenticated=a/postgres}`
- Column `reaction`: `{authenticated=a/postgres}`
- Column `severity`: `{authenticated=a/postgres}`
- Column `status`: `{authenticated=a/postgres}`
- Column `recorded_by`: `{authenticated=a/postgres}`
- Column `allergen_type`: `{authenticated=a/postgres}`
- Column `onset_date`: `{authenticated=a/postgres}`
- Column `verified_by_profile_id`: `{authenticated=a/postgres}`
- Column `verified_at`: `{authenticated=a/postgres}`

## patient_conditions

Created by: `20260820010400_clinical.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20260929110000_patient_conditions_allergies_metadata.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Longitudinal condition list and coding metadata.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010400_clinical.sql`
- `20260820010900_ai_security.sql`
- `20260929110000_patient_conditions_allergies_metadata.sql`
- `20260929160000_ai_health_summary_model.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_id | uuid | NO | ? | ? |
| condition_name | text | NO | ? | ? |
| status | condition_status | NO | ? | ? |
| diagnosed_at | date | YES | ? | ? |
| recorded_by | uuid | YES | ? | ? |
| notes | text | YES | ? | ? |
| code_system | text | YES | ? | Optional terminology system/version supplied with condition_code. Existing free-text names remain valid. |
| condition_code | text | YES | ? | ? |
| severity | text | YES | ? | ? |
| onset_date | date | YES | ? | ? |
| resolved_date | date | YES | ? | Optional known resolution date for resolved/historical conditions. Legacy resolved records may have no known date. |

### Constraints

```sql
-- patient_conditions_code_pair_check; validated=true
CHECK ((code_system IS NULL) = (condition_code IS NULL))
```
```sql
-- patient_conditions_code_system_check; validated=true
CHECK (code_system IS NULL OR length(btrim(code_system)) >= 1 AND length(btrim(code_system)) <= 100)
```
```sql
-- patient_conditions_condition_code_check; validated=true
CHECK (condition_code IS NULL OR length(btrim(condition_code)) >= 1 AND length(btrim(condition_code)) <= 100)
```
```sql
-- patient_conditions_condition_name_not_null; validated=true
NOT NULL condition_name
```
```sql
-- patient_conditions_date_order_check; validated=true
CHECK (onset_date IS NULL OR resolved_date IS NULL OR resolved_date >= onset_date)
```
```sql
-- patient_conditions_id_not_null; validated=true
NOT NULL id
```
```sql
-- patient_conditions_onset_date_check; validated=true
CHECK (onset_date IS NULL OR isfinite(onset_date))
```
```sql
-- patient_conditions_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- patient_conditions_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- patient_conditions_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- patient_conditions_recorded_by_fkey; validated=true
FOREIGN KEY (recorded_by) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- patient_conditions_resolved_date_check; validated=true
CHECK (resolved_date IS NULL OR isfinite(resolved_date) AND (status = ANY (ARRAY['resolved'::condition_status, 'historical'::condition_status])))
```
```sql
-- patient_conditions_severity_check; validated=true
CHECK (severity IS NULL OR (severity = ANY (ARRAY['mild'::text, 'moderate'::text, 'severe'::text, 'unknown'::text])))
```
```sql
-- patient_conditions_status_not_null; validated=true
NOT NULL status
```

### Indexes

```sql
-- patient_conditions_patient_idx
CREATE INDEX patient_conditions_patient_idx ON public.patient_conditions USING btree (patient_id)
```
```sql
-- patient_conditions_pkey
CREATE UNIQUE INDEX patient_conditions_pkey ON public.patient_conditions USING btree (id)
```

### Triggers

None.

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**conditions_doctor_create** ? PERMISSIVE INSERT TO ["authenticated"]

```sql
USING: not specified
WITH CHECK: ((recorded_by = auth.uid()) AND (current_profile_role() = 'doctor'::profile_role) AND can_access_patient(patient_id, 'clinical'::text))
```

**conditions_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: can_access_patient(patient_id, 'clinical'::text)
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`

- Column `patient_id`: `{authenticated=a/postgres}`
- Column `condition_name`: `{authenticated=a/postgres}`
- Column `status`: `{authenticated=a/postgres}`
- Column `diagnosed_at`: `{authenticated=a/postgres}`
- Column `recorded_by`: `{authenticated=a/postgres}`
- Column `notes`: `{authenticated=a/postgres}`
- Column `code_system`: `{authenticated=a/postgres}`
- Column `condition_code`: `{authenticated=a/postgres}`
- Column `severity`: `{authenticated=a/postgres}`
- Column `onset_date`: `{authenticated=a/postgres}`
- Column `resolved_date`: `{authenticated=a/postgres}`

## patient_health_profiles

Created by: `20260929090000_patient_health_profiles.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20261001110000_suspended_provider_clinical_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Optional patient baseline health data. Canonical blood type remains patients.blood_type. Browser access is read-only.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260929090000_patient_health_profiles.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_id | uuid | NO | ? | ? |
| height_cm | numeric(5,2) | YES | ? | ? |
| baseline_weight_kg | numeric(6,2) | YES | ? | ? |
| smoking_status | text | NO | 'unknown'::text | Reported tobacco use: never, former, current, or unknown; unknown is not a negative finding. |
| alcohol_use | text | NO | 'unknown'::text | Reported alcohol use: none, former, current, or unknown; no amount or risk level is inferred. |
| pregnancy_status | text | NO | 'unknown'::text | Recorded status, not inferred from demographic fields; unknown is not a negative finding. |
| primary_physician_id | uuid | YES | ? | ? |
| preferred_clinic_id | uuid | YES | ? | ? |
| last_health_review_at | timestamp with time zone | YES | ? | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |
| updated_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- patient_health_profiles_alcohol_use_check; validated=true
CHECK (alcohol_use = ANY (ARRAY['none'::text, 'former'::text, 'current'::text, 'unknown'::text]))
```
```sql
-- patient_health_profiles_alcohol_use_not_null; validated=true
NOT NULL alcohol_use
```
```sql
-- patient_health_profiles_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- patient_health_profiles_height_check; validated=true
CHECK (height_cm > 0::numeric AND height_cm < 'Infinity'::numeric)
```
```sql
-- patient_health_profiles_id_not_null; validated=true
NOT NULL id
```
```sql
-- patient_health_profiles_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- patient_health_profiles_patient_id_key; validated=true
UNIQUE (patient_id)
```
```sql
-- patient_health_profiles_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- patient_health_profiles_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- patient_health_profiles_preferred_clinic_id_fkey; validated=true
FOREIGN KEY (preferred_clinic_id) REFERENCES partner_clinics(id) ON DELETE RESTRICT
```
```sql
-- patient_health_profiles_pregnancy_status_check; validated=true
CHECK (pregnancy_status = ANY (ARRAY['pregnant'::text, 'not_pregnant'::text, 'not_applicable'::text, 'unknown'::text]))
```
```sql
-- patient_health_profiles_pregnancy_status_not_null; validated=true
NOT NULL pregnancy_status
```
```sql
-- patient_health_profiles_primary_physician_id_fkey; validated=true
FOREIGN KEY (primary_physician_id) REFERENCES providers(id) ON DELETE RESTRICT
```
```sql
-- patient_health_profiles_review_time_check; validated=true
CHECK (last_health_review_at IS NULL OR isfinite(last_health_review_at))
```
```sql
-- patient_health_profiles_smoking_status_check; validated=true
CHECK (smoking_status = ANY (ARRAY['never'::text, 'former'::text, 'current'::text, 'unknown'::text]))
```
```sql
-- patient_health_profiles_smoking_status_not_null; validated=true
NOT NULL smoking_status
```
```sql
-- patient_health_profiles_updated_at_not_null; validated=true
NOT NULL updated_at
```
```sql
-- patient_health_profiles_weight_check; validated=true
CHECK (baseline_weight_kg > 0::numeric AND baseline_weight_kg < 'Infinity'::numeric)
```

### Indexes

```sql
-- patient_health_profiles_clinic_idx
CREATE INDEX patient_health_profiles_clinic_idx ON public.patient_health_profiles USING btree (preferred_clinic_id) WHERE (preferred_clinic_id IS NOT NULL)
```
```sql
-- patient_health_profiles_patient_id_key
CREATE UNIQUE INDEX patient_health_profiles_patient_id_key ON public.patient_health_profiles USING btree (patient_id)
```
```sql
-- patient_health_profiles_physician_idx
CREATE INDEX patient_health_profiles_physician_idx ON public.patient_health_profiles USING btree (primary_physician_id) WHERE (primary_physician_id IS NOT NULL)
```
```sql
-- patient_health_profiles_pkey
CREATE UNIQUE INDEX patient_health_profiles_pkey ON public.patient_health_profiles USING btree (id)
```

### Triggers

```sql
-- patient_health_profiles_updated_at; enabled=O
CREATE TRIGGER patient_health_profiles_updated_at BEFORE UPDATE ON patient_health_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at()
```

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**patient_health_profiles_read_authorized** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: can_access_patient(patient_id, 'clinical'::text)
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}`


## patient_medications

Created by: `20260820010500_medication.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20260821104000_patient_medication_read_model.sql`
- `20260929140000_medication_schema_improvements.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002140000_medication_event_patient_integrity.sql`
- `20261002160000_medication_prescription_patient_integrity.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Patient's medication course/read model.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010500_medication.sql`
- `20260820010900_ai_security.sql`
- `20260821104000_patient_medication_read_model.sql`
- `20260929140000_medication_schema_improvements.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002140000_medication_event_patient_integrity.sql`
- `20261002160000_medication_prescription_patient_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_id | uuid | NO | ? | ? |
| prescription_item_id | uuid | YES | ? | ? |
| medication_name | text | NO | ? | ? |
| dose | text | YES | ? | ? |
| frequency | text | YES | ? | ? |
| start_date | date | YES | ? | ? |
| end_date | date | YES | ? | ? |
| status | patient_medication_status | NO | 'active'::patient_medication_status | ? |
| created_by_profile_id | uuid | YES | ? | ? |
| instructions | text | YES | ? | ? |
| prescribing_provider_id | uuid | YES | ? | ? |
| reason_for_medication | text | YES | ? | ? |
| discontinued_at | timestamp with time zone | YES | ? | ? |
| discontinued_reason | text | YES | ? | ? |

### Constraints

```sql
-- patient_medications_check; validated=true
CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
```
```sql
-- patient_medications_created_by_profile_id_fkey; validated=true
FOREIGN KEY (created_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- patient_medications_discontinued_at_check; validated=true
CHECK (discontinued_at IS NULL OR isfinite(discontinued_at) AND status = 'discontinued'::patient_medication_status)
```
```sql
-- patient_medications_discontinued_reason_check; validated=true
CHECK (discontinued_reason IS NULL OR length(btrim(discontinued_reason)) > 0)
```
```sql
-- patient_medications_discontinued_status_check; validated=true
CHECK (discontinued_reason IS NULL OR status = 'discontinued'::patient_medication_status)
```
```sql
-- patient_medications_id_not_null; validated=true
NOT NULL id
```
```sql
-- patient_medications_medication_name_not_null; validated=true
NOT NULL medication_name
```
```sql
-- patient_medications_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- patient_medications_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- patient_medications_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- patient_medications_prescribing_provider_id_fkey; validated=true
FOREIGN KEY (prescribing_provider_id) REFERENCES providers(id) ON DELETE RESTRICT
```
```sql
-- patient_medications_prescription_item_id_fkey; validated=true
FOREIGN KEY (prescription_item_id) REFERENCES prescription_items(id) ON DELETE RESTRICT
```
```sql
-- patient_medications_reason_check; validated=true
CHECK (reason_for_medication IS NULL OR length(btrim(reason_for_medication)) > 0)
```
```sql
-- patient_medications_status_not_null; validated=true
NOT NULL status
```

### Indexes

```sql
-- patient_medications_patient_status_idx
CREATE INDEX patient_medications_patient_status_idx ON public.patient_medications USING btree (patient_id, status)
```
```sql
-- patient_medications_pkey
CREATE UNIQUE INDEX patient_medications_pkey ON public.patient_medications USING btree (id)
```
```sql
-- patient_medications_prescriber_idx
CREATE INDEX patient_medications_prescriber_idx ON public.patient_medications USING btree (prescribing_provider_id) WHERE (prescribing_provider_id IS NOT NULL)
```
```sql
-- patient_medications_prescription_item_idx
CREATE INDEX patient_medications_prescription_item_idx ON public.patient_medications USING btree (prescription_item_id) WHERE (prescription_item_id IS NOT NULL)
```

### Triggers

```sql
-- patient_medications_parent_guard; enabled=O
CREATE TRIGGER patient_medications_parent_guard BEFORE UPDATE OF patient_id ON patient_medications FOR EACH ROW EXECUTE FUNCTION check_medication_event_patient_chain()
```
```sql
-- patient_medications_prescription_guard; enabled=O
CREATE TRIGGER patient_medications_prescription_guard BEFORE INSERT OR UPDATE OF prescription_item_id, patient_id ON patient_medications FOR EACH ROW EXECUTE FUNCTION check_medication_prescription_patient_chain()
```

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**patient_medications_read_own** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: (EXISTS ( SELECT 1
   FROM patients patient
  WHERE ((patient.id = patient_medications.patient_id) AND (patient.auth_user_id = auth.uid()))))
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`

- Column `id`: `{authenticated=r/postgres}`
- Column `patient_id`: `{authenticated=r/postgres}`
- Column `medication_name`: `{authenticated=r/postgres}`
- Column `dose`: `{authenticated=r/postgres}`
- Column `frequency`: `{authenticated=r/postgres}`
- Column `start_date`: `{authenticated=r/postgres}`
- Column `end_date`: `{authenticated=r/postgres}`
- Column `status`: `{authenticated=r/postgres}`
- Column `instructions`: `{authenticated=r/postgres}`
- Column `prescribing_provider_id`: `{authenticated=r/postgres}`
- Column `reason_for_medication`: `{authenticated=r/postgres}`
- Column `discontinued_at`: `{authenticated=r/postgres}`
- Column `discontinued_reason`: `{authenticated=r/postgres}`

## patients

Created by: `20260820010100_patient_family.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010600_coordination.sql`
- `20260820010900_ai_security.sql`
- `20260820011100_simplify_patient_auth.sql`
- `20260821090000_patient_registration_service_role_lookup.sql`
- `20260821091000_patient_authenticated_self_read.sql`
- `20260821103000_patient_profile_self_service.sql`
- `20260928090000_patient_profile_identity_repair.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Patient entity and retained auth-linked demographics.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010100_patient_family.sql`
- `20260820010300_booking.sql`
- `20260820010400_clinical.sql`
- `20260820010500_medication.sql`
- `20260820010600_coordination.sql`
- `20260820010700_commercial.sql`
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`
- `20260820011000_patient_registration.sql`
- `20260820011100_simplify_patient_auth.sql`
- `20260821090000_patient_registration_service_role_lookup.sql`
- `20260821091000_patient_authenticated_self_read.sql`
- `20260821101000_patient_availability_read_access.sql`
- `20260821102000_patient_appointment_booking.sql`
- `20260821103000_patient_profile_self_service.sql`
- `20260821104000_patient_medication_read_model.sql`
- `20260928090000_patient_profile_identity_repair.sql`
- `20260929090000_patient_health_profiles.sql`
- `20260929120000_laboratory_data.sql`
- `20260929130000_clinical_documents.sql`
- `20260929140000_medication_schema_improvements.sql`
- `20260929170000_ai_overview_cache.sql`
- `20261001100000_follow_up_patient_integrity.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002160000_medication_prescription_patient_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| profile_id | uuid | NO | ? | ? |
| primary_phone | text | YES | ? | ? |
| address_line | text | YES | ? | ? |
| township | text | YES | ? | ? |
| city | text | YES | ? | ? |
| latitude | numeric(9,6) | YES | ? | ? |
| longitude | numeric(9,6) | YES | ? | ? |
| emergency_contact_name | text | YES | ? | ? |
| emergency_contact_relationship | text | YES | ? | ? |
| emergency_contact_phone | text | YES | ? | ? |
| blood_type | text | YES | ? | ? |
| care_preferences | jsonb | NO | '{}'::jsonb | ? |
| primary_coordinator_id | uuid | YES | ? | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |
| updated_at | timestamp with time zone | NO | statement_timestamp() | ? |
| auth_user_id | uuid | NO | ? | ? |
| full_name | text | NO | ? | ? |
| email | text | YES | ? | ? |
| date_of_birth | date | YES | ? | ? |
| gender | text | YES | ? | ? |
| preferred_language | text | NO | 'en'::text | ? |
| status | text | NO | 'active'::text | ? |

### Constraints

```sql
-- patients_auth_user_id_fkey; validated=true
FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT
```
```sql
-- patients_auth_user_id_not_null; validated=true
NOT NULL auth_user_id
```
```sql
-- patients_care_preferences_not_null; validated=true
NOT NULL care_preferences
```
```sql
-- patients_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- patients_date_of_birth_check; validated=true
CHECK (date_of_birth IS NULL OR date_of_birth < CURRENT_DATE)
```
```sql
-- patients_full_name_check; validated=true
CHECK (length(btrim(full_name)) >= 1 AND length(btrim(full_name)) <= 160)
```
```sql
-- patients_full_name_not_null; validated=true
NOT NULL full_name
```
```sql
-- patients_id_not_null; validated=true
NOT NULL id
```
```sql
-- patients_latitude_check; validated=true
CHECK (latitude IS NULL OR latitude >= '-90'::integer::numeric AND latitude <= 90::numeric)
```
```sql
-- patients_longitude_check; validated=true
CHECK (longitude IS NULL OR longitude >= '-180'::integer::numeric AND longitude <= 180::numeric)
```
```sql
-- patients_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- patients_preferred_language_check; validated=true
CHECK (preferred_language = ANY (ARRAY['en'::text, 'my'::text]))
```
```sql
-- patients_preferred_language_not_null; validated=true
NOT NULL preferred_language
```
```sql
-- patients_primary_coordinator_fk; validated=true
FOREIGN KEY (primary_coordinator_id) REFERENCES care_coordinators(id) ON DELETE SET NULL
```
```sql
-- patients_profile_auth_identity_check; validated=true
CHECK (profile_id = auth_user_id)
```
```sql
-- patients_profile_id_fkey; validated=true
FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- patients_profile_id_key; validated=true
UNIQUE (profile_id)
```
```sql
-- patients_profile_id_not_null; validated=true
NOT NULL profile_id
```
```sql
-- patients_status_check; validated=true
CHECK (status = ANY (ARRAY['active'::text, 'suspended'::text, 'inactive'::text]))
```
```sql
-- patients_status_not_null; validated=true
NOT NULL status
```
```sql
-- patients_updated_at_not_null; validated=true
NOT NULL updated_at
```

### Indexes

```sql
-- patients_auth_user_uidx
CREATE UNIQUE INDEX patients_auth_user_uidx ON public.patients USING btree (auth_user_id)
```
```sql
-- patients_pkey
CREATE UNIQUE INDEX patients_pkey ON public.patients USING btree (id)
```
```sql
-- patients_primary_phone_uidx
CREATE UNIQUE INDEX patients_primary_phone_uidx ON public.patients USING btree (primary_phone) WHERE (primary_phone IS NOT NULL)
```
```sql
-- patients_profile_id_key
CREATE UNIQUE INDEX patients_profile_id_key ON public.patients USING btree (profile_id)
```

### Triggers

```sql
-- patients_normalize_phones; enabled=O
CREATE TRIGGER patients_normalize_phones BEFORE INSERT OR UPDATE OF primary_phone, emergency_contact_phone ON patients FOR EACH ROW EXECUTE FUNCTION normalize_patient_phones()
```
```sql
-- patients_protect_auth_fields; enabled=O
CREATE TRIGGER patients_protect_auth_fields BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION protect_patient_auth_fields()
```
```sql
-- patients_updated_at; enabled=O
CREATE TRIGGER patients_updated_at BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION set_updated_at()
```

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**patients_read_own** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: (profile_id = auth.uid())
WITH CHECK: not specified
```

**patients_update_own** ? PERMISSIVE UPDATE TO ["authenticated"]

```sql
USING: (profile_id = auth.uid())
WITH CHECK: (profile_id = auth.uid())
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=adDxtm/postgres,service_role=arwdDxtm/postgres}`

- Column `id`: `{service_role=r/postgres,authenticated=r/postgres}`
- Column `profile_id`: `{authenticated=r/postgres}`
- Column `primary_phone`: `{service_role=r/postgres,authenticated=r/postgres}`
- Column `address_line`: `{authenticated=rw/postgres}`
- Column `township`: `{authenticated=rw/postgres}`
- Column `city`: `{authenticated=rw/postgres}`
- Column `emergency_contact_name`: `{authenticated=rw/postgres}`
- Column `emergency_contact_relationship`: `{authenticated=rw/postgres}`
- Column `emergency_contact_phone`: `{authenticated=rw/postgres}`
- Column `blood_type`: `{authenticated=rw/postgres}`
- Column `care_preferences`: `{authenticated=rw/postgres}`
- Column `auth_user_id`: `{authenticated=r/postgres}`
- Column `full_name`: `{authenticated=rw/postgres}`
- Column `date_of_birth`: `{authenticated=rw/postgres}`
- Column `gender`: `{authenticated=rw/postgres}`
- Column `preferred_language`: `{authenticated=rw/postgres}`
- Column `status`: `{authenticated=r/postgres}`

## payments

Created by: `20260820010700_commercial.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`
- `20261002100000_payment_appointment_integrity.sql`
- `20261002130000_subscription_payment_integrity.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Payer, patient and appointment/subscription payment ledger.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010700_commercial.sql`
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`
- `20260820011100_simplify_patient_auth.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002100000_payment_appointment_integrity.sql`
- `20261002130000_subscription_payment_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| payer_profile_id | uuid | NO | ? | ? |
| patient_id | uuid | NO | ? | ? |
| appointment_id | uuid | YES | ? | ? |
| subscription_id | uuid | YES | ? | ? |
| amount | numeric(12,2) | NO | ? | ? |
| currency | character(3) | NO | 'MMK'::bpchar | ? |
| status | payment_status | NO | 'pending'::payment_status | ? |
| payment_method | text | YES | ? | ? |
| transaction_reference | text | YES | ? | ? |
| paid_at | timestamp with time zone | YES | ? | ? |
| refunded_at | timestamp with time zone | YES | ? | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- payments_amount_check; validated=true
CHECK (amount >= 0::numeric)
```
```sql
-- payments_amount_not_null; validated=true
NOT NULL amount
```
```sql
-- payments_appointment_id_fkey; validated=true
FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE RESTRICT
```
```sql
-- payments_appointment_patient_fk; validated=true
FOREIGN KEY (appointment_id, patient_id) REFERENCES appointments(id, patient_id) ON UPDATE RESTRICT ON DELETE RESTRICT
```
```sql
-- payments_check; validated=true
CHECK (appointment_id IS NOT NULL OR subscription_id IS NOT NULL)
```
```sql
-- payments_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- payments_currency_not_null; validated=true
NOT NULL currency
```
```sql
-- payments_id_not_null; validated=true
NOT NULL id
```
```sql
-- payments_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- payments_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- payments_payer_profile_id_fkey; validated=true
FOREIGN KEY (payer_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- payments_payer_profile_id_not_null; validated=true
NOT NULL payer_profile_id
```
```sql
-- payments_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- payments_status_not_null; validated=true
NOT NULL status
```
```sql
-- payments_subscription_id_fkey; validated=true
FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE RESTRICT
```
```sql
-- payments_subscription_patient_fk; validated=true
FOREIGN KEY (subscription_id, patient_id) REFERENCES subscriptions(id, patient_id) ON UPDATE RESTRICT ON DELETE RESTRICT
```
```sql
-- payments_transaction_reference_key; validated=true
UNIQUE (transaction_reference)
```

### Indexes

```sql
-- payments_appointment_patient_idx
CREATE INDEX payments_appointment_patient_idx ON public.payments USING btree (appointment_id, patient_id) WHERE (appointment_id IS NOT NULL)
```
```sql
-- payments_pkey
CREATE UNIQUE INDEX payments_pkey ON public.payments USING btree (id)
```
```sql
-- payments_subscription_patient_idx
CREATE INDEX payments_subscription_patient_idx ON public.payments USING btree (subscription_id, patient_id) WHERE (subscription_id IS NOT NULL)
```
```sql
-- payments_transaction_reference_key
CREATE UNIQUE INDEX payments_transaction_reference_key ON public.payments USING btree (transaction_reference)
```

### Triggers

```sql
-- payments_audit; enabled=O
CREATE TRIGGER payments_audit AFTER INSERT OR DELETE OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION audit_row_change()
```

### Policies

**payments_create** ? PERMISSIVE INSERT TO ["authenticated"]

```sql
USING: not specified
WITH CHECK: ((payer_profile_id = auth.uid()) AND (status = 'pending'::payment_status) AND (paid_at IS NULL) AND (refunded_at IS NULL) AND can_create_payment_for_appointment(appointment_id, patient_id))
```

**payments_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: ((payer_profile_id = auth.uid()) OR can_access_patient(patient_id, 'payments'::text))
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## prescription_items

Created by: `20260820010500_medication.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002160000_medication_prescription_patient_integrity.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Medication instructions within a prescription.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010500_medication.sql`
- `20260820010900_ai_security.sql`
- `20261001090000_prescription_patient_integrity.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002160000_medication_prescription_patient_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| prescription_id | uuid | NO | ? | ? |
| medication_name | text | NO | ? | ? |
| strength | text | YES | ? | ? |
| dose | text | YES | ? | ? |
| route | text | YES | ? | ? |
| frequency | text | YES | ? | ? |
| duration_days | integer | YES | ? | ? |
| instructions | text | YES | ? | ? |

### Constraints

```sql
-- prescription_items_duration_days_check; validated=true
CHECK (duration_days IS NULL OR duration_days > 0)
```
```sql
-- prescription_items_id_not_null; validated=true
NOT NULL id
```
```sql
-- prescription_items_medication_name_not_null; validated=true
NOT NULL medication_name
```
```sql
-- prescription_items_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- prescription_items_prescription_id_fkey; validated=true
FOREIGN KEY (prescription_id) REFERENCES prescriptions(id) ON DELETE RESTRICT
```
```sql
-- prescription_items_prescription_id_not_null; validated=true
NOT NULL prescription_id
```

### Indexes

```sql
-- prescription_items_pkey
CREATE UNIQUE INDEX prescription_items_pkey ON public.prescription_items USING btree (id)
```

### Triggers

```sql
-- prescription_items_prescription_guard; enabled=O
CREATE TRIGGER prescription_items_prescription_guard BEFORE UPDATE OF prescription_id ON prescription_items FOR EACH ROW EXECUTE FUNCTION check_medication_prescription_patient_chain()
```

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**prescription_items_doctor_create** ? PERMISSIVE INSERT TO ["authenticated"]

```sql
USING: not specified
WITH CHECK: (EXISTS ( SELECT 1
   FROM (prescriptions rx
     JOIN providers p ON ((p.id = rx.doctor_provider_id)))
  WHERE ((rx.id = prescription_items.prescription_id) AND (p.profile_id = auth.uid()) AND (current_profile_role() = 'doctor'::profile_role))))
```

**prescription_items_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: (EXISTS ( SELECT 1
   FROM prescriptions p
  WHERE ((p.id = prescription_items.prescription_id) AND can_access_patient(p.patient_id, 'clinical'::text))))
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## prescriptions

Created by: `20260820010500_medication.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20261001090000_prescription_patient_integrity.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002160000_medication_prescription_patient_integrity.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Encounter-linked clinician prescription header.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010500_medication.sql`
- `20260820010900_ai_security.sql`
- `20261001090000_prescription_patient_integrity.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002160000_medication_prescription_patient_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| encounter_id | uuid | NO | ? | ? |
| patient_id | uuid | NO | ? | ? |
| doctor_provider_id | uuid | NO | ? | ? |
| status | prescription_status | NO | 'active'::prescription_status | ? |
| instructions | text | YES | ? | ? |
| issued_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- prescriptions_doctor_provider_id_fkey; validated=true
FOREIGN KEY (doctor_provider_id) REFERENCES providers(id) ON DELETE RESTRICT
```
```sql
-- prescriptions_doctor_provider_id_not_null; validated=true
NOT NULL doctor_provider_id
```
```sql
-- prescriptions_encounter_id_fkey; validated=true
FOREIGN KEY (encounter_id) REFERENCES care_encounters(id) ON DELETE RESTRICT
```
```sql
-- prescriptions_encounter_id_not_null; validated=true
NOT NULL encounter_id
```
```sql
-- prescriptions_encounter_patient_fk; validated=true
FOREIGN KEY (encounter_id, patient_id) REFERENCES care_encounters(id, patient_id) ON UPDATE RESTRICT ON DELETE RESTRICT
```
```sql
-- prescriptions_id_not_null; validated=true
NOT NULL id
```
```sql
-- prescriptions_issued_at_not_null; validated=true
NOT NULL issued_at
```
```sql
-- prescriptions_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- prescriptions_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- prescriptions_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- prescriptions_status_not_null; validated=true
NOT NULL status
```

### Indexes

```sql
-- prescriptions_encounter_patient_idx
CREATE INDEX prescriptions_encounter_patient_idx ON public.prescriptions USING btree (encounter_id, patient_id)
```
```sql
-- prescriptions_pkey
CREATE UNIQUE INDEX prescriptions_pkey ON public.prescriptions USING btree (id)
```

### Triggers

```sql
-- prescriptions_medication_guard; enabled=O
CREATE TRIGGER prescriptions_medication_guard BEFORE UPDATE OF patient_id ON prescriptions FOR EACH ROW EXECUTE FUNCTION check_medication_prescription_patient_chain()
```

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**prescriptions_doctor_create** ? PERMISSIVE INSERT TO ["authenticated"]

```sql
USING: not specified
WITH CHECK: ((current_profile_role() = 'doctor'::profile_role) AND (EXISTS ( SELECT 1
   FROM (providers provider
     JOIN care_encounters encounter ON ((encounter.provider_id = provider.id)))
  WHERE ((provider.id = prescriptions.doctor_provider_id) AND (provider.profile_id = auth.uid()) AND (encounter.id = prescriptions.encounter_id) AND (encounter.patient_id = prescriptions.patient_id)))))
```

**prescriptions_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: can_access_patient(patient_id, 'clinical'::text)
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## pricing_rules

Created by: `20260820010700_commercial.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Optional service surcharge/commission rules.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010700_commercial.sql`
- `20260820010900_ai_security.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| service_id | uuid | YES | ? | ? |
| rule_type | pricing_rule_type | NO | ? | ? |
| provider_type | provider_type | YES | ? | ? |
| value_type | pricing_value_type | NO | ? | ? |
| value | numeric | NO | ? | ? |
| effective_from | timestamp with time zone | YES | ? | ? |
| effective_to | timestamp with time zone | YES | ? | ? |
| active | boolean | NO | true | ? |

### Constraints

```sql
-- pricing_rules_active_not_null; validated=true
NOT NULL active
```
```sql
-- pricing_rules_check; validated=true
CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
```
```sql
-- pricing_rules_check1; validated=true
CHECK (value_type <> 'percentage'::pricing_value_type OR value <= 100::numeric)
```
```sql
-- pricing_rules_id_not_null; validated=true
NOT NULL id
```
```sql
-- pricing_rules_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- pricing_rules_rule_type_not_null; validated=true
NOT NULL rule_type
```
```sql
-- pricing_rules_service_id_fkey; validated=true
FOREIGN KEY (service_id) REFERENCES service_catalog(id) ON DELETE RESTRICT
```
```sql
-- pricing_rules_value_check; validated=true
CHECK (value >= 0::numeric)
```
```sql
-- pricing_rules_value_not_null; validated=true
NOT NULL value
```
```sql
-- pricing_rules_value_type_not_null; validated=true
NOT NULL value_type
```

### Indexes

```sql
-- pricing_rules_pkey
CREATE UNIQUE INDEX pricing_rules_pkey ON public.pricing_rules USING btree (id)
```

### Triggers

None.

### Policies

**pricing_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: active
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## profiles

Created by: `20260820010000_identity.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`
- `20260928090000_patient_profile_identity_repair.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Auth-linked identity, role, status and demographics.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010000_identity.sql`
- `20260820010100_patient_family.sql`
- `20260820010200_provider_supply.sql`
- `20260820010300_booking.sql`
- `20260820010400_clinical.sql`
- `20260820010500_medication.sql`
- `20260820010600_coordination.sql`
- `20260820010700_commercial.sql`
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`
- `20260820011000_patient_registration.sql`
- `20260820011100_simplify_patient_auth.sql`
- `20260821104000_patient_medication_read_model.sql`
- `20260928090000_patient_profile_identity_repair.sql`
- `20260929090000_patient_health_profiles.sql`
- `20260929110000_patient_conditions_allergies_metadata.sql`
- `20260929130000_clinical_documents.sql`
- `20260929160000_ai_health_summary_model.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | ? | ? |
| role | profile_role | NO | ? | ? |
| full_name | text | NO | ? | ? |
| phone | text | YES | ? | ? |
| email | text | YES | ? | ? |
| date_of_birth | date | YES | ? | ? |
| gender | text | YES | ? | ? |
| profile_photo_url | text | YES | ? | ? |
| preferred_language | text | NO | 'en'::text | ? |
| status | profile_status | NO | 'active'::profile_status | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |
| updated_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- profiles_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- profiles_date_of_birth_check; validated=true
CHECK (date_of_birth IS NULL OR date_of_birth < CURRENT_DATE)
```
```sql
-- profiles_full_name_check; validated=true
CHECK (length(btrim(full_name)) >= 1 AND length(btrim(full_name)) <= 160)
```
```sql
-- profiles_full_name_not_null; validated=true
NOT NULL full_name
```
```sql
-- profiles_id_fkey; validated=true
FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
```
```sql
-- profiles_id_not_null; validated=true
NOT NULL id
```
```sql
-- profiles_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- profiles_preferred_language_check; validated=true
CHECK (preferred_language = ANY (ARRAY['en'::text, 'my'::text]))
```
```sql
-- profiles_preferred_language_not_null; validated=true
NOT NULL preferred_language
```
```sql
-- profiles_role_not_null; validated=true
NOT NULL role
```
```sql
-- profiles_status_not_null; validated=true
NOT NULL status
```
```sql
-- profiles_updated_at_not_null; validated=true
NOT NULL updated_at
```

### Indexes

```sql
-- profiles_email_uidx
CREATE UNIQUE INDEX profiles_email_uidx ON public.profiles USING btree (lower(email)) WHERE (email IS NOT NULL)
```
```sql
-- profiles_phone_uidx
CREATE UNIQUE INDEX profiles_phone_uidx ON public.profiles USING btree (phone) WHERE (phone IS NOT NULL)
```
```sql
-- profiles_pkey
CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id)
```

### Triggers

```sql
-- profiles_audit; enabled=O
CREATE TRIGGER profiles_audit AFTER INSERT OR DELETE OR UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION audit_row_change()
```
```sql
-- profiles_normalize_phone; enabled=O
CREATE TRIGGER profiles_normalize_phone BEFORE INSERT OR UPDATE OF phone ON profiles FOR EACH ROW EXECUTE FUNCTION normalize_profile_phone()
```
```sql
-- profiles_protect_security_fields; enabled=O
CREATE TRIGGER profiles_protect_security_fields BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION protect_security_managed_fields()
```
```sql
-- profiles_updated_at; enabled=O
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at()
```

### Policies

**profiles_read_self** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: ((id = auth.uid()) OR is_main_admin())
WITH CHECK: not specified
```

**profiles_update_self** ? PERMISSIVE UPDATE TO ["authenticated"]

```sql
USING: (id = auth.uid())
WITH CHECK: (id = auth.uid())
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`

- Column `id`: `{authenticated=r/postgres}`
- Column `role`: `{authenticated=r/postgres}`
- Column `status`: `{authenticated=r/postgres}`

## provider_availability

Created by: `20260820010200_provider_supply.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20260821100000_patient_doctor_directory.sql`
- `20260821101000_patient_availability_read_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Provider booking slots.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010200_provider_supply.sql`
- `20260820010900_ai_security.sql`
- `20260821100000_patient_doctor_directory.sql`
- `20260821101000_patient_availability_read_access.sql`
- `20260821102000_patient_appointment_booking.sql`
- `20261001120000_appointment_pricing_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| provider_id | uuid | NO | ? | ? |
| clinic_id | uuid | YES | ? | ? |
| service_type | service_mode | NO | ? | ? |
| start_at | timestamp with time zone | NO | ? | ? |
| end_at | timestamp with time zone | NO | ? | ? |
| status | availability_status | NO | 'available'::availability_status | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- provider_availability_check; validated=true
CHECK (end_at > start_at)
```
```sql
-- provider_availability_clinic_id_fkey; validated=true
FOREIGN KEY (clinic_id) REFERENCES partner_clinics(id) ON DELETE RESTRICT
```
```sql
-- provider_availability_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- provider_availability_end_at_not_null; validated=true
NOT NULL end_at
```
```sql
-- provider_availability_id_not_null; validated=true
NOT NULL id
```
```sql
-- provider_availability_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- provider_availability_provider_id_fkey; validated=true
FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE RESTRICT
```
```sql
-- provider_availability_provider_id_not_null; validated=true
NOT NULL provider_id
```
```sql
-- provider_availability_service_type_not_null; validated=true
NOT NULL service_type
```
```sql
-- provider_availability_start_at_not_null; validated=true
NOT NULL start_at
```
```sql
-- provider_availability_status_not_null; validated=true
NOT NULL status
```

### Indexes

```sql
-- provider_availability_lookup_idx
CREATE INDEX provider_availability_lookup_idx ON public.provider_availability USING btree (provider_id, start_at, status)
```
```sql
-- provider_availability_pkey
CREATE UNIQUE INDEX provider_availability_pkey ON public.provider_availability USING btree (id)
```

### Triggers

None.

### Policies

**availability_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: (status = 'available'::availability_status)
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=rDxtm/postgres,service_role=arwdDxtm/postgres}`

- Column `id`: `{authenticated=r/postgres}`
- Column `provider_id`: `{authenticated=r/postgres}`
- Column `service_type`: `{authenticated=r/postgres}`
- Column `start_at`: `{authenticated=r/postgres}`
- Column `end_at`: `{authenticated=r/postgres}`
- Column `status`: `{authenticated=r/postgres}`

## provider_credentials

Created by: `20260820010200_provider_supply.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Licenses/certifications and verification evidence.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010200_provider_supply.sql`
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| provider_id | uuid | NO | ? | ? |
| credential_type | text | NO | ? | ? |
| credential_number | text | YES | ? | ? |
| issuer | text | YES | ? | ? |
| issued_date | date | YES | ? | ? |
| expiry_date | date | YES | ? | ? |
| document_url | text | YES | ? | ? |
| verification_status | verification_status | NO | 'pending'::verification_status | ? |
| verified_by | uuid | YES | ? | ? |
| verified_at | timestamp with time zone | YES | ? | ? |

### Constraints

```sql
-- provider_credentials_check; validated=true
CHECK (expiry_date IS NULL OR issued_date IS NULL OR expiry_date >= issued_date)
```
```sql
-- provider_credentials_credential_type_not_null; validated=true
NOT NULL credential_type
```
```sql
-- provider_credentials_id_not_null; validated=true
NOT NULL id
```
```sql
-- provider_credentials_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- provider_credentials_provider_id_fkey; validated=true
FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE RESTRICT
```
```sql
-- provider_credentials_provider_id_not_null; validated=true
NOT NULL provider_id
```
```sql
-- provider_credentials_verification_status_not_null; validated=true
NOT NULL verification_status
```
```sql
-- provider_credentials_verified_by_fkey; validated=true
FOREIGN KEY (verified_by) REFERENCES profiles(id) ON DELETE RESTRICT
```

### Indexes

```sql
-- provider_credentials_pkey
CREATE UNIQUE INDEX provider_credentials_pkey ON public.provider_credentials USING btree (id)
```

### Triggers

```sql
-- provider_credentials_audit; enabled=O
CREATE TRIGGER provider_credentials_audit AFTER INSERT OR DELETE OR UPDATE ON provider_credentials FOR EACH ROW EXECUTE FUNCTION audit_row_change()
```

### Policies

**credentials_owner_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_credentials.provider_id) AND (p.profile_id = auth.uid())))) OR is_main_admin())
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## provider_specialties

Created by: `20260820010200_provider_supply.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20260821100000_patient_doctor_directory.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Provider-to-specialty junction, primary specialty.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010200_provider_supply.sql`
- `20260820010900_ai_security.sql`
- `20260821100000_patient_doctor_directory.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| provider_id | uuid | NO | ? | ? |
| specialty_id | uuid | NO | ? | ? |
| is_primary | boolean | NO | false | ? |

### Constraints

```sql
-- provider_specialties_is_primary_not_null; validated=true
NOT NULL is_primary
```
```sql
-- provider_specialties_pkey; validated=true
PRIMARY KEY (provider_id, specialty_id)
```
```sql
-- provider_specialties_provider_id_fkey; validated=true
FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE RESTRICT
```
```sql
-- provider_specialties_provider_id_not_null; validated=true
NOT NULL provider_id
```
```sql
-- provider_specialties_specialty_id_fkey; validated=true
FOREIGN KEY (specialty_id) REFERENCES specialties(id) ON DELETE RESTRICT
```
```sql
-- provider_specialties_specialty_id_not_null; validated=true
NOT NULL specialty_id
```

### Indexes

```sql
-- provider_primary_specialty_uidx
CREATE UNIQUE INDEX provider_primary_specialty_uidx ON public.provider_specialties USING btree (provider_id) WHERE is_primary
```
```sql
-- provider_specialties_pkey
CREATE UNIQUE INDEX provider_specialties_pkey ON public.provider_specialties USING btree (provider_id, specialty_id)
```

### Triggers

None.

### Policies

**provider_specialties_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: true
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`

- Column `provider_id`: `{authenticated=r/postgres}`
- Column `specialty_id`: `{authenticated=r/postgres}`
- Column `is_primary`: `{authenticated=r/postgres}`

## providers

Created by: `20260820010200_provider_supply.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20260821100000_patient_doctor_directory.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Clinical provider identity, verification, directory and fee.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010200_provider_supply.sql`
- `20260820010300_booking.sql`
- `20260820010400_clinical.sql`
- `20260820010500_medication.sql`
- `20260820010900_ai_security.sql`
- `20260820011100_simplify_patient_auth.sql`
- `20260821100000_patient_doctor_directory.sql`
- `20260821101000_patient_availability_read_access.sql`
- `20260821102000_patient_appointment_booking.sql`
- `20260928090000_patient_profile_identity_repair.sql`
- `20260929090000_patient_health_profiles.sql`
- `20260929120000_laboratory_data.sql`
- `20260929140000_medication_schema_improvements.sql`
- `20261001090000_prescription_patient_integrity.sql`
- `20261001100000_follow_up_patient_integrity.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261001120000_appointment_pricing_integrity.sql`
- `20261002090000_encounter_appointment_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| profile_id | uuid | YES | ? | ? |
| provider_type | provider_type | NO | ? | ? |
| license_number | text | YES | ? | ? |
| verification_status | verification_status | NO | 'pending'::verification_status | ? |
| years_experience | integer | YES | ? | ? |
| bio | text | YES | ? | ? |
| languages | text[] | YES | ? | ? |
| service_area | jsonb | YES | ? | ? |
| home_visit_enabled | boolean | NO | false | ? |
| teleconsult_enabled | boolean | NO | false | ? |
| rating_average | numeric(3,2) | YES | ? | ? |
| verified_at | timestamp with time zone | YES | ? | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |
| updated_at | timestamp with time zone | NO | statement_timestamp() | ? |
| display_name | text | YES | ? | ? |
| qualification | text | YES | ? | ? |
| consultation_fee_mmk | integer | YES | ? | ? |

### Constraints

```sql
-- providers_consultation_fee_mmk_check; validated=true
CHECK (consultation_fee_mmk IS NULL OR consultation_fee_mmk >= 0)
```
```sql
-- providers_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- providers_display_name_check; validated=true
CHECK (display_name IS NULL OR length(btrim(display_name)) >= 1 AND length(btrim(display_name)) <= 160)
```
```sql
-- providers_home_visit_enabled_not_null; validated=true
NOT NULL home_visit_enabled
```
```sql
-- providers_id_not_null; validated=true
NOT NULL id
```
```sql
-- providers_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- providers_profile_id_fkey; validated=true
FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- providers_profile_id_key; validated=true
UNIQUE (profile_id)
```
```sql
-- providers_provider_type_not_null; validated=true
NOT NULL provider_type
```
```sql
-- providers_rating_average_check; validated=true
CHECK (rating_average IS NULL OR rating_average >= 0::numeric AND rating_average <= 5::numeric)
```
```sql
-- providers_teleconsult_enabled_not_null; validated=true
NOT NULL teleconsult_enabled
```
```sql
-- providers_updated_at_not_null; validated=true
NOT NULL updated_at
```
```sql
-- providers_verification_status_not_null; validated=true
NOT NULL verification_status
```
```sql
-- providers_years_experience_check; validated=true
CHECK (years_experience IS NULL OR years_experience >= 0)
```

### Indexes

```sql
-- providers_license_uidx
CREATE UNIQUE INDEX providers_license_uidx ON public.providers USING btree (provider_type, license_number) WHERE (license_number IS NOT NULL)
```
```sql
-- providers_pkey
CREATE UNIQUE INDEX providers_pkey ON public.providers USING btree (id)
```
```sql
-- providers_profile_id_key
CREATE UNIQUE INDEX providers_profile_id_key ON public.providers USING btree (profile_id)
```
```sql
-- providers_verified_idx
CREATE INDEX providers_verified_idx ON public.providers USING btree (provider_type) WHERE (verification_status = 'verified'::verification_status)
```

### Triggers

```sql
-- providers_protect_security_fields; enabled=O
CREATE TRIGGER providers_protect_security_fields BEFORE UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION protect_security_managed_fields()
```
```sql
-- providers_updated_at; enabled=O
CREATE TRIGGER providers_updated_at BEFORE UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION set_updated_at()
```

### Policies

**providers_directory_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: ((provider_type = 'doctor'::provider_type) AND (verification_status = 'verified'::verification_status))
WITH CHECK: not specified
```

**providers_owner_update** ? PERMISSIVE UPDATE TO ["authenticated"]

```sql
USING: ((profile_id = auth.uid()) OR is_main_admin())
WITH CHECK: ((profile_id = auth.uid()) OR is_main_admin())
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`

- Column `id`: `{authenticated=r/postgres}`
- Column `provider_type`: `{authenticated=r/postgres}`
- Column `verification_status`: `{authenticated=r/postgres}`
- Column `years_experience`: `{authenticated=r/postgres}`
- Column `bio`: `{authenticated=r/postgres}`
- Column `languages`: `{authenticated=r/postgres}`
- Column `service_area`: `{authenticated=r/postgres}`
- Column `home_visit_enabled`: `{authenticated=r/postgres}`
- Column `teleconsult_enabled`: `{authenticated=r/postgres}`
- Column `rating_average`: `{authenticated=r/postgres}`
- Column `display_name`: `{authenticated=r/postgres}`
- Column `qualification`: `{authenticated=r/postgres}`
- Column `consultation_fee_mmk`: `{authenticated=r/postgres}`

## service_catalog

Created by: `20260820010700_commercial.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Sellable care services and base catalog price.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010700_commercial.sql`
- `20260820010900_ai_security.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| code | text | NO | ? | ? |
| name | text | NO | ? | ? |
| provider_type | provider_type | YES | ? | ? |
| service_type | catalog_service_type | NO | ? | ? |
| base_price | numeric(12,2) | NO | ? | ? |
| currency | character(3) | NO | 'MMK'::bpchar | ? |
| active | boolean | NO | true | ? |

### Constraints

```sql
-- service_catalog_active_not_null; validated=true
NOT NULL active
```
```sql
-- service_catalog_base_price_check; validated=true
CHECK (base_price >= 0::numeric)
```
```sql
-- service_catalog_base_price_not_null; validated=true
NOT NULL base_price
```
```sql
-- service_catalog_code_key; validated=true
UNIQUE (code)
```
```sql
-- service_catalog_code_not_null; validated=true
NOT NULL code
```
```sql
-- service_catalog_currency_not_null; validated=true
NOT NULL currency
```
```sql
-- service_catalog_id_not_null; validated=true
NOT NULL id
```
```sql
-- service_catalog_name_not_null; validated=true
NOT NULL name
```
```sql
-- service_catalog_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- service_catalog_service_type_not_null; validated=true
NOT NULL service_type
```

### Indexes

```sql
-- service_catalog_code_key
CREATE UNIQUE INDEX service_catalog_code_key ON public.service_catalog USING btree (code)
```
```sql
-- service_catalog_pkey
CREATE UNIQUE INDEX service_catalog_pkey ON public.service_catalog USING btree (id)
```

### Triggers

None.

### Policies

**catalog_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: active
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## specialties

Created by: `20260820010200_provider_supply.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20260821100000_patient_doctor_directory.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Provider specialty catalog.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010200_provider_supply.sql`
- `20260820010900_ai_security.sql`
- `20260821100000_patient_doctor_directory.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| name | text | NO | ? | ? |

### Constraints

```sql
-- specialties_id_not_null; validated=true
NOT NULL id
```
```sql
-- specialties_name_key; validated=true
UNIQUE (name)
```
```sql
-- specialties_name_not_null; validated=true
NOT NULL name
```
```sql
-- specialties_pkey; validated=true
PRIMARY KEY (id)
```

### Indexes

```sql
-- specialties_name_key
CREATE UNIQUE INDEX specialties_name_key ON public.specialties USING btree (name)
```
```sql
-- specialties_pkey
CREATE UNIQUE INDEX specialties_pkey ON public.specialties USING btree (id)
```

### Triggers

None.

### Policies

**specialties_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: true
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`

- Column `id`: `{authenticated=r/postgres}`
- Column `name`: `{authenticated=r/postgres}`

## subscriptions

Created by: `20260820010700_commercial.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20261002130000_subscription_payment_integrity.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Patient's purchased commercial package.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010700_commercial.sql`
- `20260820010900_ai_security.sql`
- `20261002130000_subscription_payment_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_id | uuid | NO | ? | ? |
| purchased_by_profile_id | uuid | NO | ? | ? |
| package_id | uuid | NO | ? | ? |
| status | subscription_status | NO | 'pending'::subscription_status | ? |
| start_at | timestamp with time zone | YES | ? | ? |
| end_at | timestamp with time zone | YES | ? | ? |
| renewal_type | renewal_type | YES | ? | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- subscriptions_check; validated=true
CHECK (end_at IS NULL OR start_at IS NULL OR end_at >= start_at)
```
```sql
-- subscriptions_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- subscriptions_id_not_null; validated=true
NOT NULL id
```
```sql
-- subscriptions_id_patient_key; validated=true
UNIQUE (id, patient_id)
```
```sql
-- subscriptions_package_id_fkey; validated=true
FOREIGN KEY (package_id) REFERENCES care_packages(id) ON DELETE RESTRICT
```
```sql
-- subscriptions_package_id_not_null; validated=true
NOT NULL package_id
```
```sql
-- subscriptions_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- subscriptions_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- subscriptions_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- subscriptions_purchased_by_profile_id_fkey; validated=true
FOREIGN KEY (purchased_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- subscriptions_purchased_by_profile_id_not_null; validated=true
NOT NULL purchased_by_profile_id
```
```sql
-- subscriptions_status_not_null; validated=true
NOT NULL status
```

### Indexes

```sql
-- subscriptions_id_patient_key
CREATE UNIQUE INDEX subscriptions_id_patient_key ON public.subscriptions USING btree (id, patient_id)
```
```sql
-- subscriptions_pkey
CREATE UNIQUE INDEX subscriptions_pkey ON public.subscriptions USING btree (id)
```

### Triggers

None.

### Policies

**subscriptions_create** ? PERMISSIVE INSERT TO ["authenticated"]

```sql
USING: not specified
WITH CHECK: ((purchased_by_profile_id = auth.uid()) AND (status = 'pending'::subscription_status) AND can_access_patient(patient_id, 'payments'::text))
```

**subscriptions_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: can_access_patient(patient_id, 'payments'::text)
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## teleconsultation_sessions

Created by: `20260820010900_ai_security.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20261001110000_suspended_provider_clinical_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Appointment room/link and session lifecycle.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010900_ai_security.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| appointment_id | uuid | NO | ? | ? |
| provider_name | text | YES | ? | ? |
| room_reference | text | YES | ? | ? |
| join_url_patient | text | YES | ? | ? |
| join_url_provider | text | YES | ? | ? |
| started_at | timestamp with time zone | YES | ? | ? |
| ended_at | timestamp with time zone | YES | ? | ? |
| status | teleconsultation_status | NO | 'scheduled'::teleconsultation_status | ? |

### Constraints

```sql
-- teleconsultation_sessions_appointment_id_fkey; validated=true
FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE RESTRICT
```
```sql
-- teleconsultation_sessions_appointment_id_key; validated=true
UNIQUE (appointment_id)
```
```sql
-- teleconsultation_sessions_appointment_id_not_null; validated=true
NOT NULL appointment_id
```
```sql
-- teleconsultation_sessions_check; validated=true
CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)
```
```sql
-- teleconsultation_sessions_id_not_null; validated=true
NOT NULL id
```
```sql
-- teleconsultation_sessions_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- teleconsultation_sessions_status_not_null; validated=true
NOT NULL status
```

### Indexes

```sql
-- teleconsultation_sessions_appointment_id_key
CREATE UNIQUE INDEX teleconsultation_sessions_appointment_id_key ON public.teleconsultation_sessions USING btree (appointment_id)
```
```sql
-- teleconsultation_sessions_pkey
CREATE UNIQUE INDEX teleconsultation_sessions_pkey ON public.teleconsultation_sessions USING btree (id)
```

### Triggers

None.

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**teleconsultation_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: (EXISTS ( SELECT 1
   FROM appointments a
  WHERE ((a.id = teleconsultation_sessions.appointment_id) AND can_access_patient(a.patient_id, 'appointments'::text))))
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## visit_status_events

Created by: `20260820010300_booking.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Appointment visit progress history.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010300_booking.sql`
- `20260820010800_governance.sql`
- `20260820010900_ai_security.sql`
- `20261001110000_suspended_provider_clinical_access.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| appointment_id | uuid | NO | ? | ? |
| status | visit_status | NO | ? | ? |
| actor_profile_id | uuid | YES | ? | ? |
| latitude | numeric(9,6) | YES | ? | ? |
| longitude | numeric(9,6) | YES | ? | ? |
| notes | text | YES | ? | ? |
| created_at | timestamp with time zone | NO | statement_timestamp() | ? |

### Constraints

```sql
-- visit_status_events_actor_profile_id_fkey; validated=true
FOREIGN KEY (actor_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- visit_status_events_appointment_id_fkey; validated=true
FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE RESTRICT
```
```sql
-- visit_status_events_appointment_id_not_null; validated=true
NOT NULL appointment_id
```
```sql
-- visit_status_events_created_at_not_null; validated=true
NOT NULL created_at
```
```sql
-- visit_status_events_id_not_null; validated=true
NOT NULL id
```
```sql
-- visit_status_events_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- visit_status_events_status_not_null; validated=true
NOT NULL status
```

### Indexes

```sql
-- visit_status_events_appointment_idx
CREATE INDEX visit_status_events_appointment_idx ON public.visit_status_events USING btree (appointment_id, created_at)
```
```sql
-- visit_status_events_pkey
CREATE UNIQUE INDEX visit_status_events_pkey ON public.visit_status_events USING btree (id)
```

### Triggers

```sql
-- visit_status_events_immutable; enabled=O
CREATE TRIGGER visit_status_events_immutable BEFORE DELETE OR UPDATE ON visit_status_events FOR EACH ROW EXECUTE FUNCTION reject_immutable_change()
```

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**visit_events_provider_create** ? PERMISSIVE INSERT TO ["authenticated"]

```sql
USING: not specified
WITH CHECK: ((actor_profile_id = auth.uid()) AND (is_appointment_provider(appointment_id) OR is_main_admin()))
```

**visit_events_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: (EXISTS ( SELECT 1
   FROM appointments a
  WHERE ((a.id = visit_status_events.appointment_id) AND can_access_patient(a.patient_id, 'appointments'::text))))
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`


## vital_readings

Created by: `20260820010400_clinical.sql`.

Modified by (actual table-catalog changes: columns, ACL, constraints, indexes, triggers or policies):
- `20260820010900_ai_security.sql`
- `20260929100000_vital_readings_dashboard_metadata.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002120000_vital_encounter_integrity.sql`
- `20261002150000_monitoring_alert_vital_patient_integrity.sql`

Helper-only behavior changes can also affect this table without changing its catalog signature; see migration references and Repair 3 in the primary handoff.

RLS: **true**; FORCE RLS: false.

Purpose: Timestamped measurements and provenance.

Migration references (DDL, policy, function or dependency mentions; not every mention is an ALTER):
- `20260820010400_clinical.sql`
- `20260820010600_coordination.sql`
- `20260820010900_ai_security.sql`
- `20260929100000_vital_readings_dashboard_metadata.sql`
- `20261001110000_suspended_provider_clinical_access.sql`
- `20261002120000_vital_encounter_integrity.sql`
- `20261002150000_monitoring_alert_vital_patient_integrity.sql`

| Column | Type | Nullable | Default/generated expression | Comment |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | ? |
| patient_id | uuid | NO | ? | ? |
| encounter_id | uuid | YES | ? | ? |
| recorded_by_profile_id | uuid | YES | ? | ? |
| source | vital_source | NO | ? | ? |
| systolic_bp | integer | YES | ? | ? |
| diastolic_bp | integer | YES | ? | ? |
| heart_rate | integer | YES | ? | ? |
| spo2 | numeric(5,2) | YES | ? | ? |
| temperature_c | numeric(4,1) | YES | ? | ? |
| glucose_mg_dl | numeric | YES | ? | ? |
| weight_kg | numeric(6,2) | YES | ? | ? |
| recorded_at | timestamp with time zone | NO | ? | ? |
| notes | text | YES | ? | ? |
| measurement_context | text | YES | ? | Optional measurement circumstances, e.g. resting, fasting, or after exercise. Not an AI interpretation. |
| source_type | vital_source | YES | GENERATED: source | Read-only dashboard alias of source (manual/provider/device). Inserts continue to supply source. |

### Constraints

```sql
-- vital_readings_diastolic_bp_check; validated=true
CHECK (diastolic_bp IS NULL OR diastolic_bp > 0)
```
```sql
-- vital_readings_encounter_id_fkey; validated=true
FOREIGN KEY (encounter_id) REFERENCES care_encounters(id) ON DELETE RESTRICT
```
```sql
-- vital_readings_encounter_patient_fk; validated=true
FOREIGN KEY (encounter_id, patient_id) REFERENCES care_encounters(id, patient_id) ON UPDATE RESTRICT ON DELETE RESTRICT
```
```sql
-- vital_readings_glucose_finite_check; validated=true
CHECK (glucose_mg_dl IS NULL OR glucose_mg_dl >= 0::numeric AND glucose_mg_dl < 'Infinity'::numeric)
```
```sql
-- vital_readings_heart_rate_check; validated=true
CHECK (heart_rate IS NULL OR heart_rate > 0)
```
```sql
-- vital_readings_id_not_null; validated=true
NOT NULL id
```
```sql
-- vital_readings_id_patient_key; validated=true
UNIQUE (id, patient_id)
```
```sql
-- vital_readings_measurement_context_check; validated=true
CHECK (measurement_context IS NULL OR length(btrim(measurement_context)) >= 1 AND length(btrim(measurement_context)) <= 500)
```
```sql
-- vital_readings_patient_id_fkey; validated=true
FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
```
```sql
-- vital_readings_patient_id_not_null; validated=true
NOT NULL patient_id
```
```sql
-- vital_readings_pkey; validated=true
PRIMARY KEY (id)
```
```sql
-- vital_readings_recorded_at_finite_check; validated=true
CHECK (isfinite(recorded_at))
```
```sql
-- vital_readings_recorded_at_not_null; validated=true
NOT NULL recorded_at
```
```sql
-- vital_readings_recorded_by_profile_id_fkey; validated=true
FOREIGN KEY (recorded_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
```
```sql
-- vital_readings_source_not_null; validated=true
NOT NULL source
```
```sql
-- vital_readings_spo2_check; validated=true
CHECK (spo2 IS NULL OR spo2 >= 0::numeric AND spo2 <= 100::numeric)
```
```sql
-- vital_readings_systolic_bp_check; validated=true
CHECK (systolic_bp IS NULL OR systolic_bp > 0)
```
```sql
-- vital_readings_temperature_finite_check; validated=true
CHECK (temperature_c IS NULL OR temperature_c > '-273.15'::numeric AND temperature_c < 'Infinity'::numeric)
```
```sql
-- vital_readings_weight_finite_check; validated=true
CHECK (weight_kg IS NULL OR weight_kg < 'Infinity'::numeric)
```
```sql
-- vital_readings_weight_kg_check; validated=true
CHECK (weight_kg IS NULL OR weight_kg > 0::numeric)
```

### Indexes

```sql
-- vital_readings_encounter_patient_idx
CREATE INDEX vital_readings_encounter_patient_idx ON public.vital_readings USING btree (encounter_id, patient_id) WHERE (encounter_id IS NOT NULL)
```
```sql
-- vital_readings_id_patient_key
CREATE UNIQUE INDEX vital_readings_id_patient_key ON public.vital_readings USING btree (id, patient_id)
```
```sql
-- vital_readings_patient_recorded_idx
CREATE INDEX vital_readings_patient_recorded_idx ON public.vital_readings USING btree (patient_id, recorded_at DESC)
```
```sql
-- vital_readings_pkey
CREATE UNIQUE INDEX vital_readings_pkey ON public.vital_readings USING btree (id)
```

### Triggers

None.

### Policies

**clinical_identity_required** ? RESTRICTIVE ALL TO ["authenticated"]

```sql
USING: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
WITH CHECK: ( SELECT clinical_identity_is_current() AS clinical_identity_is_current)
```

**vitals_assigned_create** ? PERMISSIVE INSERT TO ["authenticated"]

```sql
USING: not specified
WITH CHECK: ((recorded_by_profile_id = auth.uid()) AND (current_profile_role() = ANY (ARRAY['doctor'::profile_role, 'nurse'::profile_role, 'caregiver'::profile_role])) AND can_access_patient(patient_id, 'clinical'::text))
```

**vitals_read** ? PERMISSIVE SELECT TO ["authenticated"]

```sql
USING: can_access_patient(patient_id, 'clinical'::text)
WITH CHECK: not specified
```

### Harness ACL (see caveat)

`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`

- Column `patient_id`: `{authenticated=a/postgres}`
- Column `encounter_id`: `{authenticated=a/postgres}`
- Column `recorded_by_profile_id`: `{authenticated=a/postgres}`
- Column `source`: `{authenticated=a/postgres}`
- Column `systolic_bp`: `{authenticated=a/postgres}`
- Column `diastolic_bp`: `{authenticated=a/postgres}`
- Column `heart_rate`: `{authenticated=a/postgres}`
- Column `spo2`: `{authenticated=a/postgres}`
- Column `temperature_c`: `{authenticated=a/postgres}`
- Column `glucose_mg_dl`: `{authenticated=a/postgres}`
- Column `weight_kg`: `{authenticated=a/postgres}`
- Column `recorded_at`: `{authenticated=a/postgres}`
- Column `notes`: `{authenticated=a/postgres}`
- Column `measurement_context`: `{authenticated=a/postgres}`

## Application functions / RPCs and trigger functions

Full final definitions are included to preserve helper semantics, grant boundaries, and parent mutation protections. Extension-owned functions are omitted.

### audit_row_change()

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `default; PUBLIC EXECUTE unless separately restricted`.

```sql
CREATE OR REPLACE FUNCTION public.audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  old_row jsonb;
  new_row jsonb;
  row_data jsonb;
begin
  old_row := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  new_row := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  row_data := coalesce(new_row, old_row);

  insert into public.audit_logs(actor_profile_id, patient_id, action, entity_table, entity_id, before_data, after_data)
  values (
    case when exists (select 1 from public.profiles p where p.id = auth.uid()) then auth.uid() else null end,
    case when row_data ? 'patient_id' and nullif(row_data->>'patient_id','') is not null
      then (row_data->>'patient_id')::uuid else null end,
    lower(tg_op), tg_table_name, coalesce(row_data->>'id', row_data->>'profile_id'), old_row, new_row
  );
  return case when tg_op = 'DELETE' then old else new end;
end $function$

```

### can_access_patient(target_patient_id uuid, permission_name text)

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres,authenticated=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.can_access_patient(target_patient_id uuid, permission_name text DEFAULT 'view'::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.clinical_identity_is_current() and (
    exists (
      select 1 from public.patients patient
      where patient.id = target_patient_id and patient.auth_user_id = auth.uid()
    )
    or public.is_main_admin()
    or exists (
      select 1 from public.family_authorizations fa
      where fa.patient_id = target_patient_id
        and fa.family_profile_id = auth.uid()
        and fa.status = 'active'
        and case permission_name
          when 'appointments' then fa.can_manage_appointments
          when 'medications' then fa.can_manage_medications
          when 'payments' then fa.can_make_payments
          when 'alerts' then fa.can_receive_alerts
          else fa.can_view_records
        end
    )
    or exists (
      select 1 from public.providers provider
      where public.current_profile_role() in ('doctor','nurse','caregiver') and provider.profile_id = auth.uid() and provider.verification_status = 'verified'
        and (
          exists (select 1 from public.appointments appointment where appointment.patient_id = target_patient_id and appointment.provider_id = provider.id)
          or exists (
            select 1 from public.care_assignments assignment
            join public.care_requests request on request.id = assignment.care_request_id
            where request.patient_id = target_patient_id
              and assignment.provider_id = provider.id
              and assignment.status in ('assigned', 'accepted')
          )
        )
    )
    or (permission_name in ('view', 'appointments', 'alerts') and exists (
      select 1 from public.care_coordinators coordinator
      where public.current_profile_role() = 'coordinator' and coordinator.profile_id = auth.uid()
        and (
          exists (select 1 from public.patients patient where patient.id = target_patient_id and patient.primary_coordinator_id = coordinator.id)
          or exists (select 1 from public.care_requests request where request.patient_id = target_patient_id and request.coordinator_id = coordinator.id)
        )
    ))
    or (permission_name in ('appointments', 'alerts') and exists (
      select 1
      from public.clinic_staff admin_staff
      join public.clinic_staff provider_staff
        on provider_staff.clinic_id = admin_staff.clinic_id and provider_staff.status = 'active'
      join public.appointments appointment on appointment.provider_id = provider_staff.provider_id
      where public.current_profile_role() = 'clinic_admin' and admin_staff.profile_id = auth.uid()
        and admin_staff.clinic_role = 'sub_admin'
        and admin_staff.status = 'active'
        and appointment.patient_id = target_patient_id
    ))
  )
$function$

```

### can_create_payment_for_appointment(target_appointment_id uuid, target_patient_id uuid)

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres,authenticated=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.can_create_payment_for_appointment(target_appointment_id uuid, target_patient_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(public.can_access_patient(target_patient_id,'payments'),false)
    and (target_appointment_id is null or exists (
      select 1 from public.appointments a
      where a.id=target_appointment_id and a.patient_id=target_patient_id
    ))
$function$

```

### can_manage_care_encounter(target_appointment_id uuid, target_patient_id uuid, target_provider_id uuid)

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres,authenticated=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.can_manage_care_encounter(target_appointment_id uuid, target_patient_id uuid, target_provider_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.clinical_identity_is_current() and exists (
    select 1 from public.appointments a
    where a.id=target_appointment_id and a.patient_id=target_patient_id
      and (public.is_main_admin() or (
        public.current_profile_role() in ('doctor','nurse','caregiver')
        and a.provider_id=target_provider_id
        and exists (select 1 from public.providers p
          where p.id=target_provider_id and p.profile_id=auth.uid()
            and p.verification_status='verified')
      ))
  )
$function$

```

### can_manage_follow_up(target_patient_id uuid, target_assignee_profile_id uuid)

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres,authenticated=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.can_manage_follow_up(target_patient_id uuid, target_assignee_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.is_main_admin() or (
    target_assignee_profile_id = auth.uid()
    and (
      (public.current_profile_role() in ('doctor','nurse','caregiver')
        and public.can_access_patient(target_patient_id, 'clinical'))
      or (public.current_profile_role() = 'coordinator'
        and public.can_access_patient(target_patient_id, 'view'))
    )
  )
$function$

```

### check_care_assignment_patient_chain()

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.check_care_assignment_patient_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  request_patient uuid;
  appointment_patient uuid;
begin
  if tg_table_name = 'care_assignments' then
    if new.appointment_id is null then
      -- Assignments legitimately exist before an appointment is created.
      return new;
    end if;

    select r.patient_id into request_patient
    from public.care_requests as r
    where r.id = new.care_request_id
    for share;

    select p.patient_id into appointment_patient
    from public.appointments as p
    where p.id = new.appointment_id
    for share;

    if request_patient is null or appointment_patient is null
       or request_patient is distinct from appointment_patient then
      raise exception 'Care assignment patient mismatch: assignment care request patient % does not match appointment patient %',
        request_patient, appointment_patient
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'care_requests' then
    if new.patient_id is distinct from old.patient_id
       and exists (
         select 1
         from public.care_assignments as a
         join public.appointments as p on p.id = a.appointment_id
         where a.care_request_id = old.id and p.patient_id is distinct from new.patient_id
       ) then
      raise exception 'Care request reassignment would invalidate care assignment patient ownership'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'appointments' then
    if new.patient_id is distinct from old.patient_id
       and exists (
         select 1
         from public.care_assignments as a
         join public.care_requests as r on r.id = a.care_request_id
         where a.appointment_id = old.id and r.patient_id is distinct from new.patient_id
       ) then
      raise exception 'Appointment patient reassignment would invalidate care assignment patient ownership'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$

```

### check_complaint_appointment_patient_chain()

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.check_complaint_appointment_patient_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.patient_id is distinct from old.patient_id
     and exists (
       select 1 from public.complaints as c
       where c.appointment_id = old.id
         and c.patient_id is not null
         and c.patient_id is distinct from new.patient_id
     ) then
    raise exception 'Appointment patient reassignment would invalidate complaint patient ownership'
      using errcode = '23514';
  end if;
  return new;
end;
$function$

```

### check_follow_up_parent_chain()

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.check_follow_up_parent_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare parent_appointment uuid; parent_patient uuid; encounter_patient uuid;
begin
  if tg_table_name = 'follow_ups' then
    select encounter.appointment_id, encounter.patient_id into parent_appointment, encounter_patient
    from public.care_encounters as encounter where encounter.id = new.encounter_id
    for share;
    select appointment.patient_id into parent_patient
    from public.appointments as appointment where appointment.id = parent_appointment
    for share;
    if parent_patient is distinct from encounter_patient then
      raise exception 'Follow-up appointment patient mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'care_encounters' then
    -- Lock the appointment even before testing for children: a concurrent
    -- follow-up insert locks this encounter and cannot pass an obsolete chain.
    select appointment.patient_id into parent_patient
    from public.appointments as appointment where appointment.id = new.appointment_id
    for share;
    if parent_patient is distinct from new.patient_id and exists (
      select 1 from public.follow_ups as follow_up where follow_up.encounter_id = old.id
    ) then
      raise exception 'Encounter change would invalidate follow-up ownership' using errcode = '23514';
    end if;
  elsif tg_table_name = 'appointments' then
    if exists (
      select 1 from public.care_encounters as encounter
      join public.follow_ups as follow_up on follow_up.encounter_id = encounter.id
      where encounter.appointment_id = old.id and follow_up.patient_id is distinct from new.patient_id
    ) then
      raise exception 'Appointment change would invalidate follow-up ownership' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$

```

### check_medication_event_patient_chain()

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.check_medication_event_patient_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  schedule_patient uuid;
  new_med_patient uuid;
begin
  if tg_table_name = 'medication_events' then
    select m.patient_id into schedule_patient
    from public.medication_schedules as s
    join public.patient_medications as m on m.id = s.patient_medication_id
    where s.id = new.schedule_id
    for share of s, m;

    if schedule_patient is null or new.patient_id is distinct from schedule_patient then
      raise exception 'Medication event patient mismatch: event patient % does not match schedule patient %', new.patient_id, schedule_patient
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'medication_schedules' then
    if new.patient_medication_id is distinct from old.patient_medication_id then
      select m.patient_id into new_med_patient
      from public.patient_medications as m
      where m.id = new.patient_medication_id
      for share of m;

      if exists (
        select 1 from public.medication_events as e
        where e.schedule_id = old.id and e.patient_id is distinct from new_med_patient
      ) then
        raise exception 'Medication schedule reassignment would invalidate medication event patient ownership'
          using errcode = '23514';
      end if;
    end if;
  elsif tg_table_name = 'patient_medications' then
    if new.patient_id is distinct from old.patient_id then
      if exists (
        select 1 from public.medication_schedules as s
        join public.medication_events as e on e.schedule_id = s.id
        where s.patient_medication_id = old.id and e.patient_id is distinct from new.patient_id
      ) then
        raise exception 'Patient medication reassignment would invalidate medication event patient ownership'
          using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$function$

```

### check_medication_prescription_patient_chain()

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.check_medication_prescription_patient_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  item_patient uuid;
  new_prescription uuid;
begin
  if tg_table_name = 'patient_medications' then
    if new.prescription_item_id is null then
      -- Manual medication with no prescription origin. Nothing to compare.
      return new;
    end if;

    select p.patient_id into item_patient
    from public.prescription_items as i
    join public.prescriptions as p on p.id = i.prescription_id
    where i.id = new.prescription_item_id
    for share of i, p;

    -- A missing item is already rejected by the pre-existing single-column
    -- foreign key with 23503. Defer to it so error codes are unchanged.
    if item_patient is null then
      return new;
    end if;

    if new.patient_id is distinct from item_patient then
      raise exception 'Patient medication prescription mismatch: medication patient % does not match prescription item patient %', new.patient_id, item_patient
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'prescription_items' then
    if new.prescription_id is not distinct from old.prescription_id then
      return new;
    end if;

    select p.patient_id into new_prescription
    from public.prescriptions as p
    where p.id = new.prescription_id
    for share of p;

    -- Unknown prescription: the pre-existing foreign key reports 23503.
    if new_prescription is null then
      return new;
    end if;

    if exists (
      select 1 from public.patient_medications as m
      where m.prescription_item_id = old.id and m.patient_id is distinct from new_prescription
    ) then
      raise exception 'Prescription item reassignment would invalidate patient medication patient ownership'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'prescriptions' then
    if new.patient_id is not distinct from old.patient_id then
      return new;
    end if;

    -- Unknown patient: the pre-existing foreign key reports 23503. Repair 1's
    -- prescriptions_encounter_patient_fk also still guards the encounter link;
    -- neither is weakened or duplicated here.
    if not exists (select 1 from public.patients as pt where pt.id = new.patient_id) then
      return new;
    end if;

    if exists (
      select 1
      from public.prescription_items as i
      join public.patient_medications as m on m.prescription_item_id = i.id
      where i.prescription_id = old.id and m.patient_id is distinct from new.patient_id
    ) then
      raise exception 'Prescription patient reassignment would invalidate patient medication patient ownership'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$

```

### claim_ai_overview(p_patient_id uuid, p_token uuid)

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres,service_role=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.claim_ai_overview(p_patient_id uuid, p_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare claimed uuid;
begin
  insert into public.ai_overview_leases(patient_id,token,lease_until,retry_after)
  values(p_patient_id,p_token,clock_timestamp()+interval '90 seconds',clock_timestamp()+interval '2 minutes')
  on conflict(patient_id) do update set token=excluded.token,lease_until=excluded.lease_until,retry_after=excluded.retry_after
  where public.ai_overview_leases.lease_until <= clock_timestamp() and public.ai_overview_leases.retry_after <= clock_timestamp()
  returning token into claimed;
  return claimed is not null;
end;
$function$

```

### clinical_identity_is_current()

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres,authenticated=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.clinical_identity_is_current()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select case
    -- Preserve existing patient/family rules; their relationships remain in RLS.
    when p.role in ('patient','family') then true
    when p.status is distinct from 'active' then false
    when p.role in ('doctor','nurse','caregiver') then exists (
      select 1 from public.providers pr where pr.profile_id=p.id
        and pr.verification_status='verified')
    when p.role='coordinator' then exists (
      select 1 from public.care_coordinators cc where cc.profile_id=p.id
        and cc.status='active')
    when p.role='clinic_admin' then exists (
      select 1 from public.clinic_staff cs where cs.profile_id=p.id
        and cs.clinic_role='sub_admin' and cs.status='active')
    when p.role='main_admin' then true
    else false end from public.profiles p where p.id=auth.uid()),false)
$function$

```

### consume_ai_overview_request(p_patient_id uuid)

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres,service_role=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.consume_ai_overview_request(p_patient_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare accepted uuid;
begin
  insert into public.ai_overview_request_limits(patient_id,window_start,attempts)
  values(p_patient_id,clock_timestamp(),1)
  on conflict(patient_id) do update
    set window_start=case when public.ai_overview_request_limits.window_start <= clock_timestamp()-interval '15 minutes' then clock_timestamp() else public.ai_overview_request_limits.window_start end,
        attempts=case when public.ai_overview_request_limits.window_start <= clock_timestamp()-interval '15 minutes' then 1 else public.ai_overview_request_limits.attempts+1 end
    where public.ai_overview_request_limits.window_start <= clock_timestamp()-interval '15 minutes' or public.ai_overview_request_limits.attempts<60
  returning patient_id into accepted;
  return accepted is not null;
end;
$function$

```

### create_patient_registration(registration jsonb)

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres,service_role=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.create_patient_registration(registration jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  patient_id uuid;
  user_id uuid := (registration->>'userId')::uuid;
  medical_profile jsonb := registration->'medicalProfile';
begin
  if user_id is null or not exists (select 1 from auth.users where id = user_id) then
    raise exception 'Invalid managed Auth user';
  end if;

  insert into public.profiles (
    id, role, full_name, phone, email, date_of_birth, gender, preferred_language, status
  ) values (
    user_id, 'patient', registration->>'fullName', registration->>'phone',
    nullif(registration->>'email', ''), (registration->>'dateOfBirth')::date,
    registration->>'gender',
    coalesce(nullif(registration->>'preferredLanguage', ''), 'en'), 'active'
  );

  insert into public.patients (
    profile_id, auth_user_id, full_name, primary_phone, email, date_of_birth, gender,
    preferred_language, status, city,
    emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
    blood_type, care_preferences
  ) values (
    user_id, user_id,
    registration->>'fullName',
    registration->>'phone',
    nullif(registration->>'email', ''),
    (registration->>'dateOfBirth')::date,
    registration->>'gender',
    coalesce(nullif(registration->>'preferredLanguage', ''), 'en'),
    'active',
    registration->>'addressCity',
    registration->'emergencyContact'->>'name',
    registration->'emergencyContact'->>'relationship',
    registration->'emergencyContact'->>'phone_number',
    medical_profile->>'blood_type',
    jsonb_build_object(
      'noKnownAllergies', coalesce((medical_profile->>'no_known_allergies')::boolean, false),
      'allergies', coalesce(medical_profile->>'allergies', ''),
      'existingMedicalConditions', coalesce(medical_profile->>'existing_medical_conditions', ''),
      'currentMedications', coalesce(medical_profile->>'current_medications', '')
    )
  ) returning id into patient_id;

  insert into public.consents (patient_id, granted_by_profile_id, consent_type, version, status)
  values
    (patient_id, user_id, 'care', 'registration-v2', 'granted'),
    (patient_id, user_id, 'data_processing', 'registration-v2', 'granted');

  return patient_id;
end;
$function$

```

### current_profile_role()

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres,authenticated=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.current_profile_role()
 RETURNS profile_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select role from public.profiles where id = auth.uid() and status = 'active' limit 1
$function$

```

### enforce_appointment_pricing()

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.enforce_appointment_pricing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  provider public.providers%rowtype;
  slot public.provider_availability%rowtype;
begin
  if tg_op = 'UPDATE' then
    -- Preserve the booked price snapshot even if the provider later changes rates.
    -- Changing its pricing/slot identity requires a new booking, not a cheap-price swap.
    if new.fee_amount is distinct from old.fee_amount
      or new.currency is distinct from old.currency
      or new.provider_id is distinct from old.provider_id
      or new.appointment_type is distinct from old.appointment_type
      or new.provider_availability_id is distinct from old.provider_availability_id
      or new.scheduled_start is distinct from old.scheduled_start
      or new.scheduled_end is distinct from old.scheduled_end then
      raise exception 'Appointment price and booking identity are immutable; create a new booking'
        using errcode='23514';
    end if;
    return new;
  end if;

  -- Lock the authoritative source against concurrent fee changes until commit.
  select * into provider from public.providers where id=new.provider_id for share;
  if not found or provider.provider_type <> 'doctor'
    or provider.verification_status <> 'verified'
    or provider.consultation_fee_mmk is null then
    raise exception 'No authoritative appointment price is configured' using errcode='23514';
  end if;
  select * into slot from public.provider_availability where id=new.provider_availability_id for update;
  if not found or slot.provider_id is distinct from new.provider_id
    or slot.service_type is distinct from new.appointment_type
    or slot.start_at is distinct from new.scheduled_start
    or slot.end_at is distinct from new.scheduled_end then
    raise exception 'Appointment does not match its provider availability' using errcode='23514';
  end if;
  if slot.status <> 'available' then
    raise exception 'Selected appointment time is no longer available' using errcode='23P01';
  end if;
  new.fee_amount := provider.consultation_fee_mmk;
  new.currency := 'MMK';
  return new;
end;
$function$

```

### is_appointment_provider(target_appointment_id uuid)

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres,authenticated=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.is_appointment_provider(target_appointment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.clinical_identity_is_current()
    and public.current_profile_role() in ('doctor','nurse','caregiver')
    and exists (select 1 from public.appointments a join public.providers p on p.id=a.provider_id
      where a.id=target_appointment_id and p.profile_id=auth.uid() and p.verification_status='verified')
$function$

```

### is_main_admin()

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres,authenticated=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.is_main_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(public.current_profile_role() = 'main_admin', false)
$function$

```

### mark_booked_provider_availability()

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.mark_booked_provider_availability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.provider_availability
  set status = 'booked'
  where id = new.provider_availability_id
    and status = 'available';

  if not found then
    raise exception 'Selected appointment time is no longer available'
      using errcode = '23P01';
  end if;

  return new;
end;
$function$

```

### mark_notification_read(target_notification_id uuid)

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres,authenticated=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.mark_notification_read(target_notification_id uuid)
 RETURNS notifications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result public.notifications;
begin
  if auth.uid() is null then
    raise exception 'Notification unavailable' using errcode='42501';
  end if;
  update public.notifications n
  set read_at=coalesce(n.read_at,statement_timestamp()),status='read'
  where n.id=target_notification_id and n.recipient_profile_id=auth.uid()
  returning n.* into result;
  if not found then
    raise exception 'Notification unavailable' using errcode='42501';
  end if;
  return result;
end;
$function$

```

### normalize_myanmar_phone(value text)

Security definer: false. Settings: `["search_path=\"\""]`. ACL: `default; PUBLIC EXECUTE unless separately restricted`.

```sql
CREATE OR REPLACE FUNCTION public.normalize_myanmar_phone(value text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare compact text;
begin
  compact := regexp_replace(btrim(value), '[\s-]', '', 'g');
  if compact ~ '^\+959[0-9]{7,9}$' then return compact;
  elsif compact ~ '^00959[0-9]{7,9}$' then return '+'||substr(compact,3);
  elsif compact ~ '^959[0-9]{7,9}$' then return '+'||compact;
  elsif compact ~ '^09[0-9]{7,9}$' then return '+95'||substr(compact,2);
  else raise exception 'Invalid Myanmar phone number'; end if;
end $function$

```

### normalize_patient_phones()

Security definer: false. Settings: `["search_path=\"\""]`. ACL: `default; PUBLIC EXECUTE unless separately restricted`.

```sql
CREATE OR REPLACE FUNCTION public.normalize_patient_phones()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin if new.primary_phone is not null then new.primary_phone=public.normalize_myanmar_phone(new.primary_phone); end if; if new.emergency_contact_phone is not null then new.emergency_contact_phone=public.normalize_myanmar_phone(new.emergency_contact_phone); end if; return new; end $function$

```

### normalize_profile_phone()

Security definer: false. Settings: `["search_path=\"\""]`. ACL: `default; PUBLIC EXECUTE unless separately restricted`.

```sql
CREATE OR REPLACE FUNCTION public.normalize_profile_phone()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin if new.phone is not null then new.phone=public.normalize_myanmar_phone(new.phone); end if; return new; end $function$

```

### protect_patient_auth_fields()

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `default; PUBLIC EXECUTE unless separately restricted`.

```sql
CREATE OR REPLACE FUNCTION public.protect_patient_auth_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is not null and not public.is_main_admin() and (
    new.auth_user_id is distinct from old.auth_user_id
    or new.profile_id is distinct from old.profile_id
    or new.primary_phone is distinct from old.primary_phone
    or new.status is distinct from old.status
  ) then
    raise exception 'Patient authentication fields cannot be changed';
  end if;
  return new;
end
$function$

```

### protect_security_managed_fields()

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `default; PUBLIC EXECUTE unless separately restricted`.

```sql
CREATE OR REPLACE FUNCTION public.protect_security_managed_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is not null and not public.is_main_admin() then
    if tg_table_name = 'profiles' and (new.role is distinct from old.role or new.status is distinct from old.status) then
      raise exception 'Profile role and status are administratively managed' using errcode='42501';
    elsif tg_table_name = 'providers' and (new.profile_id is distinct from old.profile_id or new.provider_type is distinct from old.provider_type or new.verification_status is distinct from old.verification_status or new.verified_at is distinct from old.verified_at) then
      raise exception 'Provider identity and verification are administratively managed' using errcode='42501';
    end if;
  end if;
  return new;
end $function$

```

### record_medication_event_status(target_event_id uuid, new_status medication_event_status)

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres,authenticated=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.record_medication_event_status(target_event_id uuid, new_status medication_event_status)
 RETURNS medication_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result public.medication_events;
begin
  if auth.uid() is null or new_status is null or new_status not in ('taken', 'skipped') then
    raise exception 'Only authenticated taken/skipped confirmations are allowed' using errcode = '42501';
  end if;
  update public.medication_events e
  set status = new_status, confirmed_by_profile_id = auth.uid(), confirmed_at = statement_timestamp()
  where e.id = target_event_id and exists (
    select 1 from public.patients p
    join public.patient_medications m on m.patient_id = p.id
    join public.medication_schedules s on s.patient_medication_id = m.id
    where p.id = e.patient_id and p.profile_id = auth.uid() and s.id = e.schedule_id
  ) returning e.* into result;
  if not found then
    raise exception 'Medication event unavailable' using errcode = '42501';
  end if;
  return result;
end;
$function$

```

### reject_immutable_change()

Security definer: false. Settings: `["search_path=\"\""]`. ACL: `default; PUBLIC EXECUTE unless separately restricted`.

```sql
CREATE OR REPLACE FUNCTION public.reject_immutable_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception '% records are append-only', tg_table_name using errcode = '55000';
end $function$

```

### save_ai_overview(p_patient_id uuid, p_token uuid, p_summary jsonb)

Security definer: true. Settings: `["search_path=\"\""]`. ACL: `{postgres=X/postgres,service_role=X/postgres}`.

```sql
CREATE OR REPLACE FUNCTION public.save_ai_overview(p_patient_id uuid, p_token uuid, p_summary jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare new_id uuid := gen_random_uuid(); start_at timestamptz; end_at timestamptz;
begin
  perform 1 from public.ai_overview_leases where patient_id=p_patient_id and token=p_token
    and lease_until > clock_timestamp() for update;
  if not found then raise exception 'Overview lease unavailable' using errcode='42501'; end if;
  start_at := (p_summary->>'period_start')::timestamptz;
  end_at := (p_summary->>'period_end')::timestamptz;
  set constraints public.ai_summaries_superseded_patient_fk deferred;
  update public.ai_health_summaries set superseded_by_id=new_id
    where patient_id=p_patient_id and summary_type='daily' and period_start=start_at and period_end=end_at and superseded_by_id is null;
  insert into public.ai_health_summaries(id,patient_id,period_start,period_end,summary_type,overall_status,summary_text,
    things_to_watch,recommended_actions,urgency_level,source_snapshot,source_data_hash,model_provider,model_name,model_version,prompt_version,generated_at,expires_at)
  values(new_id,p_patient_id,start_at,end_at,'daily',p_summary->>'overall_status',p_summary->>'summary_text',
    p_summary->'things_to_watch',p_summary->'recommended_actions',(p_summary->>'urgency_level')::public.care_urgency,
    p_summary->'source_snapshot',p_summary->>'source_data_hash',p_summary->>'model_provider',p_summary->>'model_name',
    p_summary->>'model_version',p_summary->>'prompt_version',(p_summary->>'generated_at')::timestamptz,(p_summary->>'expires_at')::timestamptz);
  set constraints public.ai_summaries_superseded_patient_fk immediate;
  update public.ai_overview_leases set lease_until=clock_timestamp(),retry_after=clock_timestamp()+interval '2 minutes'
    where patient_id=p_patient_id and token=p_token;
  return new_id;
end;
$function$

```

### set_updated_at()

Security definer: false. Settings: `["search_path=\"\""]`. ACL: `default; PUBLIC EXECUTE unless separately restricted`.

```sql
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin new.updated_at=statement_timestamp(); return new; end $function$

```

## Storage policies

```json
{
  "schemaname": "storage",
  "tablename": "objects",
  "policyname": "clinical_documents_file_anon_guard",
  "permissive": "RESTRICTIVE",
  "roles": [
    "anon"
  ],
  "cmd": "SELECT",
  "qual": "(bucket_id <> 'clinical-documents'::text)",
  "with_check": null
}
```
```json
{
  "schemaname": "storage",
  "tablename": "objects",
  "policyname": "clinical_documents_file_delete_guard",
  "permissive": "RESTRICTIVE",
  "roles": [
    "anon",
    "authenticated"
  ],
  "cmd": "DELETE",
  "qual": "(bucket_id <> 'clinical-documents'::text)",
  "with_check": null
}
```
```json
{
  "schemaname": "storage",
  "tablename": "objects",
  "policyname": "clinical_documents_file_insert_guard",
  "permissive": "RESTRICTIVE",
  "roles": [
    "anon",
    "authenticated"
  ],
  "cmd": "INSERT",
  "qual": null,
  "with_check": "(bucket_id <> 'clinical-documents'::text)"
}
```
```json
{
  "schemaname": "storage",
  "tablename": "objects",
  "policyname": "clinical_documents_file_read",
  "permissive": "PERMISSIVE",
  "roles": [
    "authenticated"
  ],
  "cmd": "SELECT",
  "qual": "((bucket_id = 'clinical-documents'::text) AND (EXISTS ( SELECT 1\n   FROM clinical_documents d\n  WHERE (d.storage_path = objects.name))))",
  "with_check": null
}
```
```json
{
  "schemaname": "storage",
  "tablename": "objects",
  "policyname": "clinical_documents_file_read_guard",
  "permissive": "RESTRICTIVE",
  "roles": [
    "authenticated"
  ],
  "cmd": "SELECT",
  "qual": "((bucket_id <> 'clinical-documents'::text) OR (EXISTS ( SELECT 1\n   FROM clinical_documents d\n  WHERE (d.storage_path = objects.name))))",
  "with_check": null
}
```
```json
{
  "schemaname": "storage",
  "tablename": "objects",
  "policyname": "clinical_documents_file_update_guard",
  "permissive": "RESTRICTIVE",
  "roles": [
    "anon",
    "authenticated"
  ],
  "cmd": "UPDATE",
  "qual": "(bucket_id <> 'clinical-documents'::text)",
  "with_check": "(bucket_id <> 'clinical-documents'::text)"
}
```

## Explicit privilege statements in migrations

These source excerpts distinguish project grants from harness defaults. Statements inside functions/DO blocks may be conditional; inspect the full function above for context.

### 20260820010900_ai_security.sql

```sql
revoke all on function public.current_profile_role() from public;
revoke all on function public.is_main_admin() from public;
revoke all on function public.can_access_patient(uuid,text) from public;
revoke all on function public.is_appointment_provider(uuid) from public;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.is_main_admin() to authenticated;
grant execute on function public.can_access_patient(uuid,text) to authenticated;
grant execute on function public.is_appointment_provider(uuid) to authenticated;
```

### 20260820011000_patient_registration.sql

```sql
revoke all on function public.create_patient_registration(jsonb) from public;
grant execute on function public.create_patient_registration(jsonb) to service_role;
```

### 20260820011100_simplify_patient_auth.sql

```sql
revoke all on function public.create_patient_registration(jsonb) from public;
grant execute on function public.create_patient_registration(jsonb) to service_role;
```

### 20260821090000_patient_registration_service_role_lookup.sql

```sql
grant select (id, primary_phone) on table public.patients to service_role;
revoke all on function public.create_patient_registration(jsonb) from public;
grant execute on function public.create_patient_registration(jsonb) to service_role;
```

### 20260821091000_patient_authenticated_self_read.sql

```sql
grant select (
  id,
  auth_user_id,
  full_name,
  primary_phone,
  preferred_language,
  status
) on table public.patients to authenticated;
```

### 20260821100000_patient_doctor_directory.sql

```sql
grant select (
  id, provider_type, display_name, qualification, verification_status,
  years_experience, bio, languages, service_area, home_visit_enabled,
  teleconsult_enabled, consultation_fee_mmk, rating_average
) on table public.providers to authenticated;
grant select (provider_id, specialty_id, is_primary) on table public.provider_specialties to authenticated;
grant select (id, name) on table public.specialties to authenticated;
grant select (id, provider_id, service_type, start_at, end_at, status)
  on table public.provider_availability to authenticated;
```

### 20260821101000_patient_availability_read_access.sql

```sql
grant select (id, provider_id, service_type, start_at, end_at, status)
  on table public.provider_availability to authenticated;
revoke insert, update, delete
  on table public.provider_availability from authenticated;
```

### 20260821102000_patient_appointment_booking.sql

```sql
revoke all on table public.appointments from anon, authenticated;
grant select (
  id, patient_id, provider_id, provider_availability_id, appointment_type,
  consultation_channel, scheduled_start, scheduled_end, status,
  reason_symptoms, fee_amount, currency, booking_code, created_at
) on table public.appointments to authenticated;
grant insert (
  patient_id, provider_id, provider_availability_id, booked_by_profile_id,
  appointment_type, consultation_channel, scheduled_start, scheduled_end,
  reason_symptoms, status, fee_amount, currency, booking_code
) on table public.appointments to authenticated;
revoke all on function public.mark_booked_provider_availability() from public;
```

### 20260821103000_patient_profile_self_service.sql

```sql
revoke select on table public.patients from authenticated;
grant select (
  id, auth_user_id, full_name, date_of_birth, gender, primary_phone,
  preferred_language, address_line, township, city,
  emergency_contact_name, emergency_contact_relationship,
  emergency_contact_phone, blood_type, care_preferences, status
) on table public.patients to authenticated;
grant before allowing safe profile fields.
revoke update on table public.patients from authenticated;
grant update (
  full_name, date_of_birth, gender, preferred_language,
  address_line, township, city,
  emergency_contact_name, emergency_contact_relationship,
  emergency_contact_phone, blood_type, care_preferences
) on table public.patients to authenticated;
```

### 20260821104000_patient_medication_read_model.sql

```sql
revoke all on table public.patient_medications from anon, authenticated;
grant select (
  id, patient_id, medication_name, dose, frequency, instructions,
  start_date, end_date, status
) on table public.patient_medications to authenticated;
revoke all on table public.medication_schedules from anon, authenticated;
grant select (
  id, patient_medication_id, time_of_day, days_of_week,
  timezone, valid_from, valid_until
) on table public.medication_schedules to authenticated;
```

### 20260928090000_patient_profile_identity_repair.sql

```sql
revoke all on function public.create_patient_registration(jsonb) from public, anon, authenticated;
grant execute on function public.create_patient_registration(jsonb) to service_role;
grant select (profile_id) on table public.patients to authenticated;
grant select (id, role, status) on table public.profiles to authenticated;
```

### 20260929090000_patient_health_profiles.sql

```sql
grant 'clinical' access to coordinators/clinic admins
-- merely because of their role. No role-wide patient-data access is added.
create policy patient_health_profiles_read_authorized
on public.patient_health_profiles for select to authenticated
using (public.can_access_patient(patient_id, 'clinical'));
revoke all on table public.patient_health_profiles from public, anon, authenticated;
grant select on table public.patient_health_profiles to authenticated;
grant select, insert, update on table public.patient_health_profiles to service_role;
```

### 20260929100000_vital_readings_dashboard_metadata.sql

```sql
grant select on table public.vital_readings to authenticated;
grant insert (
  patient_id, encounter_id, recorded_by_profile_id, source,
  systolic_bp, diastolic_bp, heart_rate, spo2, temperature_c, glucose_mg_dl,
  weight_kg, recorded_at, notes, measurement_context
) on table public.vital_readings to authenticated;
```

### 20260929110000_patient_conditions_allergies_metadata.sql

```sql
grant select on table public.patient_conditions, public.patient_allergies to authenticated;
grant insert (
  patient_id, condition_name, status, diagnosed_at, recorded_by, notes,
  code_system, condition_code, severity, onset_date, resolved_date
) on table public.patient_conditions to authenticated;
grant insert (
  patient_id, allergen, reaction, severity, status, recorded_by,
  allergen_type, onset_date, verified_by_profile_id, verified_at
) on table public.patient_allergies to authenticated;
```

### 20260929120000_laboratory_data.sql

```sql
revoke all on table public.lab_orders, public.lab_results from public, anon, authenticated;
grant select on table public.lab_orders, public.lab_results to authenticated;
grant select, insert, update on table public.lab_orders, public.lab_results to service_role;
```

### 20260929130000_clinical_documents.sql

```sql
revoke all on public.clinical_documents from public, anon, authenticated;
grant select on public.clinical_documents to authenticated;
grant select, insert, update, delete on public.clinical_documents to service_role;
```

### 20260929140000_medication_schema_improvements.sql

```sql
grant select (prescribing_provider_id, reason_for_medication, discontinued_at, discontinued_reason)
  on public.patient_medications to authenticated;
grant select on public.medication_events to authenticated;
revoke all on function public.record_medication_event_status(uuid, public.medication_event_status) from public, anon;
grant execute on function public.record_medication_event_status(uuid, public.medication_event_status) to authenticated;
```

### 20260929160000_ai_health_summary_model.sql

```sql
revoke all on public.ai_health_summaries from public, anon, authenticated;
grant select on public.ai_health_summaries to authenticated;
revoke delete, truncate, references, trigger on public.ai_health_summaries from service_role;
grant select, insert, update on public.ai_health_summaries to service_role;
```

### 20260929170000_ai_overview_cache.sql

```sql
revoke all on public.ai_overview_request_limits from public, anon, authenticated;
grant select, insert, update on public.ai_overview_request_limits to service_role;
revoke all on function public.consume_ai_overview_request(uuid) from public,anon,authenticated;
grant execute on function public.consume_ai_overview_request(uuid) to service_role;
revoke all on public.ai_overview_leases from public, anon, authenticated;
grant select, insert, update on public.ai_overview_leases to service_role;
revoke all on function public.claim_ai_overview(uuid,uuid), public.save_ai_overview(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_ai_overview(uuid,uuid), public.save_ai_overview(uuid,uuid,jsonb) to service_role;
```

### 20261001100000_follow_up_patient_integrity.sql

```sql
revoke all on function public.check_follow_up_parent_chain() from public, anon, authenticated;
revoke all on function public.can_manage_follow_up(uuid,uuid) from public, anon;
grant execute on function public.can_manage_follow_up(uuid,uuid) to authenticated;
```

### 20261001110000_suspended_provider_clinical_access.sql

```sql
revoke all on function public.clinical_identity_is_current() from public, anon;
grant execute on function public.clinical_identity_is_current() to authenticated;
revoke all on function public.can_access_patient(uuid,text) from public, anon;
revoke all on function public.is_appointment_provider(uuid) from public, anon;
grant execute on function public.can_access_patient(uuid,text) to authenticated;
grant execute on function public.is_appointment_provider(uuid) to authenticated;
grant no access themselves. BOTH old-row USING and new-row CHECK apply.
-- These legacy policies did not check a role at all. Keep their relationships,
-- but prevent a non-clinical profile with an inconsistent staff record using them.
alter policy encounters_provider_manage on public.care_encounters
  using (public.is_main_admin() or (
    public.current_profile_role() in ('doctor','nurse','caregiver') and exists (
      select 1 from public.providers p where p.id=care_encounters.provider_id and p.profile_id=auth.uid())))
  with check (public.is_main_admin() or (
    public.current_profile_role() in ('doctor','nurse','caregiver') and exists (
      select 1 from public.providers p where p.id=care_encounters.provider_id and p.profile_id=auth.uid())
    and public.is_appointment_provider(care_encounters.appointment_id)));
```

### 20261001120000_appointment_pricing_integrity.sql

```sql
revoke all on function public.enforce_appointment_pricing() from public, anon, authenticated;
```

### 20261002090000_encounter_appointment_integrity.sql

```sql
revoke all on function public.can_manage_care_encounter(uuid,uuid,uuid) from public,anon;
grant execute on function public.can_manage_care_encounter(uuid,uuid,uuid) to authenticated;
```

### 20261002100000_payment_appointment_integrity.sql

```sql
revoke all on function public.can_create_payment_for_appointment(uuid,uuid) from public,anon;
grant execute on function public.can_create_payment_for_appointment(uuid,uuid) to authenticated;
```

### 20261002110000_notification_mark_read_integrity.sql

```sql
revoke update on public.notifications from public,anon,authenticated;
revoke update (%s) on public.notifications from public, anon, authenticated',columns_sql);
revoke all on function public.mark_notification_read(uuid) from public,anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;
```

### 20261002140000_medication_event_patient_integrity.sql

```sql
revoke all on function public.check_medication_event_patient_chain() from public, anon, authenticated;
```

### 20261002160000_medication_prescription_patient_integrity.sql

```sql
revoke all on function public.check_medication_prescription_patient_chain() from public, anon, authenticated;
```

### 20261002180000_care_assignment_appointment_patient_integrity.sql

```sql
revoke all on function public.check_care_assignment_patient_chain() from public, anon, authenticated;
```

### 20261002190000_complaint_appointment_patient_integrity.sql

```sql
revoke all on function public.check_complaint_appointment_patient_chain() from public, anon, authenticated;
```

## Source reference index

Static text references, including dynamic query source lists. Presence is evidence of a reference, not proof of a reachable production writer. Tests are listed separately. See primary handoff classifications.

### ai_health_summaries references

Runtime: `src/services/repositories/patientDashboardRepository.js:153`; `supabase/functions/ai-health-overview/index.ts:39,42,47`

Tests: `src/lib/aiHealthOverview.integration.test.js:115,117,154,195,209,214`; `src/lib/aiHealthSummaryModel.integration.test.js:75,80,89,100,113,115,129,135,139,142,144,149,154,155,157,161,164,166,167,172,173,180,181,184,185,188,192,195,198,201,205,208,212,214,221,224`; `src/services/repositories/patientDashboardRepository.test.js:43,138,149`

### ai_interactions references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: None found.

### ai_overview_leases references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: `src/lib/aiHealthOverview.integration.test.js:150,199`

### ai_overview_request_limits references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: `src/lib/aiHealthOverview.integration.test.js:221`

### appointments references

Runtime: `src/app/AuthLayout.jsx:10`; `src/App.jsx:14,15,53,54`; `src/components/BottomNav.jsx:7`; `src/components/GlobalSearch.jsx:9,25,73,84,115,149`; `src/data/navigation.js:4,17`; `src/data/presentationFixtures.js:35`; `src/features/appointments/AppointmentsPage.jsx:22,35,40,43,44,45,46,49,79,80,81,105,106,142,163,166`; `src/features/appointments/consultationDemo.js:5`; `src/features/appointments/WaitingRoomGate.jsx:47,50`; `src/features/dashboard/DashboardPage.jsx:62,109,113,138,159`; `src/features/doctors/DoctorsPage.jsx:55,126`; `src/features/landing/HowItWorksPage.jsx:20`; `src/features/landing/LandingPage.jsx:24`; `src/features/localization/translations.js:4,9,15`; `src/features/secondary/secondaryFixtures.js:10`; `src/features/subscription/SubscriptionPage.jsx:6`; `src/services/repositories/fixtureRepository.js:4,9,10,20,25,46,47,48,50,53,57,65,73,75,77,92,94`; `src/services/repositories/patientDashboardRepository.js:131`; `src/services/repositories/supabaseRepository.js:63,95,96,101`; `supabase/functions/_shared/health-context.ts:9,14,22,39,40,41`

Tests: `src/features/auth/AuthContext.test.jsx:43,45,51,59,61,67,103,105`; `src/features/auth/RegisterPage.test.jsx:53`; `src/features/dashboard/DashboardPage.test.jsx:40`; `src/lib/aiHealthOverview.integration.test.js:63,84`; `src/lib/aiHealthSummaryModel.integration.test.js:62`; `src/lib/appointmentCareRequestIntegrity.integration.test.js:41,61,66,70,78,86,96,110,122,129,131,140,141,152,161,171,183,210,213,216,217,222,253,258,260,262,268,269,275,276,304,315,326,349,352,357,361,362,366,372,373,376,378,387,389,390,401,405`; `src/lib/appointmentPricingIntegrity.integration.test.js:52,71,77,84,85,98,112,117,125,151`; `src/lib/careAssignmentAppointmentIntegrity.integration.test.js:41,70,74,78,89,92,101,111,125,149,183,185,217,218,219,220,222,227,228,230,237,240,248,253,260,267,270,274,296,297,298,311,319,343,354,376,382,384,386,392,395,398,406,409`; `src/lib/clinicalDocuments.integration.test.js:52`; `src/lib/complaintAppointmentIntegrity.integration.test.js:41,64,65,69,75,80,90,100,114,137,156,166,169,175,177,197,204,206,226,233,240,247,254,270,275,281,282,289,296,301,306,311,325,337,346,366,372,374,377,383,386,388,396,400`; `src/lib/encounterAppointmentIntegrity.integration.test.js:52,78,93,115,126`; `src/lib/followUpPatientIntegrity.integration.test.js:52,189,199,227`; `src/lib/laboratoryData.integration.test.js:52`; `src/lib/medicationEventIntegrity.integration.test.js:52`; `src/lib/medicationPrescriptionIntegrity.integration.test.js:55`; `src/lib/medicationSchema.integration.test.js:62`; `src/lib/monitoringAlerts.integration.test.js:62`; `src/lib/monitoringAlertVitalIntegrity.integration.test.js:56`; `src/lib/notificationMarkReadIntegrity.integration.test.js:52`; `src/lib/patientAppointmentBookingMigration.test.js:22,26,27`; `src/lib/patientHealthProfiles.integration.test.js:70`; `src/lib/patientProfileIdentity.integration.test.js:210`; `src/lib/paymentAppointmentIntegrity.integration.test.js:52,79,124,133,159`; `src/lib/phase4DatabaseSchema.test.js:13`; `src/lib/prescriptionPatientIntegrity.integration.test.js:52`; `src/lib/simplifiedPatientAuthMigration.test.js:24,25,26`; `src/lib/subscriptionPaymentIntegrity.integration.test.js:52`; `src/lib/suspendedProviderClinicalAccess.integration.test.js:52`; `src/lib/vitalEncounterIntegrity.integration.test.js:52,90`; `src/lib/vitalReadingsDashboard.integration.test.js:41`; `src/services/bookingService.test.js:23`; `src/services/repositories/appointmentRepositoryContract.test.js:6,11`; `src/services/repositories/patientDashboardRepository.test.js:43,112`; `src/services/repositories/repositories.test.js:15,21,40,41,48`

### audit_logs references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: None found.

### care_assignments references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: `src/lib/aiHealthOverview.integration.test.js:70`; `src/lib/aiHealthSummaryModel.integration.test.js:69`; `src/lib/appointmentCareRequestIntegrity.integration.test.js:348`; `src/lib/careAssignmentAppointmentIntegrity.integration.test.js:86,88,133,150,160,194,247,273,276,283,380,386,391,395,396,408,420`; `src/lib/clinicalDocuments.integration.test.js:59`; `src/lib/complaintAppointmentIntegrity.integration.test.js:333,336`; `src/lib/followUpPatientIntegrity.integration.test.js:68`; `src/lib/laboratoryData.integration.test.js:59`; `src/lib/medicationSchema.integration.test.js:69`; `src/lib/monitoringAlerts.integration.test.js:69`; `src/lib/patientConditionsAllergies.integration.test.js:49`; `src/lib/patientHealthProfiles.integration.test.js:178`; `src/lib/suspendedProviderClinicalAccess.integration.test.js:68`

### care_coordinators references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: `src/lib/careAssignmentAppointmentIntegrity.integration.test.js:56`; `src/lib/followUpPatientIntegrity.integration.test.js:64`; `src/lib/monitoringAlerts.integration.test.js:132`; `src/lib/patientHealthProfiles.integration.test.js:75`; `src/lib/suspendedProviderClinicalAccess.integration.test.js:64,225`

### care_encounters references

Runtime: `src/services/repositories/patientDashboardRepository.js:140`; `supabase/functions/_shared/health-context.ts:21`

Tests: `src/lib/aiHealthOverview.integration.test.js:67,73,83`; `src/lib/aiHealthSummaryModel.integration.test.js:66,72,109`; `src/lib/appointmentCareRequestIntegrity.integration.test.js:76,333,336,343`; `src/lib/appointmentPricingIntegrity.integration.test.js:56,164`; `src/lib/careAssignmentAppointmentIntegrity.integration.test.js:91,328,337,361`; `src/lib/clinicalDocuments.integration.test.js:56,62,98,156`; `src/lib/complaintAppointmentIntegrity.integration.test.js:74,316,353`; `src/lib/encounterAppointmentIntegrity.integration.test.js:56,73,79,87,97,99,100,106,118,122,158,160,163`; `src/lib/followUpPatientIntegrity.integration.test.js:56,189,194,202,203,204,227`; `src/lib/laboratoryData.integration.test.js:56,62,91,189`; `src/lib/medicationEventIntegrity.integration.test.js:56`; `src/lib/medicationPrescriptionIntegrity.integration.test.js:59`; `src/lib/medicationSchema.integration.test.js:66,72,97`; `src/lib/monitoringAlerts.integration.test.js:66,72,94`; `src/lib/monitoringAlertVitalIntegrity.integration.test.js:60`; `src/lib/notificationMarkReadIntegrity.integration.test.js:56`; `src/lib/paymentAppointmentIntegrity.integration.test.js:56,162,167`; `src/lib/prescriptionPatientIntegrity.integration.test.js:56,144`; `src/lib/subscriptionPaymentIntegrity.integration.test.js:57`; `src/lib/suspendedProviderClinicalAccess.integration.test.js:56,88,128,132,177,192,193,243,247,250,254`; `src/lib/vitalEncounterIntegrity.integration.test.js:56,91,159,161,167`; `src/lib/vitalReadingsDashboard.integration.test.js:44`; `src/services/repositories/patientDashboardRepository.test.js:43,126`

### care_packages references

Runtime: `src/services/repositories/patientDashboardRepository.js:112`

Tests: `src/lib/paymentAppointmentIntegrity.integration.test.js:82`; `src/lib/subscriptionPaymentIntegrity.integration.test.js:59`

### care_requests references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: `src/lib/aiHealthOverview.integration.test.js:69`; `src/lib/aiHealthSummaryModel.integration.test.js:68`; `src/lib/appointmentCareRequestIntegrity.integration.test.js:47,158,282,291,293,300,379`; `src/lib/careAssignmentAppointmentIntegrity.integration.test.js:63,94,290,304,306,318,397`; `src/lib/clinicalDocuments.integration.test.js:58`; `src/lib/complaintAppointmentIntegrity.integration.test.js:322,331`; `src/lib/followUpPatientIntegrity.integration.test.js:67`; `src/lib/laboratoryData.integration.test.js:58`; `src/lib/medicationSchema.integration.test.js:68`; `src/lib/monitoringAlerts.integration.test.js:68`; `src/lib/patientConditionsAllergies.integration.test.js:48`; `src/lib/patientHealthProfiles.integration.test.js:177`; `src/lib/suspendedProviderClinicalAccess.integration.test.js:67`

### clinic_staff references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: `src/lib/patientHealthProfiles.integration.test.js:77,78`; `src/lib/suspendedProviderClinicalAccess.integration.test.js:94,95,157,163`

### clinical_documents references

Runtime: `src/services/repositories/patientDashboardRepository.js:140`

Tests: `src/lib/clinicalDocuments.integration.test.js:79,93,99,104,110,118,125,140,142,143,144,149,152,168,175,179`; `src/services/repositories/patientDashboardRepository.test.js:43,126`

### clinical_notes references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: None found.

### complaints references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: `src/lib/complaintAppointmentIntegrity.integration.test.js:77,78,82,90,100,121,137,138,147,148,158,210,212,216,220,254,260,266,267,279,287,304,370,377,382,386,387,398,411,413`

### consents references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: `src/lib/patientProfileIdentity.integration.test.js:122,128,129,130,287,289,290`; `src/lib/suspendedProviderClinicalAccess.integration.test.js:128`

### family_authorizations references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: `src/lib/aiHealthOverview.integration.test.js:71`; `src/lib/aiHealthSummaryModel.integration.test.js:70`; `src/lib/clinicalDocuments.integration.test.js:60,116`; `src/lib/complaintAppointmentIntegrity.integration.test.js:57`; `src/lib/databaseMigration.test.js:15`; `src/lib/followUpPatientIntegrity.integration.test.js:69`; `src/lib/laboratoryData.integration.test.js:60`; `src/lib/medicationSchema.integration.test.js:70`; `src/lib/monitoringAlerts.integration.test.js:70,118,121`; `src/lib/patientHealthProfiles.integration.test.js:79,210`; `src/lib/paymentAppointmentIntegrity.integration.test.js:86,140`; `src/lib/subscriptionPaymentIntegrity.integration.test.js:67,70`; `src/lib/suspendedProviderClinicalAccess.integration.test.js:69`

### feedback references

Runtime: `src/features/appointments/AppointmentsPage.jsx:151,164`; `src/features/health/HealthPages.jsx:38`; `src/features/landing/AboutPage.jsx:7`

Tests: None found.

### follow_ups references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: `src/lib/appointmentPricingIntegrity.integration.test.js:160`; `src/lib/encounterAppointmentIntegrity.integration.test.js:96,99,150`; `src/lib/followUpPatientIntegrity.integration.test.js:72,80,86,99,112,113,117,123,124,125,130,135,143,144,146,159,160,165,166,170,171,172,184,225,228,229,233,234`; `src/lib/suspendedProviderClinicalAccess.integration.test.js:72,85,109,110,111,121,128,133,229`

### lab_orders references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: `src/lib/aiHealthOverview.integration.test.js:81`; `src/lib/laboratoryData.integration.test.js:68,84,92,97,106,115,123,135,148,149,163,167,172,180,191,197,201,206,210,211,212,213,214,224,227,228,237,238,241`

### lab_results references

Runtime: `src/services/repositories/patientDashboardRepository.js:147`; `src/services/repositories/supabaseRepository.js:4`; `supabase/functions/_shared/health-context.ts:20`

Tests: `src/lib/aiHealthOverview.integration.test.js:82,83`; `src/lib/laboratoryData.integration.test.js:70,85,92,98,101,109,115,123,129,136,141,147,148,149,155,157,159,163,165,166,168,176,184,202,215,216,217,218,219,220,221,222,227,237,238,241`; `src/services/repositories/patientDashboardRepository.test.js:43`

### medical_history_items references

Runtime: `src/services/repositories/patientDashboardRepository.js:140`

Tests: `src/services/repositories/patientDashboardRepository.test.js:43`

### medication_events references

Runtime: `src/services/repositories/patientDashboardRepository.js:63`; `supabase/functions/_shared/health-context.ts:19`

Tests: `src/lib/aiHealthOverview.integration.test.js:80`; `src/lib/medicationEventIntegrity.integration.test.js:86,99,109,129,134,171,200,205,211,213,264,273,282,293`; `src/lib/medicationPrescriptionIntegrity.integration.test.js:105,115,127,161,288`; `src/lib/medicationSchema.integration.test.js:81,84,118,130,133,138,149,151,155,161,165,167,168,182`; `src/services/repositories/patientDashboardRepository.test.js:43`

### medication_schedules references

Runtime: `src/services/repositories/patientDashboardRepository.js:4,68,83,84`; `src/services/repositories/supabaseRepository.js:57,125`; `supabase/functions/_shared/health-context.ts:26,40`

Tests: `src/lib/aiHealthOverview.integration.test.js:79`; `src/lib/medicationEventIntegrity.integration.test.js:64,232,250`; `src/lib/medicationPrescriptionIntegrity.integration.test.js:92`; `src/lib/medicationSchema.integration.test.js:80,109,111,137,182`; `src/services/repositories/patientDashboardRepository.test.js:88`

### monitoring_alerts references

Runtime: `src/services/repositories/patientDashboardRepository.js:136`; `supabase/functions/_shared/health-context.ts:23`

Tests: `src/lib/aiHealthOverview.integration.test.js:177`; `src/lib/monitoringAlerts.integration.test.js:76,81,90,98,101,104,109,115,120,123,127,135,136,141,142,146,147,151,152,156,160,164,168,169,170,175,178,181,184`; `src/lib/monitoringAlertVitalIntegrity.integration.test.js:66,82,97,107,124,126,200,207,235,248,268,278,279,294,304`; `src/lib/vitalEncounterIntegrity.integration.test.js:227,234`; `src/services/repositories/patientDashboardRepository.test.js:43,122`

### notifications references

Runtime: `src/features/localization/translations.js:10,21`

Tests: `src/lib/monitoringAlerts.integration.test.js:80,82,89,92,106`; `src/lib/notificationMarkReadIntegrity.integration.test.js:69,74,76,77,78,81,86,92,95,98,105,108,111,122,123,129,132,133,136,137,140,144`; `src/services/repositories/patientDashboardRepository.test.js:119`

### package_services references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: None found.

### partner_clinics references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: `src/lib/patientHealthProfiles.integration.test.js:67`; `src/lib/suspendedProviderClinicalAccess.integration.test.js:93`

### patient_allergies references

Runtime: `src/services/repositories/patientDashboardRepository.js:92`; `supabase/functions/_shared/health-context.ts:17`

Tests: `src/lib/aiHealthOverview.integration.test.js:77`; `src/lib/patientConditionsAllergies.integration.test.js:57,62,64,73,77,104,113,123,131,133,136,149,156,161,163,176,189,190,191,192,193,199`; `src/lib/suspendedProviderClinicalAccess.integration.test.js:90,128`; `src/services/repositories/patientDashboardRepository.test.js:158,160`

### patient_conditions references

Runtime: `src/services/repositories/patientDashboardRepository.js:93`; `supabase/functions/_shared/health-context.ts:16`

Tests: `src/lib/aiHealthOverview.integration.test.js:76,121,138`; `src/lib/aiHealthSummaryModel.integration.test.js:79,81,107,126`; `src/lib/patientConditionsAllergies.integration.test.js:52,61,64,73,74,91,98,113,123,131,133,136,141,168,174,180,181,182,183,184,185,186,187,188`; `src/lib/suspendedProviderClinicalAccess.integration.test.js:89,120,128,188,201,206`; `src/services/repositories/patientDashboardRepository.test.js:158,160`

### patient_health_profiles references

Runtime: `src/services/repositories/patientDashboardRepository.js:91,162`

Tests: `src/lib/patientHealthProfiles.integration.test.js:31,85,94,96,102,106,110,114,118,120,132,136,140,144,152,166,218,220,222,226,228,233`; `src/services/repositories/patientDashboardRepository.test.js:43`

### patient_medications references

Runtime: `src/services/repositories/patientDashboardRepository.js:54`; `src/services/repositories/supabaseRepository.js:120`; `supabase/functions/_shared/health-context.ts:18`

Tests: `src/features/health/medicationBackendContract.test.js:13`; `src/lib/aiHealthOverview.integration.test.js:78`; `src/lib/medicationEventIntegrity.integration.test.js:59,243`; `src/lib/medicationPrescriptionIntegrity.integration.test.js:79,111,116,125,126,138,140,146,185,191,233,274,277,282,302,309,313,335,336`; `src/lib/medicationSchema.integration.test.js:79,83,85,93,106,112,138,171,173,178,181`; `src/lib/patientMedicationReadModelMigration.test.js:9,10`; `src/services/repositories/patientDashboardRepository.test.js:43,96,107`

### patients references

Runtime: `src/features/care-plan/carePlanPricing.js:22,39,57,103`; `src/features/landing/AboutPage.jsx:10`; `src/features/subscription/SubscriptionPage.jsx:7`; `src/services/authService.js:10`; `src/services/repositories/patientDashboardRepository.js:90,159`; `src/services/repositories/supabaseRepository.js:74,75,76`; `supabase/functions/ai-health-overview/index.ts:37`; `supabase/functions/patient-register/index.ts:134`

Tests: `src/features/auth/AuthContext.test.jsx:95`; `src/features/secondary/patientSettingsContract.test.js:11`; `src/lib/aiHealthOverview.integration.test.js:16,50,52,66,67,69,71,72,75,76,77,78,80,81,82,84,113,123,124,128,133,137,142,143,147,149,152,158,162,166,170,177,179,184,185,188,190,193,198,200,207,212,218,222,224`; `src/lib/aiHealthSummaryModel.integration.test.js:15,49,51,65,66,68,70,71,78,79,88,108,120,121,129,182,184,189`; `src/lib/appointmentCareRequestIntegrity.integration.test.js:41,43,48,64,69,73,78,86,96,109,116,121,129,166,167,173,174,181,191,196,199,206,228,234,240,241,256,260,269,270,282,292,294,295,323,332,334,335,336,357,363,387`; `src/lib/appointmentPricingIntegrity.integration.test.js:39,41,55,57,60,61,66,72,74,99,157,160`; `src/lib/careAssignmentAppointmentIntegrity.integration.test.js:41,43,64,73,77,81,92,101,111,123,149,193,201,225,290,298,305,307,308,310,312,313,324,329,330,337,345,351,366,376`; `src/lib/clinicalDocuments.integration.test.js:15,39,41,55,56,58,60,61,78,82,97,153,156`; `src/lib/complaintAppointmentIntegrity.integration.test.js:41,43,58,68,72,75,80,90,100,112,137,175,176,190,191,197,199,204,205,226,233,240,247,260,275,282,283,286,290,291,296,301,306,316,323,324,332,343,366,372,373,383,396,400`; `src/lib/databaseMigration.test.js:15,22,29`; `src/lib/encounterAppointmentIntegrity.integration.test.js:39,41,55,57,60,62,68,73,75,78,95,96,104,110,115,118,122,126,133,137,142,146,150,155,158,159`; `src/lib/followUpPatientIntegrity.integration.test.js:39,41,55,57,60,65,67,69,71,74,79,89,113,118,122,129,135,139,143,150,154,159,176,180,184,189,202,205,208,212,218,225,227`; `src/lib/laboratoryData.integration.test.js:15,39,41,55,56,58,60,61,69,73,90,99,106,109,116,117,123,134,159,168,189,191`; `src/lib/medicationEventIntegrity.integration.test.js:39,41,55,57,61,76,91,92,96,98,117,124,125,140,151,161,162,163,164,173,182,188,194,201,207,219,228,239,244,256,260,261,269,280,283`; `src/lib/medicationPrescriptionIntegrity.integration.test.js:39,41,58,60,63,69,84,89,96,102,106,112,115,135,147,153,162,168,174,180,185,203,211,215,227,239,244,252,260,269,282,288,294,298,299,306,320,322`; `src/lib/medicationSchema.integration.test.js:15,49,51,65,66,68,70,71,77,79,81,83,84,96,124,139`; `src/lib/monitoringAlerts.integration.test.js:15,49,51,65,66,68,70,71,74,79,80,93,105,109,133,147,151,156,160,166,170`; `src/lib/monitoringAlertVitalIntegrity.integration.test.js:39,41,59,61,65,67,68,86,92,96,119,120,121,131,137,138,139,145,152,159,166,173,179,185,190,191,198,199,206,213,225,226,232,233,242,251,257,262,264,265,273,275,288,292,295`; `src/lib/notificationMarkReadIntegrity.integration.test.js:39,41,55,57,60,64,69,76,77`; `src/lib/patientAppointmentBookingMigration.test.js:25`; `src/lib/patientAuthenticatedSelfReadMigration.test.js:12,13,14,18,19`; `src/lib/patientAvailabilityReadAccessMigration.test.js:17`; `src/lib/patientConditionsAllergies.integration.test.js:15,38,40,48,56,60,91,93,98,104,116,117,126,143,150,156,163,168,171,174,176,195,199`; `src/lib/patientDoctorDirectoryMigration.test.js:19`; `src/lib/patientHealthProfiles.integration.test.js:76,80,101`; `src/lib/patientMedicationReadModelMigration.test.js:16`; `src/lib/patientProfileIdentity.integration.test.js:61,71,96,100,111,119,126,139,165,173,182,186,188,193,202,204,231,268,272,273,275,277,278,279,280,309,312,314,317`; `src/lib/patientProfileSelfServiceMigration.test.js:12`; `src/lib/patientRegistrationServiceRoleGrant.test.js:12,13,14`; `src/lib/paymentAppointmentIntegrity.integration.test.js:39,41,55,57,60,63,68,73,75,79,81,83,86,104,107,110,113,116,124,127,130,134,137,141,148,162,166,168`; `src/lib/phase4DatabaseSchema.test.js:13`; `src/lib/prescriptionPatientIntegrity.integration.test.js:39,41,55,57,60,61,65,71,75,94,97,111,116,132,138,144,150,158,163,170,176`; `src/lib/simplifiedPatientAuthMigration.test.js:12,20`; `src/lib/subscriptionPaymentIntegrity.integration.test.js:39,41,55,58,62,67,70,78,93,94,98,102,124,137,144,151,158,164,170,177,190,196,202,220,226,232,238,250,254,255,263,274,278`; `src/lib/suspendedProviderClinicalAccess.integration.test.js:39,41,55,57,60,65,67,69,71,74,80,85,87,89,90,108,115,120,122,131,143,144,154,159,160,165,167,172,178,183,188,202,227,230`; `src/lib/vitalEncounterIntegrity.integration.test.js:39,41,55,57,60,65,79,81,84,90,91,121,126,131,136,141,142,147,152,162,172,178,200,204,205,213,224,226,227`; `src/lib/vitalReadingsDashboard.integration.test.js:31,36,43,44,45,49,57,63,96,97,102,108,110,116,124,125,139,143,149,151,169,172,179`; `src/services/authService.test.js:54`; `src/services/repositories/patientDashboardRepository.test.js:30,41,43,107,158`; `src/services/repositories/repositories.test.js:103`

### payments references

Runtime: `src/App.jsx:62`; `src/data/navigation.js:12,17`; `src/features/localization/translations.js:4,15`; `src/features/secondary/SecondaryPages.jsx:44`; `src/features/subscription/SubscriptionPage.jsx:33`

Tests: `src/lib/paymentAppointmentIntegrity.integration.test.js:73,81,94,99,101,113,117,119,120,121,134,139,148,152,155,168,171`; `src/lib/phase12Routes.test.js:7`; `src/lib/subscriptionPaymentIntegrity.integration.test.js:88,100,111,112,129,132,153,176,183,200,214,215,258,267,276,289`

### prescription_items references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: `src/lib/medicationPrescriptionIntegrity.integration.test.js:66,197,212,221,222,310`; `src/lib/medicationSchema.integration.test.js:78,141,183`; `src/lib/prescriptionPatientIntegrity.integration.test.js:104,106`

### prescriptions references

Runtime: `src/App.jsx:58`; `src/components/GlobalSearch.jsx:13`; `src/data/navigation.js:8,17`; `src/data/presentationFixtures.js:53`; `src/features/localization/translations.js:4,15`; `src/services/repositories/fixtureRepository.js:106`; `src/services/repositories/supabaseRepository.js:4,131`

Tests: `src/lib/appointmentPricingIntegrity.integration.test.js:59,157`; `src/lib/encounterAppointmentIntegrity.integration.test.js:59,95,99,124,146,157,159`; `src/lib/followUpPatientIntegrity.integration.test.js:59,100,212`; `src/lib/medicationPrescriptionIntegrity.integration.test.js:39,62,64,69,84,96,197,203,210,215,221,222,251,259,268,311`; `src/lib/medicationSchema.integration.test.js:76,135,138,183`; `src/lib/notificationMarkReadIntegrity.integration.test.js:59`; `src/lib/paymentAppointmentIntegrity.integration.test.js:59`; `src/lib/phase11Routes.test.js:9`; `src/lib/prescriptionPatientIntegrity.integration.test.js:59,72,84,86,93,95,97,99,137,150,152,157,169,172,180`; `src/lib/suspendedProviderClinicalAccess.integration.test.js:59,103,115,128,154,183,229,230`; `src/lib/vitalEncounterIntegrity.integration.test.js:59`; `src/services/repositories/repositories.test.js:26,48`

### pricing_rules references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: None found.

### profiles references

Runtime: `src/features/subscription/SubscriptionPage.jsx:8`; `supabase/functions/ai-health-guardian/index.ts:162`; `supabase/functions/ai-health-overview/index.ts:34`

Tests: `src/lib/aiHealthOverview.integration.test.js:58`; `src/lib/aiHealthSummaryModel.integration.test.js:57`; `src/lib/appointmentCareRequestIntegrity.integration.test.js:52,341`; `src/lib/appointmentPricingIntegrity.integration.test.js:48,163`; `src/lib/careAssignmentAppointmentIntegrity.integration.test.js:50,54,359`; `src/lib/clinicalDocuments.integration.test.js:47,156`; `src/lib/complaintAppointmentIntegrity.integration.test.js:50,55,56,351`; `src/lib/databaseMigration.test.js:15,22`; `src/lib/encounterAppointmentIntegrity.integration.test.js:48,132,141`; `src/lib/followUpPatientIntegrity.integration.test.js:48,62`; `src/lib/laboratoryData.integration.test.js:47`; `src/lib/medicationEventIntegrity.integration.test.js:48`; `src/lib/medicationPrescriptionIntegrity.integration.test.js:48,248`; `src/lib/medicationSchema.integration.test.js:57`; `src/lib/monitoringAlerts.integration.test.js:57,131`; `src/lib/monitoringAlertVitalIntegrity.integration.test.js:48,164`; `src/lib/notificationMarkReadIntegrity.integration.test.js:48`; `src/lib/patientConditionsAllergies.integration.test.js:45`; `src/lib/patientHealthProfiles.integration.test.js:15,55`; `src/lib/patientProfileIdentity.integration.test.js:95,98,101,110,117,127,138,160,174,195,223,229,264,272,273,276,279,281,311,318`; `src/lib/paymentAppointmentIntegrity.integration.test.js:48,85`; `src/lib/phase4DatabaseSchema.test.js:13`; `src/lib/prescriptionPatientIntegrity.integration.test.js:48`; `src/lib/simplifiedPatientAuthMigration.test.js:21`; `src/lib/subscriptionPaymentIntegrity.integration.test.js:48,65,66,69`; `src/lib/suspendedProviderClinicalAccess.integration.test.js:48,62,92,118,126,136,141,170,175,181,220,222,242`; `src/lib/vitalEncounterIntegrity.integration.test.js:48,182`; `src/lib/vitalReadingsDashboard.integration.test.js:38`; `supabase/functions/_shared/guardian-gateway.test.js:125`

### provider_availability references

Runtime: `src/services/repositories/supabaseRepository.js:94`

Tests: `src/lib/appointmentCareRequestIntegrity.integration.test.js:101,105`; `src/lib/appointmentPricingIntegrity.integration.test.js:76,129,141`; `src/lib/careAssignmentAppointmentIntegrity.integration.test.js:115,119`; `src/lib/complaintAppointmentIntegrity.integration.test.js:104,108`; `src/lib/encounterAppointmentIntegrity.integration.test.js:77,114`; `src/lib/medicationPrescriptionIntegrity.integration.test.js:54`; `src/lib/monitoringAlertVitalIntegrity.integration.test.js:55`; `src/lib/patientAvailabilityReadAccessMigration.test.js:13,21,27`; `src/lib/patientDoctorDirectoryMigration.test.js:22,31`; `src/lib/patientProfileIdentity.integration.test.js:208,218`; `src/lib/paymentAppointmentIntegrity.integration.test.js:78`; `src/lib/vitalEncounterIntegrity.integration.test.js:89`; `src/services/repositories/appointmentRepositoryContract.test.js:9`

### provider_credentials references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: None found.

### provider_specialties references

Runtime: `src/services/repositories/patientDashboardRepository.js:99,102,106,108`; `src/services/repositories/supabaseRepository.js:18,53,80,87`

Tests: `src/services/repositories/patientDashboardRepository.test.js:167`; `src/services/repositories/repositories.test.js:119`

### providers references

Runtime: `src/features/dashboard/DashboardPage.jsx:34,279,287,288`; `src/features/doctors/DoctorsPage.jsx:33,58`; `src/features/landing/FamiliesPage.jsx:6`; `src/features/landing/LandingPage.jsx:25`; `src/features/landing/ServicesPage.jsx:18`; `src/services/dashboardPageService.js:8`; `src/services/repositories/patientDashboardRepository.js:99,106`; `src/services/repositories/supabaseRepository.js:55,79,86`

Tests: `src/features/dashboard/DashboardPage.test.jsx:11`; `src/lib/aiHealthOverview.integration.test.js:16,56,59,66,67,70,81,84`; `src/lib/aiHealthSummaryModel.integration.test.js:15,55,58,65,66,69,147`; `src/lib/appointmentCareRequestIntegrity.integration.test.js:41,53,56,57,64,69,73,78,86,96,100,109,116,121,129,130,166,173,174,181,188,197,199,204,206,228,234,240,241,242,256,305,321,323,332,334,349`; `src/lib/appointmentPricingIntegrity.integration.test.js:39,49,55,57,60,61,66,71,74,75,76,99,103,107,116,124,130,133,141,142`; `src/lib/bookableDoctorSeed.test.js:19`; `src/lib/careAssignmentAppointmentIntegrity.integration.test.js:41,51,59,60,73,77,81,87,89,92,101,111,114,123,132,149,193,201,209,217,218,310,324,329,345,351,366,376,382,392,406,409`; `src/lib/clinicalDocuments.integration.test.js:15,45,48,55,56,59,115`; `src/lib/complaintAppointmentIntegrity.integration.test.js:41,51,60,61,68,72,75,90,100,103,112,137,286,324,334,343`; `src/lib/encounterAppointmentIntegrity.integration.test.js:39,49,55,57,60,62,68,73,75,76,77,78,95,114,115,133,137,142,146,155,159`; `src/lib/followUpPatientIntegrity.integration.test.js:39,49,55,57,60,66,68,74`; `src/lib/laboratoryData.integration.test.js:15,45,48,55,56,59,69,106,127`; `src/lib/medicationEventIntegrity.integration.test.js:39,49,55,57,76,91,96`; `src/lib/medicationPrescriptionIntegrity.integration.test.js:39,49,52,54,58,60,63,69,84,96,211,252,256,260,269`; `src/lib/medicationSchema.integration.test.js:15,55,58,65,66,69,77,171,173`; `src/lib/monitoringAlerts.integration.test.js:15,55,58,65,66,69,138,139`; `src/lib/monitoringAlertVitalIntegrity.integration.test.js:39,49,53,55,59,61,68,86,96,171`; `src/lib/notificationMarkReadIntegrity.integration.test.js:39,49,55,57,60,64`; `src/lib/patientConditionsAllergies.integration.test.js:46`; `src/lib/patientDoctorDirectoryMigration.test.js:11,21`; `src/lib/patientHealthProfiles.integration.test.js:64,189`; `src/lib/patientProfileIdentity.integration.test.js:99,102,110,118,224,230,266`; `src/lib/paymentAppointmentIntegrity.integration.test.js:39,49,55,57,60,63,68,75,76,78,79,162`; `src/lib/phase4DatabaseSchema.test.js:13,50`; `src/lib/prescriptionPatientIntegrity.integration.test.js:39,49,55,57,60,61,65,71,75,94,116,163,170`; `src/lib/subscriptionPaymentIntegrity.integration.test.js:39,49,55,58,78,93,98`; `src/lib/suspendedProviderClinicalAccess.integration.test.js:39,49,55,57,60,66,68,74,80,87,95,115,126,136,147,154,183,186,193,197`; `src/lib/vitalEncounterIntegrity.integration.test.js:39,49,55,57,60,65,79,84,87,89,90,91,162,188`; `src/lib/vitalReadingsDashboard.integration.test.js:39,40`; `src/services/repositories/repositories.test.js:129`

### service_catalog references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: `src/lib/appointmentPricingIntegrity.integration.test.js:153`

### specialties references

Runtime: `src/features/doctors/DoctorsPage.jsx:46,60`; `src/services/repositories/patientDashboardRepository.js:99,102,106,108`; `src/services/repositories/supabaseRepository.js:27,80,87`

Tests: `src/lib/patientDoctorDirectoryMigration.test.js:28`; `src/services/repositories/patientDashboardRepository.test.js:166`; `src/services/repositories/repositories.test.js:119`

### subscriptions references

Runtime: `src/services/repositories/patientDashboardRepository.js:112`

Tests: `src/lib/paymentAppointmentIntegrity.integration.test.js:83`; `src/lib/subscriptionPaymentIntegrity.integration.test.js:61,238,244`; `src/services/repositories/patientDashboardRepository.test.js:171`

### teleconsultation_sessions references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: None found.

### visit_status_events references

Runtime: No literal runtime reference found; database helpers may use it.

Tests: None found.

### vital_readings references

Runtime: `src/services/repositories/patientDashboardRepository.js:56,163`; `supabase/functions/_shared/health-context.ts:15,31`

Tests: `src/lib/aiHealthOverview.integration.test.js:75,149`; `src/lib/monitoringAlerts.integration.test.js:74`; `src/lib/monitoringAlertVitalIntegrity.integration.test.js:64,67,78,98,108,213,219,226,268,280,291,303`; `src/lib/vitalEncounterIntegrity.integration.test.js:75,94,103,114,116,147,154,172,173,208,217,226,233`; `src/lib/vitalReadingsDashboard.integration.test.js:58,64,66,67,76,77,80,85,88,89,94,102,108,116,122,125,131,132,133,139,142,143,149,151,160,164,171,173,175,177,179`; `src/services/repositories/patientDashboardRepository.test.js:43`
