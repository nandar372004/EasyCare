import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260821102000_patient_appointment_booking.sql'),
  'utf8',
).toLowerCase()

describe('patient appointment booking migration', () => {
  it('preserves the deployed service mode while storing three patient channels', () => {
    expect(sql).toContain("consultation_channel in ('video', 'voice')")
    expect(sql).toContain("consultation_channel = 'home_visit'")
    expect(sql).not.toContain('alter type public.service_mode')
  })

  it('enforces patient ownership, verified doctors, and real available slots', () => {
    expect(sql).toContain('patient.auth_user_id = auth.uid()')
    expect(sql).toContain("provider.provider_type = 'doctor'")
    expect(sql).toContain("provider.verification_status = 'verified'")
    expect(sql).toContain("availability.status = 'available'")
    expect(sql).toContain('availability.provider_id = appointments.provider_id')
  })

  it('grants authenticated patients only select and insert', () => {
    expect(sql).toMatch(/grant select \([\s\s]*[\s\S]*?\) on table public\.appointments to authenticated/)
    expect(sql).toMatch(/grant insert \([\s\S]*?\) on table public\.appointments to authenticated/)
    expect(sql).not.toMatch(/grant\s+(update|delete|all)/)
    expect(sql).not.toMatch(/to\s+(anon|public)\b/)
    expect(sql).not.toContain('disable row level security')
  })
})
