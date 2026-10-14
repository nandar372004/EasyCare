import { describe, expect, it, vi } from 'vitest'
import { createPresentationFixtures, PRESENTATION_TIME_ZONE } from '../../data/presentationFixtures.js'
import { formatMmk, formatPresentationDateTime } from '../../lib/presentationFormatting.js'
import { createFixtureRepository } from './fixtureRepository.js'
import { createRepository } from './index.js'
import { createSupabaseRepository } from './supabaseRepository.js'

describe('presentation fixtures', () => {
  it('uses consistent IDs across all shared domains', () => {
    const data = createPresentationFixtures()
    const patientIds = new Set([data.patient.id])
    const doctorIds = new Set(data.doctors.map(({ id }) => id))
    const hospitalIds = new Set(data.hospitals.map(({ id }) => id))
    const slotIds = new Set(data.availabilitySlots.map(({ id }) => id))
    const appointmentIds = new Set(data.appointments.map(({ id }) => id))
    const medicationIds = new Set(data.medications.map(({ id }) => id))

    expect(data.doctors).toHaveLength(4)
    data.doctors.forEach((doctor) => expect(hospitalIds.has(doctor.hospitalId)).toBe(true))
    data.availabilitySlots.forEach((slot) => expect(doctorIds.has(slot.doctorId)).toBe(true))
    data.appointments.forEach((appointment) => {
      expect(patientIds.has(appointment.patientId)).toBe(true)
      expect(doctorIds.has(appointment.doctorId)).toBe(true)
      if (appointment.slotId) expect(slotIds.has(appointment.slotId)).toBe(true)
    })
    data.prescriptions.forEach((item) => {
      expect(patientIds.has(item.patientId)).toBe(true)
      expect(doctorIds.has(item.doctorId)).toBe(true)
      expect(appointmentIds.has(item.appointmentId)).toBe(true)
      item.medicationIds.forEach((id) => expect(medicationIds.has(id)).toBe(true))
    })
    ;[...data.labResults, ...data.messages, ...data.invoices].forEach((item) => {
      expect(patientIds.has(item.patientId)).toBe(true)
      expect(appointmentIds.has(item.appointmentId)).toBe(true)
    })
  })

  it('contains required appointment states and integer MMK values', () => {
    const data = createPresentationFixtures()
    expect(new Set(data.appointments.map(({ status }) => status))).toEqual(new Set(['confirmed', 'completed', 'cancelled']))
    ;[...data.doctors.map(({ consultationFeeMmk }) => consultationFeeMmk), ...data.appointments.map(({ feeMmk }) => feeMmk), ...data.invoices.map(({ amountMmk }) => amountMmk)]
      .forEach((value) => expect(Number.isInteger(value)).toBe(true))
  })

  it('marks every person, record, payment, and facility as synthetic', () => {
    const data = createPresentationFixtures()
    expect(data.patient.isSynthetic).toBe(true)
    ;['hospitals', 'doctors', 'appointments', 'medications', 'prescriptions', 'labResults', 'messages', 'invoices', 'nearbyFacilities']
      .forEach((collection) => data[collection].forEach((item) => expect(item.isSynthetic).toBe(true)))
    expect(data.healthSummary).toMatchObject({ isSynthetic: true, readOnly: true })
  })
})

