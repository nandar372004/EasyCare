# EasyCare Phase 4A — Smart Care Plan Architecture

**Status: COMPLETE — audit and architecture only.** This report is grounded in executable migrations, current source, schema map, and current handoffs. No implementation work is authorized in this phase.

## 1. Executive recommendation

EasyCare does not have a structured clinical care plan. “Care Plan” currently means encounter free text, a local home-care package wizard, and a dashboard read of commercial subscriptions/packages. Keep these concepts distinct.

Create a new additive clinical model for provider-authored plans. A plan belongs to one patient and has a verified, currently authorized clinical author. Preserve immutable plan versions, structured goals, versioned task definitions, generated occurrences and append-only plan events. Existing appointments, medication courses/schedules/events, vital readings, follow-ups and alerts remain their own sources of truth; plan tasks reference those sources without replacing them.

For family visibility, add a future explicit **care_plans** authorization scope. Reusing **records** would make a broad clinical-record grant silently disclose clinician instructions and plan/task detail. The scope should be read-only; completing or changing family tasks requires separate product/security authorization and is not recommended here.

Recommended implementation split: **4B Core Schema/Security/Service Contracts**, **4C Patient UI**, **4D Family Read-only UI**. No provider authoring portal exists, so Phase 4B needs a constrained, testable authoring contract; it must not imply current UI capability.

## 2. Current “Care Plan” inventory

Repository-wide review covered src, all migrations, reports and the schema reference. “Goal”, “task”, “progress” and “checklist” appear as copy or local stepper state; no clinical goal/task/progress table/runtime was found.

| Source/name | Actual purpose and data | Classification | Recommendation |
|---|---|---|---|
| **care_encounters.care_plan** | Nullable free text on an encounter beside complaint/assessment. Read by recent-record and AI context paths. No structured goal/task/lifecycle. | Real DB, clinical, patient/encounter-specific; read active, authoring database-only. | Preserve as encounter history. Do not convert automatically or call it a structured approved plan. |
| **getActiveCarePlans(patientId)** in patient dashboard repository and dashboard plans section | Reads active/date-valid subscriptions with care package name; limit 3. | Real DB read, commercial, patient-specific, active. Misleading method name. | Preserve compatibility; later rename to Active Care Packages. Never map to Smart Care Plan. |
| **/care-plan**, CarePlanPage and carePlanPricing | Six-step local wizard for package, care level, duration, schedule, address/details, review. Prices/constants are local. Submit only sets component state and shows local success; creates no request, appointment, subscription or purchase. | Local/static, commercial home-care request, generic, no clinical data; route active but not persisted. | Later label as home-care request. Do not migrate state/constants to clinical plan. |
| **/subscription**, SubscriptionPage/local plans | Local option selection; page states no subscription, renewal or payment is created. | Local/static commercial presentation. | Keep distinct from clinical plan and real subscription. |
| care_packages, package_services, subscriptions, payments, service_catalog, pricing_rules | Commercial catalog, included services, subscription and ledger/pricing. Some DB constraints/tests exist; current purchase/payment UX has no backend flow. | Real commercial schema, partial runtime reads/catalog; purchase/payment runtime absent. | Reuse only for commercial entitlements. |
| Care Plan navigation, Global Search, translations | Navigates to /care-plan and labels the package wizard. | Active navigation to presentation workflow. | If renamed later, preserve route compatibility or redirect. |
| Landing/how-it-works/family copy | Claims personalized plans, progress, reminders, coordination and family updates. | Promotional language, not executable capability. | Do not use as schema/runtime evidence; review marketing separately. |
| Wizard stepper and generic task/progress words | Local navigation state and copy; no patient clinical progress. | Presentation only. | No inferred model. |

No care_plans, care_plan_tasks, goals, occurrences, completion or normalized clinical progress tables exist. Follow-ups and medication schedules/events are action foundations, not a unified plan.

## 3. Existing database capabilities

Schema inventory documents 48 public tables. RLS is enabled for the relevant clinical/commercial tables. A database capability is not necessarily an operational application workflow.

