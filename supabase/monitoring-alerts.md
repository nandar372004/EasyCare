# Phase 8 monitoring alerts

`monitoring_alerts` represents a health/system condition. `notifications` remains the separate delivery record. The migration does not create delivery rows, alter notification policies, evaluate measurements, or define medical thresholds.

Five nullable metadata fields are added to the existing alert table:

| Field | Type | Meaning |
| --- | --- | --- |
| source_type | text | vital, lab, medication, appointment, ai, or manual |
| source_id | uuid | Optional originating record ID, qualified by source_type |
| title | text | Optional nonblank title, up to 200 characters |
| rule_code | text | Optional nonblank producer rule identifier, up to 100 characters |
| detected_at | timestamptz | Finite detection time; defaults to statement time for new rows |

Existing alert fields, statuses, foreign keys, and records are preserved. Historical vital references populate source_type/source_id; other historical sources remain NULL rather than being guessed. Finite created_at values populate detected_at as the best available historical time, not a claim of precise clinical detection. Existing titles and rules are not invented. Old insert payloads still work; NULL metadata remains permitted.

The legacy vital_reading_id FK remains available. When generic source metadata and this FK are both supplied, they must agree. Producers changing an existing vital reference must update its source metadata together. Generic source_id is polymorphic and has no cross-table FK: authorized producers must validate source existence and ownership before writing it. For vital alerts, use vital_reading_id too to retain database FK protection. Defining new source-producing workflows is outside this phase.

Existing patient/status/time indexes remain. A partial source_type/source_id index supports provenance lookup without indexing unlinked alerts.

Read access continues through can_access_patient(patient_id, 'alerts'), including patient ownership, authorized family alert permissions, verified care relationships, assigned coordinators, and existing admin authority. Existing clinician creation permissions remain. The reviewer UPDATE policy now checks authorization for the resulting patient as well as the original row and reviewer identity, preventing reassignment to an unauthorized patient. No patient write policy or additional grants are added.

Tests apply the migration chain to isolated PostgreSQL with simulated managed Auth and Storage schemas. They verify data preservation, metadata constraints/backfill, legacy inserts, existing FKs, notification independence, patient/clinical/family/coordinator access, anonymous denial, and the reviewer reassignment regression. Hosted deployment/data validation remains separate.
