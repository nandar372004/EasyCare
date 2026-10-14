import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260821100000_patient_doctor_directory.sql'), 'utf8')

describe('current patient doctor directory seed', () => {
  it('seeds six verified synthetic doctor catalog records without assigning login profiles', () => {
    const providerIds = sql.match(/'52000000-0000-4000-8000-00000000000[1-6]'/g) ?? []
    expect(new Set(providerIds).size).toBe(6)
    expect(sql.match(/'verified', \d+, '/g)).toHaveLength(6)
    expect(sql.match(/'Synthetic MBBS/g)).toHaveLength(6)
    expect(sql).toContain('id, profile_id, provider_type, display_name')
    expect(sql).toContain("'doctor'")
    expect(sql).toContain('profile_id,')
    expect(sql).toContain('null, \'doctor\'')
    expect(sql).not.toMatch(/easycare\.test@gmail\.com/)
  })

  it('supplies the current future availability catalog and exposes only verified doctors and available slots', () => {
    const slotIds = sql.match(/'53000000-0000-4000-8000-00000000000[1-9]'/g) ?? []
    expect(new Set(slotIds).size).toBe(9)
    expect(sql).toContain("'home_visit'")
    expect(sql).toContain("'teleconsultation'")
    expect(sql).toContain("using (provider_type = 'doctor' and verification_status = 'verified')")
    expect(sql).toContain("using (status = 'available')")
    expect(sql).toContain('on conflict (id) do update')
  })

  it('does not expose sensitive provider contact fields to the patient directory', () => {
    expect(sql).not.toMatch(/grant select \([^)]*contact_email/is)
    expect(sql).not.toMatch(/grant select \([^)]*license_number/is)
  })
})
