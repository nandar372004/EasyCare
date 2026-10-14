import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), 'utf8')
const page = readProjectFile('src/features/appointments/AppointmentsPage.jsx')
const fixture = readProjectFile('src/services/repositories/fixtureRepository.js')
const repository = readProjectFile('src/services/repositories/supabaseRepository.js')

describe('current appointment management contract', () => {
  it('keeps real-mode cancel and reschedule controls unavailable until supported RPCs exist', () => {
    expect(page).toContain("const allowLifecycle = presentationRepository.mode !== 'supabase'")
    expect(page).toContain('{allowLifecycle && eligible && <button')
    expect(page).toContain('{allowLifecycle && <button')
    expect(page).toContain('>Reschedule</button>')
    expect(page).toContain('>Cancel appointment</button>')
    expect(repository).toContain("client.rpc('patient_reschedule_appointment'")
    expect(repository).toContain("client.rpc('patient_cancel_appointment'")
  })

  it('preserves the supported fixture lifecycle and its idempotent event contract', () => {
    expect(fixture).toContain('async rescheduleAppointment')
    expect(fixture).toContain('async cancelAppointment')
    expect(fixture).toContain('mutations.has(mutationId)')
    expect(fixture).toContain("eventType: 'appointment_rescheduled'")
    expect(fixture).toContain("eventType: 'appointment_cancelled'")
    expect(fixture).toContain('isFutureEligibleAppointment')
  })
})
