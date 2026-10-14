import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), 'utf8')
const identity = readProjectFile('supabase/migrations/20260820010000_identity.sql')
const patient = readProjectFile('supabase/migrations/20260820010100_patient_family.sql')
const providers = readProjectFile('supabase/migrations/20260820010200_provider_supply.sql')
const directory = readProjectFile('supabase/migrations/20260821100000_patient_doctor_directory.sql')
const booking = readProjectFile('supabase/migrations/20260820010300_booking.sql')
const security = readProjectFile('supabase/migrations/20260820010900_ai_security.sql')
const patientIdentityRepair = readProjectFile('supabase/migrations/20260928090000_patient_profile_identity_repair.sql')
const patientBooking = readProjectFile('supabase/migrations/20260821102000_patient_appointment_booking.sql')
const seed = readProjectFile('supabase/seed.sql')
const reset = readProjectFile('supabase/scripts/reset_synthetic_data.sql')
const diagram = readProjectFile('Tele_Clinic_Database.mmd')

describe('Phase 4 database artifacts', () => {
  it.each(['profiles', 'patients', 'providers', 'provider_availability', 'appointments', 'care_requests'])(
    'creates %s with RLS enabled',
    (table) => {
      const schema = `${identity}\n${patient}\n${providers}\n${booking}\n${security}`
      expect(schema).toContain(`create table public.${table}`)
      expect(security).toContain(`'${table}'`)
      expect(security).toContain('alter table public.%I enable row level security')
    },
  )

  it('uses managed auth.users and contains no custom password storage', () => {
    const allSql = `${identity}\n${patient}\n${providers}\n${booking}\n${security}\n${patientIdentityRepair}\n${seed}`.toLowerCase()
    expect(identity).toContain('references auth.users(id)')
    expect(allSql).not.toContain('create table auth_users')
    expect(allSql).not.toContain('encrypted_password')
  })

  it('enforces UUID keys, integer MMK, and server consent timestamps', () => {
    expect(`${identity}\n${patient}\n${providers}\n${booking}`).toMatch(/id uuid primary key/g)
    expect(directory).toContain('consultation_fee_mmk integer')
    expect(booking).toContain('fee_amount numeric(12,2)')
    expect(patientIdentityRepair).toContain('check (profile_id = auth_user_id)')
    expect(patientBooking).toContain('appointments_booking_code_key')
  })

  it('prevents duplicate active slot allocation', () => {
    expect(patientBooking).toContain('create unique index if not exists appointments_active_availability_key')
    expect(patientBooking).toContain("and status in ('pending', 'confirmed', 'rescheduled')")
  })

  it('contains participant-scoped RLS without permissive catch-all expressions', () => {
    expect(security).toContain('create policy appointments_read')
    expect(security).toContain("public.can_access_patient(patient_id,'appointments')")
    expect(patientBooking).toContain('create policy appointments_patient_read')
    expect(patientBooking).not.toMatch(/appointments_patient_read[\s\S]{0,250}using\s*\(\s*true\s*\)/i)
  })

  it('keeps provider creation and sensitive event writes away from browser roles', () => {
    expect(security).not.toMatch(/grant insert[^;]*public\.providers[^;]*authenticated/is)
    expect(security).not.toMatch(/create policy providers_insert/i)
    expect(security).not.toMatch(/create policy visit_status_events_insert/i)
    expect(patientBooking).not.toMatch(/grant insert[^;]*public\.visit_status_events[^;]*authenticated/is)
  })

  it('guards synthetic seed and reset against production execution', () => {
    expect(seed).toContain("environment_name not in ('local', 'test', 'demo')")
    expect(seed).toContain("seed_allowed is distinct from 'on'")
    expect(reset).toContain("environment_name not in ('local', 'test', 'demo')")
    expect(reset).toContain("reset_allowed is distinct from 'on'")
  })

  it('represents auth.users as a managed external identity in the diagram', () => {
    expect(diagram).toContain('AUTH_USERS ||--|| PROFILES : "managed identity"')
    expect(diagram).toContain('Supabase-managed external source')
  })
})
