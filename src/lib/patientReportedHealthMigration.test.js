import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/20261005110000_patient_reported_health_intake.sql', 'utf8').toLowerCase()

describe('patient-reported health intake migration boundary', () => {
  it('uses a dedicated report store without granting direct browser table access', () => {
    expect(sql).toContain('create table public.patient_reported_health_items')
    expect(sql).toContain("source text not null default 'patient_reported' check (source='patient_reported')")
    expect(sql).toContain("verification_status text not null default 'unverified'")
    expect(sql).toContain('revoke all on public.patient_reported_health_items from public, anon, authenticated')
    expect(sql).not.toMatch(/grant\s+[^;]*on\s+(table\s+)?public\.patient_reported_health_items\s+to\s+(authenticated|anon)/)
  })

  it('derives ownership from auth.uid and keeps reported medication outside canonical medication authority', () => {
    for (const fn of ['get_my_reported_health_intake', 'save_my_reported_blood_type', 'add_my_reported_health_item', 'update_my_reported_health_item', 'archive_my_reported_health_item']) {
      expect(sql).toContain(`grant execute on function public.${fn}`)
    }
    expect(sql).toContain('p.auth_user_id=auth.uid()')
    expect(sql).toContain('reported_by_user_id=auth.uid()')
    expect(sql).not.toMatch(/insert\s+into\s+public\.(patient_allergies|patient_conditions|patient_medications|prescriptions|prescription_items|medication_schedules)/)
    expect(sql).not.toMatch(/patient_id\s+uuid[^;]*p_patient_id/)
    expect(sql).toContain('revoke update (blood_type) on public.patients from authenticated')
  })

  it('copies legacy preference text forward without deleting the source values', () => {
    expect(sql).toContain("p.care_preferences->>'allergies'")
    expect(sql).toContain("p.care_preferences->>'existingmedicalconditions'")
    expect(sql).toContain("p.care_preferences->>'currentmedications'")
    expect(sql).toContain("'care_preferences:allergies'")
    expect(sql).not.toMatch(/delete\s+from\s+public\.patients/)
    expect(sql).not.toMatch(/update\s+public\.patients\s+set\s+care_preferences/)
  })
})
