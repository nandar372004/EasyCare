import { createPresentationFixtures, PRESENTATION_DATA_NOTICE, PRESENTATION_TIME_ZONE } from '../../data/presentationFixtures.js'
import { ACTIVE_APPOINTMENT_STATUSES, AppointmentLifecycleError, BookingConflictError, createBookingCode, isFutureEligibleAppointment, isSlotCompatible } from '../bookingService.js'

const APPOINTMENTS_KEY = 'easycare.hackathon.appointments.v1'

function restorePrototypeAppointments(data) {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(APPOINTMENTS_KEY))
    if (!saved || !Array.isArray(saved.appointments) || !Array.isArray(saved.availabilitySlots) || !Array.isArray(saved.appointmentEvents)) return
    data.appointments = saved.appointments
    data.availabilitySlots = saved.availabilitySlots
    data.appointmentEvents = saved.appointmentEvents
  } catch {
    // Corrupt or unavailable browser storage falls back to presentation fixtures.
  }
}

function persistPrototypeAppointments(data) {
  try {
    const appointments = data.appointments.map(({ symptoms: _symptoms, cancellationReason, ...appointment }) => ({
      ...appointment,
      symptoms: null,
      ...(cancellationReason ? { cancellationReason: 'Cancelled in demo' } : {}),
    }))
    globalThis.localStorage?.setItem(APPOINTMENTS_KEY, JSON.stringify({ appointments, availabilitySlots: data.availabilitySlots, appointmentEvents: data.appointmentEvents }))
  } catch {
    // The in-memory flow remains fully usable when storage is unavailable.
  }
}

