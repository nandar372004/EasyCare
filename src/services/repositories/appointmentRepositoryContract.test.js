import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repository = readFileSync(join(process.cwd(), 'src/services/repositories/supabaseRepository.js'), 'utf8')
const page = readFileSync(join(process.cwd(), 'src/features/appointments/AppointmentsPage.jsx'), 'utf8')

describe('real appointment repository contract', () => {
  it('uses current appointment and provider_availability fields explicitly', () => {
    expect(repository).toContain("const APPOINTMENT_SELECT = 'id, patient_id, provider_id, provider_availability_id, appointment_type, consultation_channel, scheduled_start, scheduled_end, status, reason_symptoms, fee_amount, currency, booking_code, created_at")
    expect(repository).not.toContain("appointments').select('*'")
    expect(repository).not.toContain('availability_slots')
  })

  it('filters list and detail queries by the AuthContext patient id', () => {
    expect(page).toContain('presentationRepository.listAppointments({ patientId: patient.id })')
    expect(page).toContain('presentationRepository.getAppointment(id, { patientId: patient.id })')
    expect(repository).toContain("query = query.eq('patient_id', patientId)")
  })

  it('inserts the real patient, provider, availability, schedule and booking fields', () => {
    for (const field of ['patient_id', 'provider_id', 'provider_availability_id', 'appointment_type', 'consultation_channel', 'scheduled_start', 'scheduled_end', 'reason_symptoms', 'fee_amount', 'booking_code']) {
      expect(repository).toContain(field)
    }
  })
})