| Table(s) | Purpose, patient/provider links, lifecycle/dates | RLS and current paths | Future plan relationship |
|---|---|---|---|
| **patients** | Clinical patient UUID id; profile_id/auth_user_id remain identity-bound; status, DOB, timestamps; coordinator link separate. | Self/authorized read via can_access_patient(view); owner profile update; registration RPC/service. AuthContext and dashboard resolve patient. | Required immutable owner anchor. Preserve identity contract. |
| **care_encounters** | Required patient/provider/unique appointment; open/completed/amended; started/ended/created/updated; complaint, assessment, free-text care_plan. | clinical read; provider/admin management with relationship checks. Dashboard/recent-record/AI read; no complete clinical authoring UI. | Optional origin; multiple plans can relate to an encounter. Keep text untouched. |
| **follow_ups** | Required patient and encounter; optional assignee; call/appointment/monitoring/medication, due, instructions, pending/completed/cancelled and completion time. Repair 2 adds composite ownership, helper and parent guards. | clinical read; assigned staff/admin write using can_manage_follow_up. No operational UI. | Optional reference; never duplicate instructions, assignee or status. |
| **appointments** | Required patient/provider/booking profile, type/start/end; optional patient-bound care request; pending/confirmed/cancelled/completed/no_show/rescheduled, cancellation/create/update times. Repairs 5/13 and others enforce chain. | appointments-scope read; patient booking insert is live. Phase 3 adds narrow family SELECT. Patient grants SELECT/INSERT, not generic UPDATE. Dashboard reads next future pending/confirmed. | Task references actual appointment and derives its date/provider/status; only completed means completed. |
| **prescriptions / prescription_items** | Patient/encounter/provider-bound prescription with status/instructions/issued time; item contains medicine/dose/route/frequency/duration. Repairs 1/12 protect relationship. | Clinical read; doctor insert checks. Prescription screen is fixture-based; no complete live prescribing UI. | Provenance only; medication task links actual medication/schedule, not copied prescription truth. |
| **patient_medications** | Required patient/creator, optional prescription item, name/dose/frequency/start/end/status. Repair 12 validates origin chain. | medications-scope read; authenticated grants SELECT-only. Dashboard/page real read; trusted write path incomplete. Phase 3 adds family SELECT. | Task references actual course; same-patient composite integrity required. |
| **medication_schedules** | Medication FK; local time, weekday set, timezone, valid dates/reminder flag; no patient FK. | Read inherits parent medication access; client SELECT-only. Nested dashboard read; no schedule editor/reminder worker. | Reference existing recurrence/timezone; do not duplicate schedule. |
| **medication_events** | Patient and schedule; scheduled_at; pending/taken/missed/skipped/unknown; confirmation actor/time. Repair 10 enforces schedule/medication patient chain. | medications-scope read; own-patient RPC allows taken/skipped only. No current caller, event generator, dedup worker or adherence UI. | Dose completion derives from matching taken event. |
| **vital_readings** | Patient/source/recorded time; optional encounter/recorder; measurement columns/notes. Repairs 8/11 bind encounter/alert to patient. | clinical read; authorized doctor/nurse/caregiver insert. Phase 1 latest/history read; no patient-entry UI. | Task describes a measurement; complete only with matching real reading. No checkbox substitute. |
| **patient_conditions / patient_allergies** | Patient-bound longitudinal clinical observations; condition status/diagnosis date and allergy/reaction/severity/status/recorder. | clinical reads; provider insert policies; dashboard/AI read. No complete clinical authoring workflow. | Context only; goals may refer to a clinician-authored condition, but plan must not create/update diagnosis/allergy rows. |
| **lab_orders / lab_results** | Order belongs to patient/provider and optional encounter with lifecycle dates; result belongs to same patient/order, typed values/units/ranges/flags/verification/observed dates. | Patient read and authorized clinical writes subject to repaired patient-parent links; dashboard/AI recent result reads, but lab UI is fixture-based. | A plan may refer to ordered follow-up in future; do not duplicate lab values or infer completion from an order alone. Use verified result with same patient if a future task is explicitly lab-linked. |
| **clinical_notes** | Encounter-bound authored clinical note, author profile, note type/content and create/amend dates. | Read through encounter clinical access; insert only by assigned provider/role and note-type rules. No connected runtime authoring UI. | Potential source material only; plan must retain separate approval/version and not replace note. |
| **visit_status_events** | Appointment-bound visit progress/status, actor/location/notes and creation time; immutable event history. | Read through appointment access; provider/admin insert, update/delete blocked. Current adapter mistakenly asks for absent appointment_events table. | Appointment task can derive from appointment status; do not use presentation event adapter as task truth. |
| **monitoring_alerts** | Patient/severity/message/status, optional patient-bound vital, source metadata, detection/create/resolution times and reviewer. Repair 11 protects vital link. | alerts read, provider insert/reviewer update; dashboard/AI read, but no confirmed runtime alert producer/threshold engine. | Surface existing alert; no plan-specific duplicate or inferred threshold. |
| **care_requests / care_assignments** | Patient request/service/reason/urgency/status/coordinator/time/address; assignment links request/provider and optional appointment/status/times. Repairs 13/14 protect chains. | Appointment-scope request read/create; coordinator/admin assignment update. Full orchestration UI absent. | Optional origin only; assignment is not clinical approval. |
| **clinical_documents** | Patient/uploader, optional patient-matched encounter, metadata/private storage path/date. | Authorized metadata read; service writes/private Storage; dashboard metadata read, full upload/download flow absent. | Optional evidence reference; never expose storage path or copy file contents. |
| **ai_health_summaries** | Patient-bound derived output, source snapshot/hash, model/prompt/review/supersession and times. | Authorized read; service-only generation/save/lease; Phase 1 overview own-patient, cannot write diagnoses/prescriptions. | Not an authoritative plan/goal/task. AI suggestion remains draft until clinician approval. |
| **audit_logs** | Trigger-generated actor/patient/entity before/after JSON and timestamp; append-only. | RLS and immutable update/delete; only selected tables have row audit triggers; no general viewer. | Add explicit plan audit/events. Do not assume care_encounters already has a row trigger. |
| **care_packages / package_services / subscriptions / payments / service_catalog / pricing_rules** | Commercial catalog, entitlements, patient purchase/status/dates and ledger/pricing. Subscription lifecycle pending/active/paused/cancelled/expired. | Catalog reads; subscription/payment read under payments scope; purchase/billing runtime incomplete. | No clinical plan dependency or backfill. |

