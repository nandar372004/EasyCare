import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260810000100_patient_registration_security.sql',
)
const migration = readFileSync(migrationPath, 'utf8')

describe('patient registration migration security contract', () => {
  it('enables RLS and denies anonymous table privileges', () => {
    expect(migration).toContain('alter table public.profiles enable row level security')
    expect(migration).toContain('alter table public.patients enable row level security')
    expect(migration).toContain('revoke all privileges on table public.profiles from anon')
    expect(migration).toContain('revoke all privileges on table public.patients from anon')
  })

  it('uses auth.uid ownership checks for profiles and patients', () => {
    expect(migration).toContain('id = (select auth.uid())')
    expect(migration).toContain('profile_id = (select auth.uid())')
  })

  it('prevents browser updates to role and ownership columns', () => {
    const profileUpdateGrant = migration.match(/grant update \([^)]+\)\s+on table public\.profiles to authenticated;/s)?.[0]
    const patientUpdateGrant = migration.match(/grant update \([^)]+\)\s+on table public\.patients to authenticated;/s)?.[0]
    expect(profileUpdateGrant).not.toContain('role')
    expect(profileUpdateGrant).not.toContain('id')
    expect(patientUpdateGrant).not.toContain('profile_id')
  })

  it('does not grant delete access to browser roles', () => {
    expect(migration).not.toMatch(/grant delete .* to (anon|authenticated)/i)
  })

  it('contains no frontend service-role configuration', () => {
    expect(migration).not.toContain('VITE_SUPABASE_SERVICE')
  })
})
