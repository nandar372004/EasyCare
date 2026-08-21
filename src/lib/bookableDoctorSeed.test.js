import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260813000300_seed_bookable_test_doctors.sql'), 'utf8')

describe('bookable database doctor seed', () => {
  it('creates exactly ten verified catalog doctors with test Gmail contacts', () => {
    const providerIds = sql.match(/'51000000-0000-4000-8000-0000000000(?:0[1-9]|10)'/g) ?? []
    expect(new Set(providerIds).size).toBe(10)
    expect(sql.match(/easycare\.test@gmail\.com/g)).toHaveLength(10)
    expect(sql).toContain("verification_status = 'verified'")
    expect(sql).toContain('is_catalog_record = true')
  })

  it('preserves login identity requirements and supplies reschedulable real slots', () => {
    expect(sql).toMatch(/is_catalog_record and profile_id is null/)
    expect(sql).toMatch(/not is_catalog_record and profile_id is not null/)
    expect(sql).not.toMatch(/grant select \(contact_email\) on public\.providers to anon/)
    expect(sql).toContain("(8, 'home_visit'::public.consultation_type)")
    expect(sql).toContain('on conflict (provider_id, starts_at, consultation_type) do nothing')
  })
})
