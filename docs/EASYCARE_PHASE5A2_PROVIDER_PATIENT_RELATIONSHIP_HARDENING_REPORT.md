# EasyCare Phase 5A.2 Provider–Patient Relationship Authorization Hardening

## 1. Status

**COMPLETE.** Provider clinical access now requires a current appointment, current care assignment, or the responsible doctor’s own active/paused Care Plan for that patient. PostgreSQL remains authoritative.

## 2. Original limitation

Before this phase, can_access_patient treated any appointment ever recorded for a provider/patient pair as a relationship, regardless of appointment status or time. The provider patient-list RPC repeated this rule. Assigned/accepted care assignments also counted regardless of parent request state.

## 3. Current relationship audit

- clinical_identity_is_current requires an active profile and, for clinical provider roles, a verified provider.
- can_access_patient previously granted provider access from any matching appointment, or a matching assigned/accepted care assignment. It did not check appointment status/date or care-request status.
- list_my_clinical_patients duplicated the broad relationship test, then called can_access_patient.
- assert_care_plan_doctor checked current doctor identity, provider ownership/verification and can_access_patient. Responsible-provider ownership of a plan did not itself establish ongoing access.
- Provider Care Plan list/detail/source RPCs depend on the shared helper and responsible-provider checks.
- Encounter provider management had a provider-ID-only old-row policy path. Its write check used is_appointment_provider, which checked ownership but ignored appointment status and time. Visit-event insertion also used that helper.
- Clinical-note and prescription creation used matching encounter/provider ownership without current patient relationship. Prescription-item creation likewise lacked a patient-relationship check.
- Follow-up staff management already calls can_access_patient. Care Plan RLS and source/reconciliation projections also use the shared helper.
- Care requests, encounters, follow-ups, vital/prescription/medication rows, notifications and historical Care Plans did not generally establish provider relationships in can_access_patient. Some encounter-bound write policies were separate exceptions described above.

## 4. Appointment lifecycle states

The repository appointment_status enum contains pending, confirmed, cancelled, completed, no_show, and rescheduled. It has no rejected state.

## 5. Care assignment lifecycle states

The repository assignment_status enum contains suggested, assigned, accepted, rejected, and cancelled. It has no completed or revoked state.

## 6. Other relationship sources found

A care request alone does not establish access. Encounters, follow-ups, and historical plans do not establish a general relationship. The implemented ongoing-care source is only a non-terminal Care Plan (active or paused) whose responsible_provider_id belongs to the current authenticated, verified doctor and whose patient matches.

## 7. Relationship matrix

| Source | State | Grants current provider clinical access? | Reason |
|---|---|---:|---|
| Appointment | pending | Yes, until scheduled end | Current booking state and unexpired interval |
| Appointment | confirmed | Yes, until scheduled end | Current booking state and unexpired interval |
| Appointment | rescheduled | Yes, until scheduled end | Current booking state and unexpired interval |
| Appointment | completed | No by itself | Historical event; no retention window exists |
| Appointment | cancelled | No | Cancelled relationship is invalid |
| Appointment | no_show | No | No completed/current care relationship |
| Appointment | rejected | Not applicable | Not in repository enum |
| Assignment | assigned | Yes, while parent request is non-terminal | Current assignment state |
| Assignment | accepted | Yes, while parent request is non-terminal | Current assignment state |
| Assignment | suggested | No | Not yet assigned |
| Assignment | rejected | No | Rejected relationship |
| Assignment | cancelled | No | Cancelled relationship |
| Assignment | completed/revoked | Not applicable | Not in repository enum |
| Parent request | new, triaged, matching, booked, escalated | Assignment state still required | Existing non-terminal request states may carry an active assignment |
| Parent request | closed, cancelled | No, even if assignment row remains assigned/accepted | Parent relationship has ended |
| Care Plan | active, paused | Yes, only for responsible current verified doctor | Explicit ongoing-care relationship |
| Care Plan | draft, completed, discontinued, cancelled | No by itself | Draft is not active; terminal plans do not preserve access |

For appointments, scheduled_end must be later than statement_timestamp() and cancelled_at must be null. Status and time together define a current appointment; there is no post-appointment retention period.

## 8. Final authoritative relationship rule

provider_has_current_clinical_relationship(patient) is the internal server-side provider relationship predicate. It derives the caller through auth.uid(), checks current eligible provider identity/type, and accepts only the appointment, assignment, and responsible-plan cases in this matrix. can_access_patient calls this helper for provider access. Direct execution is revoked from PUBLIC, anon, and authenticated.

## 9. Appointment rule

