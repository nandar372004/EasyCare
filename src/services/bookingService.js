export const ACTIVE_APPOINTMENT_STATUSES = ['pending', 'confirmed', 'rescheduled']
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
  return ACTIVE_APPOINTMENT_STATUSES.includes(appointment?.status) && new Date(appointment.scheduledAt) > now
}

export function canJoinWaitingRoom(appointment) {
  return appointment?.consultationType !== 'home_visit' && isFutureEligibleAppointment(appointment)
}

export function canShowConsultationJoin(appointment, now = new Date()) {
  const consultationType = appointment?.consultationType ?? appointment?.consultation_channel
  const appointmentType = appointment?.appointmentType ?? appointment?.appointment_type
  return consultationType === 'video'
    && (!appointmentType || appointmentType === 'teleconsultation')
    && isFutureEligibleAppointment(appointment, now)
}

export function safeZoomJoinUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password
      || !(host === 'zoom.us' || host.endsWith('.zoom.us'))
      || url.pathname === '/' || url.pathname.length < 2) return null
    return url.toString()
  } catch {
    return null
  }
}

export function selectAppointments(rows, filter = 'all', now = new Date()) {
  const time = row => Date.parse(row.scheduledAt)
  return rows.filter(row => filter === 'all' || (filter === 'upcoming' ? isFutureEligibleAppointment(row, now) : filter === 'history' ? ['completed', 'no_show'].includes(row.status) || (ACTIVE_APPOINTMENT_STATUSES.includes(row.status) && time(row) <= +now) : row.status === filter))
    .sort((a, b) => ((filter === 'upcoming' ? 1 : -1) * ((time(a) || 0) - (time(b) || 0))) || String(a.id).localeCompare(String(b.id)))
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
