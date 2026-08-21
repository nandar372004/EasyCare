import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260820011100_simplify_patient_auth.sql'),
  'utf8',
)
const registrationFunction = migration.slice(migration.indexOf('create or replace function public.create_patient_registration'))

describe('simplified patient authentication migration', () => {
  it('links patients directly to managed Auth users', () => {
    expect(migration).toContain('auth_user_id uuid references auth.users(id)')
    expect(migration).toContain('create unique index patients_auth_user_uidx')
    expect(migration).toContain('patient.auth_user_id = auth.uid()')
    expect(migration).toContain('patients_protect_auth_fields')
  })

  it('registers patient data without creating a profile', () => {
    expect(registrationFunction).toContain('insert into public.patients')
    expect(registrationFunction).not.toContain('insert into public.profiles')
  })

  it('keeps appointments on the existing patient and doctor/provider keys', () => {
    expect(migration).toContain('alter table public.appointments alter column booked_by_profile_id drop not null')
    expect(migration).toContain('patient.id = appointments.patient_id')
  })
})
