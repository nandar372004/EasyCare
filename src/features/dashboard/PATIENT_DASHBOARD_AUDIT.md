# Patient Dashboard source audit

Scope: the authenticated `DashboardPage.jsx`, including its data loaders. “Current source” below records the implementation before this audit. The landing-page marketing dashboard illustration and linked standalone health pages are not the patient dashboard and were not redesigned or rewired here.

| UI Field | Current Source | Correct Database Source |
| --- | --- | --- |
| Greeting / patient name | AuthContext patient.full_name; prototype mode can supply Demo Patient | patients.full_name through authenticated patient identity; no prototype greeting without a patient ID |
| Health Overview: Blood Type | healthPresentationData.healthOverview.bloodType: hardcoded Unknown | patients.blood_type; Not recorded when absent |
| Health Overview: Allergies | First fixture entry: No known allergies (synthetic) | Active patient_allergies.allergen rows, scoped by patient_id; no-record state is not a claim of no allergies |
| Health Overview: Conditions | First fixture entry: No presentation conditions recorded | Active patient_conditions.condition_name rows, scoped by patient_id |
| Last Check-up | Fixed 2026-07-15T03:30:00Z | patient_health_profiles.last_health_review_at; accurately relabelled Last Health Review rather than inferring a completed check-up |
| Appointment date tile and date/time | presentationRepository.listAppointments(), which can return fixtures; dashboard call had no explicit patient filter | appointments.scheduled_start for the authenticated patient's next future active appointment |
| Appointment channel | Fixture-capable appointment consultationType mapping | appointments.consultation_channel, with recorded appointment_type as fallback |
| Appointment status and detail link | Fixture-capable appointment status/id | appointments.status/id from the same patient-filtered query |
| Appointment provider name | Fixture-capable doctor directory; fallback Verified doctor | providers.display_name through the appointment's provider_id; unavailable text if inaccessible |
| Appointment specialty | Directory mapper could invent General Practitioner | provider_specialties → specialties.name; Specialty not recorded when missing |
| Care Updates event label and timestamp | Fixture-capable listAppointmentEvents(next.id) | appointment_events.event_type/created_at for the authorized next appointment; failed lookup shows an error, not no updates |
| Medication name | Fixture-capable listMedications; first three active medications, not today's schedule | patient_medications.medication_name through today's valid medication_schedules |
| Medication dose/time | Fixture-capable dose/frequency | patient_medications.dose plus medication_schedules.time_of_day/timezone; doses without a recorded dose are labelled accordingly |
| Medication status badge | Hardcoded Active for each active medication | Today's medication_events.status by schedule ID/local day; Not recorded when there is no event (never fabricated pending/taken) |
| Care Coordinator | Unconditional No care coordinator is currently assigned | patients.primary_coordinator_id → care_coordinators → profiles; current patient column grants/RLS do not expose the full relationship. Shows Coordinator details are unavailable; no permissions broadened |
| Care Plan | Unconditional No active care plan | Active, date-valid subscriptions joined to care_packages.name; missing package label uses the known Active care plan status rather than an invented package |
| Quick Health Summary: Blood Type | Repeated fixture healthOverview.bloodType | patients.blood_type, using the same loaded overview |
| Quick Health Summary: Allergies | Repeated fixture first allergy | Active patient_allergies.allergen rows |
| Quick Health Summary: Conditions | Repeated fixture first condition | Active patient_conditions.condition_name rows |
| Recommended Care Providers: names, specialties, links | First three fixture-capable directory entries, with invented fallback specialty | Verified doctor providers.id/display_name and recorded specialties; this is a directory selection, not a clinical recommendation engine |
| Vital readings / vital history | Not rendered in this dashboard; no fixture vital value found | vital_readings via getLatestVitals/getVitalHistory; no new cards added |
| Recent health-record timeline/documents | Not rendered here; View Health Records is a navigation link | care_encounters, clinical_documents, medical_history_items via getRecentHealthRecords; no new cards added |
| Recent laboratory results | Not rendered here | lab_results via getRecentLabResults; no new cards added |
| AI summary text / status / recommendations | Not rendered here. Quick Health Summary is an overview, not an AI summary | ai_health_summaries via getLatestAIHealthSummary, with expiry/supersession/visibility filtering; no AI content invented or new card added |

## Changes and limits

The dashboard no longer imports healthPresentationData or the fixture-capable presentationRepository. All displayed dynamic records use dashboardPageService and the existing real Supabase repository abstraction. Section failures are isolated. Missing authentication/configuration produces an error, and empty results produce explicit empty states. Responses are keyed to the current patient and cancelled on identity changes, preventing stale clinical data from appearing after an account switch.

Existing card layout, classes, illustrations, links, and navigation are retained. Changes are limited to data bindings, the accurate Last Health Review label, and loading/error/empty-state text. No clinical thresholds, diagnoses, medication events, notifications, database records, or AI text are generated by this page.

Linked HealthRecordsPage, PrescriptionsPage, and LabResultsPage still have their previously labelled presentation data; replacing those separate screens is outside this dashboard-only change. The landing-page preview also remains marketing content. Prototype accounts do not receive fabricated patient dashboard data.

Tests cover empty/error/loading states, recorded data rendering, absent patient identity, stale responses, patient-scoped calls and section failure isolation. Repository tests use the actual Supabase client with mocked HTTP; existing PostgreSQL integration suites cover database authorization. Hosted end-to-end verification is not claimed.

## Health command-center integration

Dashboard uses the patient-owned `vital_readings` repository contract for blood-pressure history (`systolic_bp`, `diastolic_bp`, `recorded_at`) and computes averages, count, latest value, and a real-reading trend for the selected period. No clinical threshold classification is added.

Today's medication and adherence summaries call `createPatientDashboardRepository.getMedicationDashboardData`, reusing the Medications tab safe `patient_medications` selection and existing medication check-in read contract. PRN doses are excluded from required-dose counts; only stored schedule times are displayed. A failed check-in read does not suppress medication data.

Patient-owned monitoring routines and check-ins use `patientMonitoringService.listMyPlans/listMyCheckIns` and its existing recurrence helper. Patient goals use `patientHealthGoalService.listMyGoals`. Family summary and status use `familyCommandCenterService.load`, which rechecks per-member authorization and expiration. Needs Attention includes explicit open/escalated alerts and due-today monitoring occurrences.

Recent updates merge patient-scoped health records, lab results, existing prescription reads, and stored monitoring, medication, and goal completion timestamps. Health World has no external source yet; future integration needs a trusted public-health feed with source/date attribution, kept separate from personal health data. AI Health Overview remains isolated and cannot block other dashboard sections.

No schema, RLS, grants, authorization, diagnosis rules, or clinical data writes changed. No live Staging or hosted end-to-end verification was performed.
