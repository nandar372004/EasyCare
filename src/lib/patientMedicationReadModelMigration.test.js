import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260821104000_patient_medication_read_model.sql'), 'utf8').toLowerCase()
const seed = readFileSync(join(process.cwd(), 'supabase/demo/seed_patient_medications.sql'), 'utf8').toLowerCase()

describe('patient medication read model', () => {
  it('reuses patient_medications with patient-only ownership', () => {
    expect(sql).toContain('alter table public.patient_medications')
    expect(sql).toContain('patient.auth_user_id = auth.uid()')
    expect(sql).not.toContain('create table public.medications')
    expect(sql).not.toContain('disable row level security')
  })

  it('grants read-only safe columns to authenticated patients', () => {
    expect(sql).toContain('grant select (')
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)/)
    expect(sql).not.toMatch(/grant[^;]+to\s+(anon|public)\b/)
  })

  it('keeps synthetic patient selection manual and idempotent', () => {
    expect(seed).toContain('<replace_with_normalized_patient_phone>')
    expect(seed).toContain('where not exists')
    expect(seed).toContain('synthetic demonstration data only')
    expect(seed).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/)
  })
})