**Access helper finding:** family scopes are records, appointments, medications, payments and alerts. Family clinical and unknown permission names fall through to can_view_records. Provider, coordinator, clinic-admin and main-admin branches have separate semantics. A future care_plans scope needs an explicit family branch; sending that name to today’s helper without changing its CASE would accidentally inherit records. This is a critical design gate.

## 4. Terminology

- **Commercial care package:** purchased service entitlement; commercial catalog/subscription/payment is truth.
- **Clinical Smart Care Plan:** patient-specific, clinician-authored, versioned care journey.
- **Goal:** intended outcome/objective, not health score.
- **Task:** instruction or link to an action.
- **Occurrence:** dated instance of a scheduled/repeating task.
- **Follow-up:** existing assigned post-encounter action with independent lifecycle.
- **Medication schedule/event:** existing recurrence and dose-confirmation truth.
- **Progress:** derived task-completion calculation, not editable percentage.

## 5. Ownership and links

Every clinical plan belongs to one immutable patients.id. Initial plans require one responsible provider and creating profile. Encounter is optional origin; multiple plans may relate to one encounter. Appointment and prescription need not be plan-level links: appointment tasks link appointments; medication tasks link the actual medication/schedule. Care request is optional provenance only if future workflow needs it. Plans have many versions, goals, task definitions, occurrences and events. Every child carries patient attribution and same-patient constraints.

## 6. Creation and provenance

Initial authority should be a verified provider after consultation or another approved clinical workflow. There is no provider authoring portal. Encounter text does not equal structured approval.

Distinguish provider-authored, system-structured-from-provider, and ai-suggested provenance. System structuring becomes authoritative only after explicit provider review/activation. AI suggestions remain visibly AI-originated drafts and cannot activate or appear clinician-authored before approval. Patient-created wellness reminders are outside this clinical model. Record creator/profile/provider, source encounter, version reason, approver, approval/activation actors/times, and AI model/prompt/source metadata where relevant.

