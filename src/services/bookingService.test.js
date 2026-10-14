import { describe, expect, it } from 'vitest'
import { BookingConflictError, PAYMENT_NOTICE, canJoinWaitingRoom, canShowConsultationJoin, isFutureEligibleAppointment, safeZoomJoinUrl, validateBooking } from './bookingService.js'

const doctor = { id: 'doctor-1' }
const valid = { doctor, patientId: 'patient-1', consultationType: 'video', paymentMethod: 'presentation_card', symptoms: 'Headache', slot: { id: 'slot-1', doctorId: 'doctor-1', consultationType: 'video', status: 'available', startsAt: '2026-08-20T02:30:00.000Z' } }

describe('booking validation', () => {
  it('accepts an available matching future slot and keeps symptoms optional', () => {
    expect(validateBooking({ ...valid, symptoms: '' }, new Date('2026-08-13T00:00:00.000Z'))).toBe(true)
    expect(validateBooking({ ...valid, consultationType: 'voice' }, new Date('2026-08-13T00:00:00.000Z'))).toBe(true)
  })

  it('rejects past, mismatched, and unavailable slots', () => {
    expect(() => validateBooking(valid, new Date('2026-08-21T00:00:00.000Z'))).toThrow(/future/)
    expect(() => validateBooking({ ...valid, slot: { ...valid.slot, serviceType: 'home_visit', consultationType: 'home_visit' } }, new Date('2026-08-13T00:00:00.000Z'))).toThrow(/does not support/)
    expect(() => validateBooking({ ...valid, slot: { ...valid.slot, status: 'booked' } }, new Date('2026-08-13T00:00:00.000Z'))).toThrow(BookingConflictError)
  })

  it('uses the required payment disclosure exactly', () => {
    expect(PAYMENT_NOTICE).toBe('Presentation Demo — No real payment is processed.')
  })

  it('allows lifecycle actions only for future pending or confirmed appointments', () => {
    const future = { status: 'confirmed', consultationType: 'video', scheduledAt: '2026-08-20T02:30:00.000Z' }
    expect(isFutureEligibleAppointment(future, new Date('2026-08-13T00:00:00.000Z'))).toBe(true)
    expect(isFutureEligibleAppointment({ ...future, status: 'completed' }, new Date('2026-08-13T00:00:00.000Z'))).toBe(false)
    expect(canJoinWaitingRoom({ ...future, status: 'cancelled' })).toBe(false)
    expect(canJoinWaitingRoom({ ...future, consultationType: 'home_visit' })).toBe(false)
  })

  it('restricts consultation joins to eligible video teleconsultations and validates Zoom URLs', () => {
    const appointment = { status: 'confirmed', appointmentType: 'teleconsultation', consultationType: 'video', scheduledAt: '2099-01-01T00:00:00Z' }
    expect(canShowConsultationJoin(appointment, new Date('2098-12-31T00:00:00Z'))).toBe(true)
    expect(canShowConsultationJoin({ ...appointment, status: 'cancelled' }, new Date('2098-12-31T00:00:00Z'))).toBe(false)
    expect(canShowConsultationJoin({ ...appointment, status: 'completed' }, new Date('2098-12-31T00:00:00Z'))).toBe(false)
    expect(canShowConsultationJoin({ ...appointment, consultationType: 'voice' }, new Date('2098-12-31T00:00:00Z'))).toBe(false)
    expect(canShowConsultationJoin({ ...appointment, appointmentType: 'home_visit' }, new Date('2098-12-31T00:00:00Z'))).toBe(false)
    expect(safeZoomJoinUrl('https://zoom.us/j/123?pwd=participant')).toBe('https://zoom.us/j/123?pwd=participant')
    expect(safeZoomJoinUrl('https://us02web.zoom.us/j/123')).toBe('https://us02web.zoom.us/j/123')
    for (const unsafe of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/secret', 'http://zoom.us/j/123', 'https://zoom.us.evil.test/j/123', 'https://evil.test/zoom.us/j/123', 'https://user:pass@zoom.us/j/123']) {
      expect(safeZoomJoinUrl(unsafe)).toBeNull()
    }
  })
})