describe('fixture repository', () => {
  it('returns defensive copies and resets deterministically', async () => {
    const repository = createFixtureRepository()
    const first = await repository.listDoctors()
    first[0].displayName = 'mutated outside repository'
    expect((await repository.listDoctors())[0].displayName).toBe('Dr. Demo Aster')
    repository.reset()
    expect(await repository.listDoctors()).toEqual(createPresentationFixtures().doctors)
  })

  it('filters repository collections without moving arrays into UI state', async () => {
    const repository = createFixtureRepository()
    expect(await repository.listAppointments({ status: 'completed' })).toHaveLength(1)
    expect(await repository.listAvailabilitySlots({ doctorId: 'doctor-demo-001' })).toHaveLength(5)
    expect(repository.metadata).toMatchObject({ isSynthetic: true, displayTimeZone: PRESENTATION_TIME_ZONE, readOnlyClinicalContent: true })
  })

  it('creates one active booking per slot and replays the same idempotency key', async () => {
    const repository = createFixtureRepository()
    const input = { idempotencyKey: 'idempotency-1', patientId: 'patient-demo-001', doctorId: 'doctor-demo-001', slotId: 'slot-demo-001', consultationType: 'video', symptoms: 'Optional reason', paymentMethod: 'presentation_card', feeMmk: 25000 }
    const first = await repository.createAppointment(input)
    const replay = await repository.createAppointment(input)
    expect(replay).toEqual(first)
    expect((await repository.listAppointments())[0]).toMatchObject({ id: first.id, symptoms: 'Optional reason', status: 'confirmed' })
    await expect(repository.createAppointment({ ...input, idempotencyKey: 'idempotency-2' })).rejects.toMatchObject({ code: 'SLOT_CONFLICT' })
  })

  it('reschedules atomically, releases the old slot, and records an idempotent event', async () => {
    const repository = createFixtureRepository()
    const now = new Date('2026-08-13T00:00:00.000Z')
    const input = { appointmentId: 'appointment-demo-upcoming-001', slotId: 'slot-demo-001', mutationKey: 'reschedule-key', now }
    const changed = await repository.rescheduleAppointment(input)
    expect(changed).toMatchObject({ slotId: 'slot-demo-001', scheduledAt: '2026-08-20T02:30:00.000Z' })
    expect((await repository.listAvailabilitySlots()).find(({ id }) => id === 'slot-demo-004').status).toBe('available')
    expect((await repository.listAvailabilitySlots()).find(({ id }) => id === 'slot-demo-001').status).toBe('booked')
    await repository.rescheduleAppointment(input)
    expect((await repository.listAppointmentEvents(input.appointmentId)).filter(({ eventType }) => eventType === 'appointment_rescheduled')).toHaveLength(1)
  })

  it('cancels a future appointment once, releases its slot, and rejects terminal lifecycle changes', async () => {
    const repository = createFixtureRepository()
    const now = new Date('2026-08-13T00:00:00.000Z')
    const input = { appointmentId: 'appointment-demo-upcoming-001', reason: 'Schedule changed', mutationKey: 'cancel-key', now }
    const cancelled = await repository.cancelAppointment(input)
    expect(cancelled).toMatchObject({ status: 'cancelled', cancellationReason: 'Schedule changed' })
    expect((await repository.listAvailabilitySlots()).find(({ id }) => id === 'slot-demo-004').status).toBe('available')
    await repository.cancelAppointment(input)
    expect((await repository.listAppointmentEvents(input.appointmentId)).filter(({ eventType }) => eventType === 'appointment_cancelled')).toHaveLength(1)
    await expect(repository.cancelAppointment({ ...input, appointmentId: 'appointment-demo-completed-001', mutationKey: 'terminal-key' })).rejects.toMatchObject({ code: 'APPOINTMENT_INELIGIBLE' })
    expect(await repository.getAppointment('another-patients-appointment')).toBeNull()
  })
})