## 7. Lifecycle

Recommend **draft → active ↔ paused → completed/discontinued**, plus **cancelled** for an unstarted plan withdrawn before activation. Completed/discontinued/cancelled are terminal. A later course is a new or explicit successor plan, not reopening history. End-date passage should prompt review rather than silently rewrite clinical status.

Only a qualified provider may activate, pause/resume, complete/discontinue, cancel an unstarted draft, or publish a clinical version. Patient may read and perform permitted task actions, not edit instructions or plan status. Family is read-only. Coordinators may support logistics but do not author clinical instructions without separately approved authority. Admin/support is not implicit clinical author access. Every transition validates prior state and records actor/time/reason; invalid transitions fail closed.

## 8–9. Task and completion model

Types: medication, vital_check, appointment, follow_up, activity, instruction, custom. Prefer type-specific source fields and constraints to an unvalidated polymorphic target.

| Type | Reference; do not duplicate | Completion |
|---|---|---|
| Medication | patient_medications and optional exact medication_schedules; occurrence can refer to medication_events. | Matching taken event only; skipped/missed/pending/unknown do not count. |
| Vital check | Measurement/action definition and due window; occurrence links vital_readings. | Matching same-patient reading in valid window; no manual checkbox. |
| Appointment | appointments row. | Source status completed; cancelled/no-show/rescheduled are separate. |
| Follow-up | follow_ups row. | Existing follow-up status and actor rules. |
| Activity/instruction/custom | Versioned definition and occurrence. | Manual acknowledgment only where allowed, with actor/time/note; no false medication/measurement claim. |

Completion modes: linked_event, manual_acknowledgement, clinician_review; immutable per task version and checked against type. Source corrections preserve history and may recompute present status; never silently erase completion. Patient action validates actor, patient, plan, task type, due window and source transactionally. No direct client update of clinical content.

## 10. Recurring tasks

Use task definition plus materialized occurrences generated idempotently over a bounded rolling horizon. Store IANA timezone/local schedule intent; snapshot UTC schedule time, local due date/time, timezone and stable key on each occurrence. A unique task/version/local-slot key prevents duplicates. Keep history when recurrence changes; close only obsolete future occurrences and emit an event.

Define DST ambiguous/nonexistent-time behavior, overdue grace, catch-up horizon, and multiple same-day slots before implementation. Local calendar boundaries use task timezone. Future rows are not due; missed is derived after grace. There is no current occurrence generator, dedup job or reminder delivery, so adherence/progress claims require an operational worker and monitoring.

## 11. Progress

Never store an editable percentage or health score. Derive **Today** as completed/required occurrences due in plan timezone's local day; show optional tasks separately. Derive **Plan-to-date** as completed required occurrences / eligible required occurrences due by cutoff. Exclude future, optional, cancelled/replaced slots; missed/incomplete remain denominator; recurrence counts per occurrence, one-time task once.

No eligible tasks means “No tasks due” or “Progress not available”, never 0% or 100%. Define inclusive day-one behavior, timezone and rounding. Provide numerator/denominator/cutoff for deterministic tests. This measures task completion, not health or recovery.

## 12. Timeline / future Health Story

Append-only care_plan_events cover lifecycle, version publication, task/occurrence acknowledgment and correction. Include patient/plan/version/task/occurrence, event type, actor/provider, occurred/recorded times, source table/id, correlation ID and minimal metadata. Avoid copying full instructions or medical rows. Health Story can later union these with medication events, vitals, appointments, follow-ups and alerts by patient/time. Source events remain canonical; corrections append compensating events.

## 13. Patient dashboard integration

Future bounded query returns current authenticated patient's active plans, current version, tasks due today, completed/required counts, local day index/end date, next occurrence and load state. No URL patient UUID. Reuse Phase 1 isolated loading and cards, not the package query.

No active plan: “You don’t have an active care plan right now”; this does not imply health. Multiple plans: show bounded cards (suggest max 3), separate denominators, sort due items/next due/stable creation ID. No “primary plan” until product defines one. Paused/completed/empty/unavailable/error are distinct; one failure must not hide other dashboard sections.

## 14–15. Family integration and authorization