export function createFixtureRepository({ persist = false } = {}) {
  let data = createPresentationFixtures()
  if (persist) restorePrototypeAppointments(data)
  const mutations = new Map()
  const copy = (value) => structuredClone(value)

  return {
    mode: 'fixture',
    metadata: Object.freeze({ isSynthetic: true, notice: PRESENTATION_DATA_NOTICE, displayTimeZone: PRESENTATION_TIME_ZONE, readOnlyClinicalContent: true }),
    async getPatient(id = data.patient.id) { return id === data.patient.id ? copy(data.patient) : null },
    async getCurrentPatient() { return copy(data.patient) },
    async listHospitals() { return copy(data.hospitals) },
    async listDoctors() { return copy(data.doctors) },
    async getDoctor(id) { return copy(data.doctors.find((item) => item.id === id) ?? null) },
    async listAvailabilitySlots({ doctorId } = {}) { return copy(doctorId ? data.availabilitySlots.filter((item) => item.doctorId === doctorId) : data.availabilitySlots) },
    async listAppointments({ status } = {}) { const owned = data.appointments.filter((item) => item.patientId === data.patient.id); return copy(status ? owned.filter((item) => item.status === status) : owned) },
    async getAppointment(id) { return copy(data.appointments.find((item) => item.id === id && item.patientId === data.patient.id) ?? null) },
    async listAppointmentEvents(appointmentId) { const owned = data.appointments.some((item) => item.id === appointmentId && item.patientId === data.patient.id); return copy(owned ? data.appointmentEvents.filter((item) => item.appointmentId === appointmentId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) : []) },
    async createAppointment(input) {
      const previous = data.appointments.find((item) => item.patientId === input.patientId && item.idempotencyKey === input.idempotencyKey)
      if (previous) return copy(previous)
      const slot = data.availabilitySlots.find((item) => item.id === input.slotId)
      const duplicate = data.appointments.some((item) => item.slotId === input.slotId && ACTIVE_APPOINTMENT_STATUSES.includes(item.status))
      if (!slot || slot.status !== 'available' || duplicate) throw new BookingConflictError()
      if (slot.doctorId !== input.doctorId || !isSlotCompatible(slot, input.consultationType)) throw new BookingConflictError('That slot does not match the selected doctor and consultation type.')
      const appointment = {
        id: `appointment-demo-${data.appointments.length + 1}`,
        bookingCode: createBookingCode(), idempotencyKey: input.idempotencyKey,
        patientId: input.patientId, doctorId: input.doctorId, slotId: input.slotId,
        scheduledAt: slot.startsAt, consultationType: input.consultationType,
        symptoms: input.symptoms?.trim() || null, simulatedPaymentMethod: input.paymentMethod,
        status: 'confirmed', feeMmk: input.feeMmk, isSynthetic: true,
      }
      slot.status = 'booked'
      data.appointments.unshift(appointment)
      data.appointmentEvents.push({ id: `event-demo-${data.appointmentEvents.length + 1}`, appointmentId: appointment.id, eventType: 'appointment_created', fromStatus: null, toStatus: 'confirmed', createdAt: new Date().toISOString() })
      if (persist) persistPrototypeAppointments(data)
      return copy(appointment)
    },
    async rescheduleAppointment({ appointmentId, slotId, mutationKey, now = new Date() }) {
      const mutationId = `${appointmentId}:reschedule:${mutationKey}`
      if (mutations.has(mutationId)) return copy(mutations.get(mutationId))
      const appointment = data.appointments.find((item) => item.id === appointmentId && item.patientId === data.patient.id)
      if (!appointment) throw new AppointmentLifecycleError('Appointment not found.', 'NOT_FOUND')
      if (!isFutureEligibleAppointment(appointment, now)) throw new AppointmentLifecycleError('Only future pending or confirmed appointments can be rescheduled.')
      const nextSlot = data.availabilitySlots.find((item) => item.id === slotId)
      const duplicate = data.appointments.some((item) => item.id !== appointment.id && item.slotId === slotId && ACTIVE_APPOINTMENT_STATUSES.includes(item.status))
      if (!nextSlot || nextSlot.status !== 'available' || duplicate || new Date(nextSlot.startsAt) <= now) throw new BookingConflictError()
      if (nextSlot.doctorId !== appointment.doctorId || !isSlotCompatible(nextSlot, appointment.consultationType)) throw new BookingConflictError('Choose an available slot for the same doctor and consultation type.')
      const previousSlot = data.availabilitySlots.find((item) => item.id === appointment.slotId)
      if (previousSlot && new Date(previousSlot.startsAt) > now) previousSlot.status = 'available'
      const oldSlotId = appointment.slotId
      appointment.slotId = nextSlot.id; appointment.scheduledAt = nextSlot.startsAt; nextSlot.status = 'booked'
      data.appointmentEvents.push({ id: `event-demo-${data.appointmentEvents.length + 1}`, appointmentId, eventType: 'appointment_rescheduled', fromStatus: appointment.status, toStatus: appointment.status, metadata: { oldSlotId, newSlotId: nextSlot.id }, createdAt: now.toISOString() })
      mutations.set(mutationId, copy(appointment))
      if (persist) persistPrototypeAppointments(data)
      return copy(appointment)
    },
    async cancelAppointment({ appointmentId, reason, mutationKey, now = new Date() }) {
      const mutationId = `${appointmentId}:cancel:${mutationKey}`
      if (mutations.has(mutationId)) return copy(mutations.get(mutationId))
      const appointment = data.appointments.find((item) => item.id === appointmentId && item.patientId === data.patient.id)
      if (!appointment) throw new AppointmentLifecycleError('Appointment not found.', 'NOT_FOUND')
      if (!isFutureEligibleAppointment(appointment, now)) throw new AppointmentLifecycleError('Only future pending or confirmed appointments can be cancelled.')
      const previousStatus = appointment.status
      appointment.status = 'cancelled'; appointment.cancelledAt = now.toISOString(); appointment.cancellationReason = reason?.trim() || 'Cancelled by patient'
      const slot = data.availabilitySlots.find((item) => item.id === appointment.slotId)
      if (slot && new Date(slot.startsAt) > now) slot.status = 'available'
      data.appointmentEvents.push({ id: `event-demo-${data.appointmentEvents.length + 1}`, appointmentId, eventType: 'appointment_cancelled', fromStatus: previousStatus, toStatus: 'cancelled', createdAt: now.toISOString() })
      mutations.set(mutationId, copy(appointment))
      if (persist) persistPrototypeAppointments(data)
      return copy(appointment)
    },
    async getHealthSummary(patientId = data.patient.id) { return patientId === data.patient.id ? copy(data.healthSummary) : null },
    async listMedications(patientId = data.patient.id) { return copy(data.medications.filter((item) => item.patientId === patientId)) },
    async listPrescriptions(patientId = data.patient.id) { return copy(data.prescriptions.filter((item) => item.patientId === patientId)) },
    async listLabResults(patientId = data.patient.id) { return copy(data.labResults.filter((item) => item.patientId === patientId)) },
    async listMessages(patientId = data.patient.id) { return copy(data.messages.filter((item) => item.patientId === patientId)) },
    async listInvoices(patientId = data.patient.id) { return copy(data.invoices.filter((item) => item.patientId === patientId)) },
    async listNearbyFacilities() { return copy(data.nearbyFacilities) },
    reset() { data = createPresentationFixtures(); mutations.clear(); if (persist) globalThis.localStorage?.removeItem(APPOINTMENTS_KEY) },
  }
}
