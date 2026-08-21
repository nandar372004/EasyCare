import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260821091000_patient_authenticated_self_read.sql'),
  'utf8',
).toLowerCase()

describe('authenticated patient self-read migration', () => {
  it('grants only the columns used to hydrate the current patient', () => {
    expect(migration).toMatch(/grant select\s*\(\s*id,\s*auth_user_id,\s*full_name,\s*primary_phone,\s*preferred_language,\s*status\s*\)\s*on table public\.patients to authenticated/)
    expect(migration).not.toMatch(/grant\s+(all|insert|update|delete).*patients/)
    expect(migration).not.toMatch(/grant\s+select.*patients\s+to\s+(anon|public)/)
  })

  it('keeps RLS restricted to the signed-in patient row', () => {
    expect(migration).toContain('drop policy if exists patients_read_own on public.patients')
    expect(migration).toMatch(/create policy patients_read_own on public\.patients\s+for select to authenticated\s+using \(auth_user_id = auth\.uid\(\)\)/)
    expect(migration).not.toContain('disable row level security')
    expect(migration).not.toContain('using (true)')
  })
})