describe('repository adapters', () => {
  it('selects fixture mode explicitly and rejects missing Supabase clients', () => {
    expect(createRepository({ mode: 'fixture' }).mode).toBe('fixture')
    expect(() => createRepository({ mode: 'supabase', client: null })).toThrow(/configured client/)
  })

  it('keeps Supabase queries in the remote adapter and forbids remote reset', async () => {
    const rows = [{
      id: '52000000-0000-4000-8000-000000000001', provider_type: 'doctor', display_name: 'Dr. Synthetic Test',
      qualification: 'Synthetic qualification', verification_status: 'verified', years_experience: 9,
      languages: ['my', 'en'], service_area: { hospital: 'Synthetic Clinic', city: 'Yangon' },
      teleconsult_enabled: true, home_visit_enabled: false, consultation_fee_mmk: 25000, rating_average: '4.80',
      provider_specialties: [{ is_primary: true, specialties: { name: 'General Practitioner' } }],
    }]
    const query = { select: vi.fn(), eq: vi.fn(), then: (resolve) => Promise.resolve({ data: rows, error: null }).then(resolve) }
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query)
    const from = vi.fn(() => query)
    const repository = createSupabaseRepository({ from })
    expect(await repository.listDoctors()).toEqual([expect.objectContaining({
      id: '52000000-0000-4000-8000-000000000001', displayName: 'Dr. Synthetic Test',
      specialty: 'General Practitioner', consultationFeeMmk: 25000, consultationTypes: ['video', 'voice'],
    })])
    expect(from).toHaveBeenCalledWith('providers')
    expect(query.eq).toHaveBeenCalledWith('provider_type', 'doctor')
    expect(query.eq).toHaveBeenCalledWith('verification_status', 'verified')
    expect(repository.reset).toThrow(/unsupported/)
  })

  it('reads prescription items and existing prescriber names through the patient scoped query', async () => {
    const rows = [{
      id: 'prescription-1', patient_id: 'patient-1', doctor_provider_id: 'provider-1', status: 'active',
      instructions: 'Prescription instructions', issued_at: '2026-08-01T00:00:00Z',
      prescriber: { display_name: 'Dr. Recorded' },
      prescription_items: [{ id: 'item-1', medication_name: 'Recorded medicine', strength: '10 mg', dose: '1 tablet', route: 'oral', frequency: 'Once daily', duration_days: 5, instructions: 'Recorded use' }],
    }]
    const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), then: resolve => Promise.resolve({ data: rows, error: null }).then(resolve) }
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query)
    const from = vi.fn(() => query)
    const repository = createSupabaseRepository({ from })
    const result = await repository.listPrescriptions('patient-1')
    expect(from).toHaveBeenCalledWith('prescriptions')
    expect(query.eq).toHaveBeenCalledWith('patient_id', 'patient-1')
    expect(query.select.mock.calls[0][0]).toContain('prescription_items(')
    expect(result).toEqual([expect.objectContaining({
      id: 'prescription-1', itemId: 'item-1', medicine: 'Recorded medicine', strength: '10 mg',
      dosage: '1 tablet', frequency: 'Once daily', duration: '5 days', instructions: 'Recorded use', doctor: 'Dr. Recorded',
    })])
  })

  it('keeps medication reads within the authenticated read grant', async () => {
    const rows = [
      { id: 'med-1', patient_id: 'patient-1', medication_name: 'Recorded medicine', dose: '1 tablet', frequency: 'Daily', instructions: 'Recorded directions', start_date: '2026-08-01', end_date: null, status: 'active', medication_schedules: [] },
      { id: 'med-synthetic', patient_id: 'patient-1', medication_name: 'Cetirizine', dose: '10 mg', frequency: 'Once daily', instructions: 'Synthetic record: take in the evening', start_date: '2026-08-01', end_date: null, status: 'active', medication_schedules: [] },
      { id: 'med-demo', patient_id: 'patient-1', medication_name: 'Demo record: Paracetamol', dose: '500 mg', frequency: 'Every 8 hours', instructions: 'Sample directions', start_date: '2026-08-01', end_date: null, status: 'active', medication_schedules: [] },
    ]
    const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), then: resolve => Promise.resolve({ data: rows, error: null }).then(resolve) }
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query)
    const repository = createSupabaseRepository({ from: vi.fn(() => query) })
    const result = await repository.listMedications('51000000-0000-4000-8000-000000000001')
    const columns = query.select.mock.calls[0][0]
    expect(columns).not.toContain('prescription_item_id')
    expect(columns).not.toContain('prescribing_provider_id')
    expect(columns).not.toContain('reason_for_medication')
    expect(result[0]).toMatchObject({ name: 'Recorded medicine', dosage: '1 tablet', frequency: 'Daily', status: 'active' })
    expect(result[0]).not.toHaveProperty('source')
    expect(result[0]).not.toHaveProperty('relatedPrescription')
    expect(result).toHaveLength(1)
    expect(result.map(item => item.name)).toEqual(['Recorded medicine'])
  })

  it('reads only the patient Zoom join URL through the appointment-owned read', async () => {
    const row = { id: 'appointment-1', patient_id: 'patient-1', provider_id: 'provider-1', appointment_type: 'teleconsultation', consultation_channel: 'video', scheduled_start: '2099-01-01T00:00:00Z', scheduled_end: '2099-01-01T00:30:00Z', status: 'confirmed', teleconsultation_sessions: { join_url_patient: 'https://zoom.us/j/123' } }
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) }
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query)
    const repository = createSupabaseRepository({ from: vi.fn(() => query) })
    const result = await repository.getAppointment('appointment-1', { patientId: 'patient-1' })
    const columns = query.select.mock.calls[0][0]
    expect(columns).toContain('teleconsultation_sessions(join_url_patient)')
    expect(columns).not.toContain('join_url_provider')
    expect(result).toMatchObject({ appointmentType: 'teleconsultation', consultationType: 'video', joinUrl: 'https://zoom.us/j/123' })
    expect(query.eq).toHaveBeenCalledWith('id', 'appointment-1')
    expect(query.eq).toHaveBeenCalledWith('patient_id', 'patient-1')
  })

})

describe('presentation formatting', () => {
  it('formats timestamps in Asia/Yangon and enforces integer MMK', () => {
    expect(formatPresentationDateTime('2026-08-20T02:30:00.000Z', 'en-US')).toContain('9:00 AM')
    expect(formatMmk(25000, 'en-US')).toBe('25,000 MMK')
    expect(() => formatMmk(25.5)).toThrow(/integers/)
  })
})
