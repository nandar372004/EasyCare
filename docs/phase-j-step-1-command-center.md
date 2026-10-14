# Phase J Step 1 — Family Health Command Center

## Architecture decision

Reuse the existing entities and secure read boundaries. The normalized command
center is an application read model; it adds no source-of-truth table, migration,
RLS policy, clinical write, AI request, or synthetic production data.

- Identity: `profiles`, `patients`, and the authenticated patient context.
- Family: `family_groups`, `family_group_members`, `family_invitations`,
  `family_authorizations`, and consent-aware family RPCs. Relationships are
  membership metadata; they never grant health access.
- Appointments: `appointments`, filtered by patient under existing RLS.
- Medications: `patient_medications`, `medication_schedules`, `medication_events`.
  The overview reuses the active medication readout; it does not invent dose reminders.
- Care plans: `care_plans`, versions, goals, tasks, occurrences, and events.
  Family reads use `get_family_care_plan_readout`, preserving independent source masking.
  Own plan summaries are explicitly filtered to the authenticated patient because
  `list_my_care_plan_summaries` also returns authorized shared plans.
- Health facts: existing patient conditions, allergies, vitals, laboratory records,
  and patient health profiles remain in existing detail pages. They do not drive
  medical severity or diagnoses in this operational overview.
- Document reviews: `document_extracted_facts`, `document_extractions`, and
  `clinical_documents`, through the existing validated intelligence read service.
  Only review state and creation time are used; candidate content is never promoted.
- Follow-ups: `follow_ups` retain their clinical access boundary. Only follow-ups
  already exposed through authorized care-plan tasks/occurrences appear here.
  Standalone provider-only follow-ups are deliberately omitted.
- Provider relationships: existing providers, care assignments, encounters and
  provider patient access helpers remain authoritative; no new relationship is created.

## UI and rules

`/family/overview` is linked from the dashboard and family management. The existing
`/family/health` page remains the detailed readout; links select the authorized
family group and membership, never an arbitrary clinical patient.

Overdue pending appointments/tasks rank first, reviews and open care alerts second,
upcoming appointments third, active care tasks fourth, and existing medication
schedule viewing fifth. Each person has exactly one primary next action.
Statuses describe operational actions, not medical health. Unshared sections
contribute no content or counts, and incomplete sharing is explicitly labeled.

Upcoming care includes appointments, projected follow-ups/tasks, and goal review
milestones. Recent changes cover actual appointment creation, document review
creation, plan updates, and projected follow-up completion within 30 days.

The readout revalidates membership/grants through the existing health service,
refreshes every 15 seconds and on focus, and clears visible data at grant expiry.
Account changes remount private state; stale request completions are discarded.
Database RLS remains the final authorization boundary.

## Validation

Focused model, UI, service and repository tests plus the existing PostgreSQL
family foundation/privacy suite: 92 passing tests. Production build passed;
Vite reports its large bundle advisory. `git diff --check` passed.
No deployment was performed. AI Guardian, One-Tap Care and Health Story Timeline
were not started. Live hosted Supabase and authenticated device screenshots were
not used; database verification runs against the repository migration chain locally.
