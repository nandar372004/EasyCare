# Patient Health Dashboard data access

Import the named functions from `patientDashboardService.js`. They use the configured authenticated Supabase client and never fall back to presentation fixtures. Missing configuration, inaccessible patient profiles, and query failures are errors; empty clinical data remains `[]` or `null`. UI components should call this service (or use an injected service), not Supabase directly.

The same functions are composed into `createSupabaseRepository`. `createPatientDashboardService(repository)` supports dependency injection. `createPatientDashboardRepository(client, { now, timeZone })` supports a test clock and dashboard timezone; the default is Asia/Yangon. Authorization remains database RLS using the caller's session, with an explicit patient filter on every patient-data query. A patient ID alone does not grant access.

## Functions

| Function | Result |
| --- | --- |
| getPatientDashboard(patientId) | patientProfile, latestVitals, vitalHistory (30 days), currentMedications, todayMedications, nextAppointment, activeAlerts, recentHealthRecords, recentLabResults, latestAIHealthSummary |
| getLatestVitals(patientId) | Map keyed by blood_pressure, heart_rate, oxygen_saturation, temperature, blood_glucose, weight_kg. Each value is its latest non-null reading or null; readings can have different timestamps. Blood pressure requires both components. Future readings are excluded. |
| getVitalHistory(patientId, type, period) | Ascending readings for that metric, with stable ID ordering. Period: 7d, 30d, 90d, 365d, or {start, end}; start is inclusive and end exclusive. Default: 30d. |
| getTodayMedications(patientId) | Array of {medication, schedule, localDate, events}. Each schedule uses its own timezone, validity dates and weekday rules. Events retain recorded statuses; no event is invented when missing. |
| getNextAppointment(patientId) | Earliest future pending/confirmed appointment, or null. |
| getActiveAlerts(patientId) | Open, acknowledged and escalated monitoring alerts; no notifications are queried. |
| getRecentHealthRecords(patientId) | Up to 20 merged {kind, recordedAt, record} entries from care_encounters, clinical_documents and medical_history_items. Kinds: encounter, document, history. Document paths remain private paths, not fabricated download URLs. |
| getRecentLabResults(patientId) | Up to 20 preliminary/final/corrected observations, newest observed time first, undated results last. Preliminary status is retained; no clinical interpretation is added. |
| getLatestAIHealthSummary(patientId) | Latest generated, unsuperseded, non-hidden summary with no expiry or future expiry, or null. Generated and reviewed summaries are returned with reviewStatus intact; neither is promoted to a clinical record. |

Database row keys are exposed in camelCase. Clinical JSON contents are preserved, including their own key names. Vital fields include systolicBp, diastolicBp, heartRate, spo2, temperatureC, glucoseMgDl, weightKg and recordedAt. History also accepts the database aliases spo2, temperature_c and glucose_mg_dl. The repository queries actual schema columns rather than nonexistent oxygen_saturation/temperature/blood_glucose columns.

patientProfile contains the patients row and optional healthProfile from patient_health_profiles. Blood type remains patients.blood_type. Current medications include active courses valid on the dashboard's local date, including courses without a schedule. Today's scheduled entries independently honor each schedule's local date. reminder_enabled is not used to hide doses: reminder delivery and medication scheduling are separate.

History, medication lists/events, and active alerts are paginated in batches of 500 to avoid the normal Supabase response limit. Medication-event retrieval covers the surrounding 48 hours in both directions, then filters each schedule's actual local day, including timezone and DST boundaries. Upcoming/history periods are clock-relative, not fixed sample dates.

The aggregate fails if a required source query fails instead of showing a false empty or healthy state. Its parallel reads are not a single database transaction. No cache spans patients, no writes occur, and no schema or UI changes are required beyond deploying the preceding database migrations.

`getHealthSummary` in the existing Supabase repository now delegates to the AI summary function, replacing its nonexistent health_summaries table query. Unrelated presentation-only repositories are outside this dashboard path.

Tests use the real Supabase client with mocked HTTP responses to check request serialization, patient filters, pagination, field mapping, local-day rules, errors and absence of synthetic fallback. Database RLS and constraints are covered by the existing PostgreSQL phase suites; a hosted PostgREST smoke test is still required at deployment.