Future or in-progress pending, confirmed, and rescheduled appointments grant access only until scheduled end. Cancelled, completed, no-show, and ended appointments grant no access by themselves. A completed appointment remains part of the record without becoming permanent authorization.

## 10. Care assignment rule

Only assigned and accepted assignments grant access, and their parent request must not be closed or cancelled. Suggested, rejected, and cancelled assignments do not grant access. The schema has no completed or revoked assignment state, so no behavior for those nonexistent states is claimed.

## 11. Active Care Plan responsibility rule

A current eligible doctor who is responsible for the same patient’s active or paused plan retains clinical access after the original appointment ceases to be current. The provider and patient must match; another doctor cannot use the plan as their relationship. This lets the responsible doctor continue legitimate plan operations.

## 12. Paused plan rule

A paused plan remains an ongoing relationship for its responsible current verified doctor, consistent with the existing resume and management transitions.

## 13. Terminal Care Plan rule

Completed, discontinued, and cancelled plans do not grant access. A cancelled draft likewise does not preserve access. An active plan that is paused remains non-terminal. Terminal plans cannot reopen under the existing transition RPC.

## 14. Provider patient-list behavior

list_my_clinical_patients now uses the shared predicate and returns only active patients with a current relationship. Provider identity still comes from get_my_provider_identity() and auth.uid(); the browser supplies no provider ID. The minimal ID/name/context projection remains, with care_plan as a possible context when it is the only valid link. There is no global search or arbitrary enumeration.

## 15. Care Plan authoring behavior

assert_care_plan_doctor continues to call can_access_patient, so draft creation, versioning, goals/tasks, approval, lifecycle, and occurrence extension revalidate the hardened relationship. A doctor with only a cancelled appointment cannot create a Care Plan. A responsible doctor can continue through their active/paused plan. Existing provider role, status, verification and ownership checks remain.

## 16. Provider Care Plan detail/list behavior

Provider plan list and detail projections still require the authenticated provider to match the responsible doctor and now inherit current relationship checks. Terminal history alone cannot make a plan discoverable. Unrelated doctors receive no detail.

## 17. Source selector behavior

Medication, appointment, and follow-up source projections still require doctor identity and can_access_patient(patient, clinical), so the hardened predicate controls source access. Source records remain same-patient and source-authoritative. No frontend authorization rule changed.

## 18. Other clinical RLS/RPC effects

All RLS/RPC paths using can_access_patient inherit the hardened rule, including encounters and notes reads, conditions/allergies/history, vitals, prescriptions/items reads, medication/schedule/event reads, follow-ups, monitoring alerts, clinical documents, Care Plans, and source reconciliation projections.

Appointment-bound paths were also audited. is_appointment_provider now checks current eligible provider identity, matching ownership, current appointment status, no cancellation timestamp, and future scheduled end. This closes the visit-event write path. Encounter provider management requires this predicate in both USING and WITH CHECK, closing the old-row update/delete gap. Clinical-note and prescription inserts require current patient access as well as encounter/provider ownership; prescription-item insertion also requires current patient access. The superseded can_manage_care_encounter Boolean helper is revoked from authenticated callers.

Patient self-access and the family authorization branch of can_access_patient are preserved.

## 19. SECURITY DEFINER review

The new helper and replaced server functions use an empty search_path and qualified application objects. The helper derives identity from auth.uid() and accepts no provider ID. Direct helper execution is revoked from PUBLIC, anon, and authenticated; enclosing security-definer functions call it. can_access_patient and is_appointment_provider remain executable only by authenticated, not PUBLIC or anon. Existing provider eligibility checks remain active.

## 20. Migration

Added forward-only migration supabase/migrations/20261004100000_provider_patient_relationship_hardening.sql. No historical migration was edited. It changes helper definitions and RLS policies and adds no table, column, or data rewrite.

## 21. RLS changes

Updated encounters_provider_manage to require the stricter current appointment predicate in both old-row and new-row checks. Recreated clinical-note, prescription, and prescription-item insert policies with current relationship validation. No patient or family policy was widened.

## 22. RPC/helper changes

Added provider_has_current_clinical_relationship(uuid) as an internal helper. Replaced can_access_patient(), list_my_clinical_patients(), and is_appointment_provider() with hardened provider semantics. Revoked authenticated execution on the superseded can_manage_care_encounter() Boolean probe.

## 23. UI changes

No client-side relationship filtering or UI authority was added. The existing patient selector reflects the server list RPC. care_plan is a descriptive relationship context returned by the server.

## 24. Security tests

