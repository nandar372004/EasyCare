import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260821090000_patient_registration_service_role_lookup.sql'),
  'utf8',
).toLowerCase()

describe('patient registration service-role grant', () => {
  it('grants only the duplicate lookup columns to service_role', () => {
    expect(migration).toContain('grant select (id, primary_phone) on table public.patients to service_role')
    expect(migration).not.toMatch(/grant\s+(all|insert|update|delete).*patients/)
    expect(migration).not.toMatch(/grant\s+select.*patients\s+to\s+(anon|authenticated|public)/)
    expect(migration).not.toContain('disable row level security')
  })

  it('preserves server-only execution of the registration RPC', () => {
    expect(migration).toContain('revoke all on function public.create_patient_registration(jsonb) from public')
    expect(migration).toContain('grant execute on function public.create_patient_registration(jsonb) to service_role')
  })
})
