import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/20261011100000_patient_reported_vaccinations.sql', 'utf8').toLowerCase()

describe('patient-reported vaccination migration boundary', () => {
  it('extends the existing patient-reported store without adding a duplicate table or touching RLS', () => {
    expect(sql).toContain("check (item_type in ('allergy','condition','medication','vaccination'))")
    expect(sql).not.toMatch(/create\s+table/)
    expect(sql).not.toMatch(/create\s+policy|drop\s+policy|enable\s+row\s+level\s+security|disable\s+row\s+level\s+security/)
    expect(sql).not.toMatch(/grant\s+[^;]*on\s+(table\s+)?public\.patient_reported_health_items/)
  })

  it('adds only session-bound owner checked functions and keeps patient reports explicitly unverified', () => {
    for (const name of ['add_my_reported_vaccination', 'update_my_reported_vaccination']) {
      expect(sql).toContain(`grant execute on function public.${name}`)
      expect(sql).toContain(`revoke all on function public.${name}`)
    }
    expect(sql).toContain('p.auth_user_id=auth.uid()')
    expect(sql).toContain('i.reported_by_user_id=auth.uid()')
    expect(sql).toContain("'vaccination','item'")
    expect(sql).not.toMatch(/set\s+[^;]*verification_status\s*=/)
    expect(sql).toContain("where item_type='vaccination' and entry_kind='item' and record_status='active'")
  })
})
