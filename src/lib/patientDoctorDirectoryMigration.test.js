import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260821100000_patient_doctor_directory.sql'),
  'utf8',
).toLowerCase()

describe('patient doctor directory migration', () => {
  it('uses providers and keeps doctor records independent from Auth users', () => {
    expect(migration).toContain('alter column profile_id drop not null')
    expect(migration).toContain("provider_type, display_name")
    expect(new Set(migration.match(/52000000-0000-4000-8000-00000000000[1-6]/g)).size).toBe(6)
    expect(migration).not.toContain('insert into auth.users')
    expect(migration).not.toContain('create table public.doctors')
  })

  it('grants authenticated patients read-only directory access', () => {
    expect(migration).toContain('using (provider_type = \'doctor\' and verification_status = \'verified\')')
    expect(migration).toContain('on table public.providers to authenticated')
    expect(migration).toContain('on table public.provider_availability to authenticated')
    expect(migration).not.toMatch(/grant\s+(all|insert|update|delete)/)
    expect(migration).not.toMatch(/grant\s+select.*\s+to\s+(anon|public)/)
    expect(migration).not.toContain('disable row level security')
  })

  it('seeds six specialties idempotently and real provider UUID availability', () => {
    expect(migration).toContain('on conflict (name) do nothing')
    expect(migration).toContain('on conflict (id) do update set')
    expect(migration).toContain('insert into public.provider_availability')
  })
})