Self uses patient self access. Family membership alone continues to grant nothing. Recommend **Option B: dedicated care_plans scope**.

| Option | Implication |
|---|---|
| Reuse records | Convenient but records grant would silently disclose forward-looking instructions/goals; no independent grant/revoke. Not recommended. |
| Dedicated care_plans | Explicit patient choice and independent revocation; requires additive authorization flag, helper branch, grant/revoke RPC and consent UX. Recommended. |

Do not add care_plans to today's helper until its family CASE is changed explicitly: unknown names currently fall through to records. Family SELECT requires explicit patient grant, linked active consent/membership and current expiry/revocation checks. Scope is read-only. Linked detail still needs its own scope: appointment details require appointments; medicine/events require medications; vital values require records. care_plans grant UX must disclose that plan instructions/goals/tasks are shared. No delegated action scope is proposed.

## 16–18. Provider, AI and alerts

- **Provider:** current verified provider relationship and role-specific policy gate reads/authorship. Doctor authority must not be silently inherited by nurse/caregiver. New versions record author, approver, time and reason. Assignment alone is not clinical approval.
- **AI:** existing Overview is own-patient, derived and non-authoritative; Guardian currently receives text rather than record context. Neither writes plans. Future AI may summarize an authorized plan or suggest a labeled draft; it cannot activate, alter medication/provider instruction, or write source records.
- **Alerts:** monitoring_alerts remains alert truth. A vital may satisfy a plan task while its alert remains active. Do not duplicate alerts or introduce unapproved thresholds.

## 19–20. Proposed additive schema, constraints and indexes

Design sketch only, not executable DDL:

~~~sql
care_plans(
 id uuid PK, patient_id uuid FK patients NOT NULL,
 responsible_provider_id uuid FK providers NOT NULL,
 created_by_profile_id uuid FK profiles NOT NULL,
 origin, source_encounter_id nullable, title, status,
 timezone, starts_at, target_end_at, current_version_no,
 approved_by_profile_id nullable, approved_at nullable,
 created_at, updated_at, UNIQUE(id,patient_id)
)
care_plan_versions(
 id uuid PK, plan_id, patient_id, version_no, title, summary,
 instructions, origin, source_encounter_id, author_profile_id,
 author_provider_id, approved_by_profile_id, approved_at,
 change_reason, created_at, UNIQUE(plan_id,version_no),
 UNIQUE(id,patient_id), FK(plan_id,patient_id) -> care_plans
)
care_plan_goals(
 id uuid PK, plan_id, version_id, patient_id, title, description,
 target_text, review_at, sort_order, created_at, same-patient FKs
)
care_plan_tasks(
 id uuid PK, plan_id, version_id, patient_id, goal_id nullable,
 task_type, title, instructions, required, completion_mode,
 constrained recurrence_rule, timezone, due_at, grace_minutes,
 patient_medication_id, medication_schedule_id, appointment_id,
 follow_up_id, created_at, same-patient FKs
)
care_plan_task_occurrences(
 id uuid PK, task_id, patient_id, occurrence_key, scheduled_at,
 local_due_date, local_due_time, timezone, status, completed_at,
 completed_by_profile_id, medication_event_id, vital_reading_id,
 appointment_id, follow_up_id, created_at,
 UNIQUE(task_id,occurrence_key), same-patient FKs
)
care_plan_events(
 id uuid PK, plan_id, patient_id, version_id, task_id, occurrence_id,
 event_type, actor_profile_id, actor_provider_id, source_table,
 source_id, previous_status, new_status, reason, minimal metadata,
 occurred_at, recorded_at, correlation_id, append-only
)
~~~

Use typed enums or checked text according to migration conventions. Version content is immutable; tasks belong to a version; edits create new version/tasks and preserve prior occurrences. AI-suggested origin cannot activate without provider approval.

Constraints: composite unique keys and same-patient FKs through plan/version/task/occurrence and each source; medication schedule must belong to task medication. Add only needed composite source keys after catalog review. Checks enforce task/source/completion combinations, status transitions, approval state, nonempty text, date order, positive version/grace/order, valid IANA zone and recurrence allowlist. No cascade delete.

