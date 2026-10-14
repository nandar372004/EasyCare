# Patient notification reminders

Implemented locally; no migrations or scheduler have been deployed.

The read-only linked-project audit on 2026-10-13 confirmed the existing notification RPCs and broadcast functions, no pg_cron or pg_net extensions, and no appointment timezone column. The repository already schedules trusted Care Plan maintenance through GitHub Actions. The new hourly workflow follows that convention and reuses the protected `care-plan-maintenance` environment and its Supabase URL/service-role secret.

Apply `20261013090000_wellness_notification_type.sql` first, committing its enum addition before applying `20261013091000_patient_notification_reminders.sql`. Release the frontend only after these migrations. Activate the workflow only against the intended environment after reviewing its existing variables/secrets. Production deployment requires a separate explicit instruction.

Login greeting identity comes from the verified JWT `session_id` and `auth.uid()`. A unique existing `source_key` prevents duplication across rerender, navigation, tabs, reload, and token refresh. A later login with a new JWT session may create a new greeting. No client supplies a patient ID, session ID, title, or URL.

Daily medication reminders consolidate the exact two My Care Plan action sources: existing schedule/event occurrences and unscheduled numbered daily check-ins. PRN, patient-reported read-only records, unknown unscheduled frequencies, and synthetic records are excluded. Valid dates and weekdays are respected. A missing scheduled event is incomplete; only `taken` completes an event. Every numbered check-in must be taken. No new dose times or events are created.

The daily source key uses the patient's established Asia/Yangon date. Schedule eligibility and event dates retain each stored schedule timezone. The Done follow-up is generated at least one hour after the daily notice, on a later scheduler check, only if actions remain incomplete. It is also unique per patient/local day. The delay is a notification policy, not a prescribed dose time.

Appointment reminders use local calendar offsets of exactly three or one days in Asia/Yangon, the existing appointment display timezone. Only future pending, confirmed, or rescheduled appointments qualify. Keys include appointment ID, start instant, and reminder offset. Changing the start time or patient, cancelling, completing, or marking no-show immediately withdraws prior reminders while preserving their deduplication keys. The existing private broadcast trigger refreshes the bell on inserts and withdrawals without health content.

The scheduler RPC is service-role-only. Login creation requires an active patient/profile and a signed session. Existing RLS policies and notification direct-table privileges are unchanged. Existing list/count/read RPCs remain authoritative. Deep links are derived from known types and validated UUIDs.

GitHub scheduled runs can be delayed; this is an hourly calendar-day reminder check, not a guarantee of delivery at an exact minute. A full-day scheduler outage does not backfill expired reminder windows. Failures surface as failed workflow runs, and reruns are idempotent. Scheduler activation and hosted realtime delivery remain deployment verification steps.

## Local verification

The targeted notification/authentication/medication suite passed all 61 tests across seven files. The additional medication hash deep-link focus test passed. PostgreSQL integration tests exercise server-side deduplication, two patient identities, anonymous denial, direct-write denial, multi-dose completion, PRN exclusions, cross-zone schedule consolidation, appointment cancellation/rescheduling, and content-free private refresh hints. Production build passed with a bundle-size warning.

A broader My Care Plan run passed 24 tests and failed one unrelated existing selected-day monitoring test: it selects Monday/Wednesday but asserts today's occurrences on Tuesday, 2026-10-13. Its source and monitoring behavior were left unchanged. No hosted scheduler execution, applied migration, or live realtime delivery is claimed.
