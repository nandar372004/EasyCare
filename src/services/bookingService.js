export const ACTIVE_APPOINTMENT_STATUSES = ['pending', 'confirmed', 'checked_in', 'in_progress']
export const PAYMENT_NOTICE = 'Presentation Demo — No real payment is processed.'

export class BookingConflictError extends Error {
  constructor(message = 'That appointment time is no longer available. Please choose another slot.') {
    super(message)
    this.name = 'BookingConflictError'
    this.code = 'SLOT_CONFLICT'
  }
}

export class AppointmentLifecycleError extends Error {
  constructor(message, code = 'APPOINTMENT_INELIGIBLE') { super(message); this.name = 'AppointmentLifecycleError'; this.code = code }
}

export function isFutureEligibleAppointment(appointment, now = new Date()) {
  return ['pending', 'confirmed'].includes(appointment?.status) && new Date(appointment.scheduledAt) > now
}

export function canJoinWaitingRoom(appointment) {
  return appointment?.consultationType !== 'home_visit' && ['pending', 'confirmed', 'checked_in'].includes(appointment?.status) && new Date(appointment.scheduledAt) > new Date()
}

export function createIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function validateBooking({ doctor, patientId, slot, consultationType, paymentMethod, symptoms = '' }, now = new Date()) {
  if (!doctor?.id) throw new Error('Choose a doctor.')
  if (!patientId) throw new Error('Choose a patient.')
  if (!slot?.id || slot.doctorId !== doctor.id) throw new Error('Choose an available time.')
  if (!isSlotCompatible(slot, consultationType)) throw new Error('The selected time does not support this consultation type.')
  if (slot.status !== 'available') throw new BookingConflictError()
  if (new Date(slot.startsAt) <= now) throw new Error('Appointment date and time must be in the future.')
  if (!['video', 'voice', 'home_visit'].includes(consultationType)) throw new Error('Choose a consultation type.')
  if (!['presentation_card', 'presentation_wallet', 'not_required'].includes(paymentMethod)) throw new Error('Choose a simulated payment method.')
  if (symptoms.length > 2000) throw new Error('Reason for Visit/Symptoms must be 2,000 characters or fewer.')
  return true
}

export function isSlotCompatible(slot, consultationType) {
  if (!slot) return false
  if (consultationType === 'home_visit') return (slot.serviceType ?? slot.consultationType) === 'home_visit'
  return ['video', 'voice'].includes(consultationType)
    && (slot.serviceType === 'teleconsultation' || ['video', 'voice'].includes(slot.consultationType))
}

export function createBookingCode() {
  const suffix = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 10).toUpperCase()
    ?? Math.random().toString(36).slice(2, 12).toUpperCase()
  return `MBA-${suffix}`
}