Indexes: patient/status/start for active plans; plan/version descending; patient/scheduled and task/scheduled for occurrences; patient/occurred for events; source FK indexes; unique plan/version and task/occurrence key. Verify query plans/volume before adding more.

## 21. RLS design

| Actor | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| Patient/self | Own plan/children through own-patient authorization. | No direct clinical creation; eligible manual acknowledgement only by validating RPC. | No direct plan/version/task edits; narrow acknowledgement RPC. | Deny. |
| Adult family viewer | Explicit care_plans grant, active membership/consent and expiry/revoke checks; source details need their own scopes. | Deny. | Deny. | Deny. |
| Verified provider | Same patient and current provider relationship, role-specific. | Draft/version/goal/task by constrained authoring contract; qualified clinician activates. | New immutable version or validated lifecycle RPC; no published-text rewrite. | Deny. |
| Coordinator | No clinical instructions by default; any future logistics-only projection separately scoped. | Deny. | Deny clinical fields. | Deny. |
| Admin/support | No implicit clinical author/read access; break-glass requires separately approved audited policy. | Deny. | Deny. | Deny. |
| Service role | Supabase bypasses RLS; credentials never reach browser. Edge/service authenticates caller and repeats actor/patient/source checks. | Validated transactions only. | Validated transactions only. | No routine deletion. |

Use can_access_patient only after explicit care_plans family semantics are added. Role-specific USING/WITH CHECK and table privileges must not imply generic writes. RPCs require controlled search_path, execute grants, actor derived from auth.uid(), parent checks and adversarial tests. Client-supplied patient/actor UUID is never authority.

## 22. Audit and history

Instruction changes create immutable versions. Activation, pause/resume, task changes, acknowledgment, linked completion/correction, discontinuation/cancellation/completion append domain events in the same transaction. Capture actor/role/provider, patient/plan/version/task, reason, prior/new status and timestamps. Correct with events, never mutate old event rows.

Existing audit_logs is append-only trigger infrastructure but only selected tables have row triggers, and it snapshots before/after JSON that can duplicate sensitive instructions. Phase 4B must select new table triggers and minimize/redact snapshots or use version/event rows plus secure audit metadata. It must not assume care_encounters is audited. Retention and read-access logging remain decisions.

## 23. Security Repairs 1–15 regression matrix

| Repair | Phase 4 risk | Preserve |
|---|---|---|
| 1 prescription/encounter patient | Medication task wrong origin. | Same-patient reference; retain composite FK and doctor insert checks. |
| 2 follow-up ownership/self-assignment | Foreign follow-up exposure/reassignment. | Helper, composite FK, parent guards; no task reassignment. |
| 3 verified clinical identity | Suspended/unverified author. | Current identity checks; fail closed; no helper widening. |
| 4 appointment price | Task mutates fee/booking. | Read-only appointment reference. |
| 5 encounter/appointment patient | Wrong encounter origin. | Composite link and current encounter guard. |
| 6 payment/appointment patient | Commercial workflow conflated. | No payment FK needed; retain payment constraint. |
| 7 notification mark-read | Reminder mistaken as completion/direct update. | Keep scoped RPC; notification is not task truth. |
| 8 vital/encounter patient | Wrong-patient vital completion. | Same-patient FK; preserve insert policy/index. |
| 9 payment/subscription patient | Package mistaken for clinical plan. | Keep commercial models separate. |
| 10 medication event/schedule patient | Wrong-patient dose event completes task. | Preserve chain guards; no copied status. |
| 11 alert/vital patient | Foreign alert in timeline. | Preserve composite FK; source_id alone is not proof. |
| 12 medication/prescription item patient | Cross-patient medication origin. | Existing chain and parent guards. |
| 13 appointment/care request patient | Wrong request origin. | Composite FK; optional link must match. |
| 14 assignment/request/appointment | Assignment mistaken for clinical approval. | Keep chain; assignment is not authority. |
| 15 complaint/appointment patient | Shared parent mutation affects complaint. | Preserve behavior and documented NULL-patient residual. |

Repairs remain frozen. Phase 4B must replay migrations, run every integrity suite and test every new plan/source relationship at the database boundary.

## 24. Migration strategy

