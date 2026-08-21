import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260813000200_phase9_appointment_management.sql'), 'utf8')

describe('Phase 9 appointment management migration', () => {
  it('uses authenticated ownership checks, row locks, and future eligibility', () => {
    expect(sql).toMatch(/p\.profile_id = auth\.uid\(\)/)
    expect(sql).toMatch(/for update of a/i)
    expect(sql).toMatch(/starts_at > statement_timestamp\(\)/)
  })

  it('provides replay-safe reschedule and cancellation functions', () => {
    expect(sql).toMatch(/primary key \(appointment_id, mutation_key, mutation_type\)/)
    expect(sql).toMatch(/patient_reschedule_appointment/)
    expect(sql).toMatch(/patient_cancel_appointment/)
    expect(sql).toMatch(/appointment_rescheduled/)
    expect(sql).toMatch(/appointment_cancelled/)
  })
})
