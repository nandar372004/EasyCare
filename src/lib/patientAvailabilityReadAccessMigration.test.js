import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260821101000_patient_availability_read_access.sql'),
  'utf8',
).toLowerCase()

describe('patient availability read access migration', () => {
  it('removes the provider management policy from the patient portal', () => {
    expect(migration).toContain(
      'drop policy if exists availability_provider_manage on public.provider_availability',
    )
  })

  it('allows authenticated patients to read only available safe columns', () => {
    expect(migration).toContain('for select to authenticated')
    expect(migration).toContain("using (status = 'available')")
    expect(migration).toMatch(
      /grant select \(id, provider_id, service_type, start_at, end_at, status\)\s+on table public\.provider_availability to authenticated/,
    )
  })

  it('keeps availability read-only and private', () => {
    expect(migration).toMatch(
      /revoke insert, update, delete\s+on table public\.provider_availability from authenticated/,
    )
    expect(migration).not.toMatch(/to\s+(anon|public)\b/)
    expect(migration).not.toContain('disable row level security')
  })
})