Future Phase 4B is forward-only/additive: preflight schema/roles/unique keys/migration replay; create plan/version/goal/task/occurrence/event tables; add validated patient-bound keys/FKs/checks/indexes/immutability; add exact role RLS/grants and care_plans family field/helper/grant/revoke atomically; add constrained RPC/service, occurrence/progress logic, audit and tests.

No backfill from encounter text, subscriptions, package wizard state, medications, follow-ups or AI summaries. Encounter text lacks structured approval/version and wizard state is not persisted. Do not edit historical migrations. Abort on inconsistent source links or unresolved role/scope rules; never rewrite unrelated data. Once clinical plans exist, feature-disable/fix-forward rather than delete history.

## 25. Phase 4B test plan

1. Patient own-plan read; unrelated patient denied.
2. Membership-only and records-only family grants denied under Option B.
3. Explicit care_plans grants SELECT only; family writes/task completion denied.
4. Provider read/create/activate requires active verified identity and correct patient relationship.
5. Admin/coordinator do not gain silent authoring or unrestricted clinical access.
6. Cross-patient plan/version/goal/task/occurrence and encounter/medication/schedule/event/appointment/follow-up/vital links rejected in DB.
7. AI/system draft cannot activate before clinician approval or be relabeled by patient.
8. Medication completion only matching taken event; wrong-patient, skipped/missed/pending/unknown fail.
9. Vital completion only matching reading/time/type; checkbox fails.
10. Appointment and follow-up completion follows source status.
11. Manual completion limited by type/actor; attribution and idempotency.
12. Revoked/expired/withdrawn grant or removed membership immediately loses family view and clears stale UI.
13. Progress deterministic over required/optional/future/missed/cancelled/recurring, timezone/DST/no-task/multiple-plan cases.
14. Occurrence generator idempotent; new version preserves history and closes only obsolete future slots.
15. Lifecycle/version produces append-only audit/events; invalid/replayed/out-of-order transitions fail.
16. Honest empty/error/paused/completed states; no fake data.
17. Phase 1 dashboard/AI and Phase 3 family behavior unchanged.
18. Security Repairs 1–15 suites continue passing.

Use full migration replay and PostgreSQL-compatible RLS tests; mocks alone cannot prove authorization.

## 26. Risks and unresolved decisions

- Clinical governance must decide author/activator roles, covering provider workflow and coordinator metadata view.
- Provider authoring portal is absent; safe contract precedes production use.
- Medication event generation/reminders are not operational.
- Define day-count inclusivity, plan timezone, DST policy, grace/catch-up, corrections and progress denominator wording.
- Clinically review vital targets; no implicit threshold engine.
- Family UX must say care_plans discloses instructions/goals/tasks. Old grants must not inherit it.
- Audit payload/retention and read-access logging need decisions.
- Define deletion, successor/restart, version diff, stale/multiple-active plan handling and patient correction path.
- Hosted/browser verification remains for implementation; Phase 4A is source/schema design only.

## 27–28. Recommended phases and exact Phase 4B scope

**4B — Core model/security:** new clinical plan/version/goal/task/occurrence/event tables; same-patient integrity; provider-authored draft/activation/version lifecycle; patient read and source-safe completion contracts; explicit care_plans grant semantics but no family UI; bounded idempotent occurrence/progress service only once scheduler is configured; audit and RLS integration tests. No redesign. Exclude package/subscription workflow, legacy text backfill, medication semantic rewrite, AI authoring, family actions, dependents/guardians and deployment.

**4C — Patient UI:** real active/completed plans, due tasks, honest states, linked-resource reads under their own scopes, eligible manual acknowledgement. Clinical text remains read-only; no AI authoring.

**4D — Family read-only:** patient-controlled care_plans consent UX, bounded Family Health view, linked-source scope checks and revoke/expiry clearing. No delegated completion or plan changes.

## 29. Readiness decision

**YES, ready to proceed to Phase 4B**, after product/clinical owners settle author roles, lifecycle/recurrence rules and family scope UX. Phase 4A is complete; Smart Care Plan has not been implemented.

## Audit boundary

Report creation only. No migration, schema, RLS, function, RPC, Edge Function, frontend, route, service, test, Phase 1/2/3 behavior, fake health data, dependent functionality or deployment was changed by this phase.