The PostgreSQL-compatible provider workspace integration suite replays all migrations through Phase 5A.2 and has 32 passing tests. It verifies identity derivation, unrelated/cross-provider denial, guessed UUID denial, source/detail/authoring denial, eligibility, direct-write protection, and stale clinical-write denial.

## 25. Appointment transition tests

Tests cover all actual appointment enum states: pending, confirmed, and rescheduled grant only while their interval is current; cancelled, completed, and no_show deny by themselves. Tests cover an ended pending appointment, valid-to-cancelled removal from access and the patient list, invalid appointment plus valid assignment, and denied Care Plan creation with only a cancelled appointment. Appointment lifecycle was not changed.

## 26. Care assignment tests

Tests cover assigned and accepted under an open request; denied suggested, rejected, and cancelled assignment states; closed/cancelled parent requests; relationship removal; and a valid assignment coexisting with an invalid appointment. Completed/revoked assignment cases are not applicable because those enum values do not exist.

## 27. Care Plan tests

Tests verify active and paused responsible-doctor continuity after appointment completion, version authoring during ongoing responsibility, denial to another doctor, source/detail/version denial for unrelated providers, and no continuing access from completed, discontinued, or cancelled plans.

## 28. Patient regression

Patient My Care Plan, identity/RLS, own-data, booking, and auth suites passed in the filtered repository run. /my-care-plan remains the authenticated patient Clinical Care Plan.

## 29. Family regression

Family UI and full-chain PostgreSQL family/RLS suites passed. Family authorization, consent, expiry, revocation, and read-only Care Plan behavior are unchanged.

## 30. Provider auth regression

Provider identity resolution, eligibility, route/session tests, logout/account switching, patient sign-in, and registration tests passed. The browser cannot supply provider identity.

## 31. Repairs regression

Repairs 1–15 and the established active repository integrity/security suites passed in the filtered repository run.

## 32. Clean migration replay

The provider integration harness replays every earlier migration in sorted order, applies 20261004100000_provider_patient_relationship_hardening.sql, and exercises resulting RPCs and RLS against PGlite/PostgreSQL semantics. 32/32 provider integration tests passed. The full family integration suite also passed with the migration in the chain.

## 33. Exact test counts

- Phase 5A.2 provider relationship/security integration: 1 file, 32/32 tests passed.
- Filtered active repository regression: 82 files, 1,226/1,226 tests passed.
- Phase 5A.1 provider authoring UI: 66/66 tests passed, included in the full count.
- Family foundation/Care Plan integration: 44/44 tests passed, included in the full count.
- Patient My Care Plan: 23/23 tests passed, included in the full count.

## 34. Excluded suites

The full regression excluded duplicate .kilo/** worktree copies and three obsolete migration-reference suites: bookableDoctorSeed.test.js, phase4DatabaseSchema.test.js, and phase9AppointmentManagement.test.js. Those tests refer to migration files absent from the current repository. Active non-legacy coverage remains included. The regression used a 20-second per-test timeout for concurrent database work and the behavioral provider UI suite.

## 35. Build

npm run build passed. Vite emitted the existing advisory that the main minified JavaScript chunk is about 887 kB, above its 500 kB advisory threshold.

## 36. git diff --check

Passed with no whitespace errors. Git printed existing LF-to-CRLF working-copy notices.

## 37. Browser verification

Not performed. No legitimate provider/patient browser fixture or session is configured. No production account or clinical record was fabricated.

## 38. Known limitations

There is no configured policy for post-appointment access without an active assignment or active/paused responsible-doctor Care Plan. No retention window was invented: a completed appointment alone does not authorize ongoing access. A provider cannot create a plan from a completed appointment alone; the plan must be created while another current relationship exists. Completed/revoked assignment and rejected appointment states do not exist in the current enums. Real-provider browser verification remains unavailable.

## 39. Policy decisions still unresolved

None are required to implement the repository’s existing lifecycle states. The applied policy is explicit: appointment access ends at scheduled end or when its state ceases to be current; only assigned/accepted assignments under non-terminal requests count; only the responsible current verified doctor’s active/paused Care Plan continues access. If product owners later require post-appointment access without an active assignment or Care Plan, that retention/relationship policy must be defined before implementation.

## 40. Deployment status

No deployment was performed.

## 41. Phase 5B readiness

**YES — Phase 5A.2 is ready to hand off to Phase 5B.** The server-side boundary has a precise rule, including ongoing active/paused Care Plan responsibility. Automated migration/RLS, provider UI, patient, family, auth, repair, build, and diff checks passed. Phase 5B is next; it was not implemented in this phase.
