# MediBridge AI Supabase preparation

This directory contains versioned SQL for the presentation database. Nothing in
this directory is applied automatically to a remote project, and the React app
continues to use fixture mode until a later integration phase.

## Managed identity boundary

Supabase `auth.users` is the sole identity source. The application schema keeps
only `public.profiles.id`, which references `auth.users(id)` with cascading
deletion. There is no custom users table and no password column.

Create synthetic local Auth identities through the Supabase Auth Admin API or
Dashboard. Never insert password hashes with SQL and never place a secret or
service-role key in browser configuration.

The browser configuration remains limited to:

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

## Migration order

Apply migrations strictly by filename:

1. `20260810000000_core_presentation_schema.sql` creates enums, tables,
   constraints, indexes, and enables default-deny RLS.
2. `20260810000100_patient_registration_security.sql` is the previously
   prepared additive patient-registration layer and is intentionally unchanged.
3. `20260810000200_phase4_schema_rls.sql` aligns final Phase 4 column names,
   consolidates emergency contact JSON, adds lifecycle triggers, replaces the
   interim policies, and grants minimum browser privileges.

The final schema uses `profiles.phone`, `patients.date_of_birth`, and
`patients.address_city`. Compatibility columns required only between migration
steps are removed by the final migration.

## Local application and verification

Install and initialize the Supabase CLI separately when local database testing
is approved. Then run:

```sh
supabase db reset
supabase test db
supabase db lint
```

The database tests include catalog checks and negative authorization cases for
patient, provider, and anonymous roles. Always test migrations against a fresh
local database and a copy of the expected target schema before considering a
remote deployment.

## Synthetic identities and seed safety

`seed.sql` contains synthetic domain records only. It expects two managed Auth
identities with these fixed synthetic UUIDs:

- Patient: `10000000-0000-4000-8000-000000000001`
- Provider: `20000000-0000-4000-8000-000000000001`

Create those identities through local Supabase Auth; do not add them to a
custom table. The seed refuses to run unless the database session explicitly
sets both:

```sql
set app.environment = 'local'; -- or test/demo
set app.allow_synthetic_seed = 'on';
```

Pass these as session settings for the same connection that executes
`supabase/seed.sql`. Production, missing, or unknown environments are rejected.

The reset script deletes only fixed synthetic domain UUIDs and does not delete
managed Auth identities. It separately requires:

```sql
set app.environment = 'local'; -- or test/demo
set app.allow_synthetic_reset = 'on';
```

## RLS verification checklist

Inspect all effective policies before deployment:

```sql
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

Verify manually with synthetic JWTs:

- Anonymous users cannot read profiles, patients, appointments, or events.
- Anonymous users see only verified public providers and future available slots.
- A patient sees and changes only their own profile, patient row, and appointment.
- A patient cannot change role, ownership IDs, consent timestamps, fees, or audit data.
- A provider sees only appointments assigned to their provider record and cannot
  read the patient's medical-profile table.
- A provider can manage only their own availability rows.
- No browser role can create a provider record or delete sensitive records.
- Two active appointments cannot allocate the same availability slot.
- Cancellation releases a future slot; completed/no-show slots remain blocked.

## Remote application

No remote migration is authorized in this phase. Before a future push:

1. Run a fresh local reset, database tests, and lint.
2. Compare the target schema and all existing policies.
3. Take or verify a recoverable backup.
4. Run `supabase db push --dry-run` and review every statement.
5. Apply first to an approved non-production project.

Fixture mode remains unaffected because no frontend repository or registration
service imports these SQL files.

## Phase 5 phone/password authentication

Patient registration is implemented as the public `patient-register` Edge
Function. The browser submits the validated form to this function; it repeats
validation, canonicalizes Myanmar phone numbers, derives a SHA-256 internal
email identifier, creates an email-confirmed managed Auth user, and calls the
service-role-only `create_patient_registration` database function.

The internal email is never shown to the user. No OTP or user-facing email is
used. If profile/patient persistence fails, the Edge Function attempts to delete
the newly created managed Auth user before returning a generic error.

### Rate limits

Registration is limited to five attempts per forwarded client address per
15-minute window. The address is combined with a secret pepper and hashed
before database storage. Set a strong random pepper only in the Edge Function
environment:

```sh
supabase secrets set AUTH_RATE_LIMIT_PEPPER="<strong-random-value>" \
  ALLOWED_ORIGINS="https://your-approved-app.example"
```

Password login calls Supabase Auth `signInWithPassword` directly. Before any
non-local deployment, configure Supabase Auth password/token endpoint rate
limits and bot protection in the Dashboard. Do not rely on client-side delays
as a security control.

### Local validation and deployment commands

The CLI is not available in the current workspace, so none of these commands
has been run. When authorized later:

```sh
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db reset
supabase test db
supabase functions serve patient-register --no-verify-jwt
supabase db push --dry-run
supabase db push
supabase functions deploy patient-register --project-ref <PROJECT_REF>
```

`verify_jwt = false` is intentional only for this public registration endpoint.
The function enforces origin allowlisting, server-side validation, database
rate limiting, generic errors, and server-only admin credentials.

Hosted Edge Functions provide `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. Never add the latter to `.env.example`, a `VITE_`
variable, browser source, logs, or deployment output.

### Synthetic authentication checks

Use only synthetic phone numbers and profiles. Verify registration, duplicate
handling, malformed and weak-password rejection, orphan cleanup, valid/invalid
login, refresh restoration, route redirects, role lookup, and local-scope
logout before approving a deployment. Forgot-password verification remains a
simulated/deferred screen and must not claim an OTP was sent.
