const CLINICAL_PRESENTATION_TABLES = Object.freeze({
  healthSummary: 'health_summaries', medications: 'medications', prescriptions: 'prescriptions', labResults: 'lab_results', messages: 'messages', invoices: 'invoices', nearbyFacilities: 'nearby_facilities', hospitals: 'hospitals',
})

function requireClient(client) {
  if (!client) throw new Error('Supabase repository requires a configured client.')
}

async function unwrap(query) {
  const { data, error } = await query
  if (error) throw new Error('Repository request failed.')
  return data
}

const doctorFromRow = (row) => ({
  ...row, profileId: row.profile_id, displayName: row.display_name ?? row.profiles?.display_name ?? 'Verified doctor',
  hospitalId: row.hospital_id, hospitalName: row.hospital_name, consultationFeeMmk: row.consultation_fee_mmk,
  experienceYears: row.experience_years ?? null, consultationTypes: row.consultation_types ?? ['video', 'voice', 'chat'], contactEmail: row.contact_email,
})
const slotFromRow = (row) => ({ ...row, doctorId: row.provider_id, startsAt: row.starts_at, endsAt: row.ends_at, consultationType: row.consultation_type })
const appointmentFromRow = (row) => ({ ...row, bookingCode: row.booking_code, idempotencyKey: row.idempotency_key, patientId: row.patient_id, doctorId: row.provider_id, slotId: row.availability_slot_id, scheduledAt: row.availability_slots?.starts_at ?? row.scheduled_at, consultationType: row.consultation_type, simulatedPaymentMethod: row.simulated_payment_method, feeMmk: row.fee_mmk })
const eventFromRow = (row) => ({ ...row, appointmentId: row.appointment_id, eventType: row.event_type, fromStatus: row.from_status, toStatus: row.to_status, createdAt: row.created_at })

function lifecycleError(error, conflictMessage) {
  if (error?.code === '23505' || error?.message?.includes('SLOT_CONFLICT')) return new BookingConflictError(conflictMessage)
  if (error?.message?.includes('NOT_ELIGIBLE')) return new AppointmentLifecycleError('Only future pending or confirmed appointments can be changed.')
  if (error?.message?.includes('NOT_FOUND')) return new AppointmentLifecycleError('Appointment not found.', 'NOT_FOUND')
  return new Error('Unable to update the appointment. Please try again.')
}

export function createSupabaseRepository(client) {
  requireClient(client)
  return {
    mode: 'supabase',
    metadata: Object.freeze({ isSynthetic: false, displayTimeZone: 'Asia/Yangon', readOnlyClinicalContent: true }),
    async getPatient(id) { return unwrap(client.from('patients').select('*').eq('id', id).maybeSingle()) },
    async getCurrentPatient() { const row = await unwrap(client.from('patients').select('*').maybeSingle()); return row ? { ...row, displayName: row.full_name } : null },
    async listHospitals() { return unwrap(client.from(CLINICAL_PRESENTATION_TABLES.hospitals).select('*')) },
    async listDoctors() { return (await unwrap(client.from('providers').select('*'))).map(doctorFromRow) },
    async getDoctor(id) { const row = await unwrap(client.from('providers').select('*').eq('id', id).maybeSingle()); return row ? doctorFromRow(row) : null },
    async listAvailabilitySlots({ doctorId } = {}) { let query = client.from('availability_slots').select('*'); if (doctorId) query = query.eq('provider_id', doctorId); return (await unwrap(query)).map(slotFromRow) },
    async listAppointments({ status } = {}) { let query = client.from('appointments').select('*, availability_slots(starts_at)'); if (status) query = query.eq('status', status); return (await unwrap(query)).map(appointmentFromRow) },
    async getAppointment(id) { const row = await unwrap(client.from('appointments').select('*, availability_slots(starts_at)').eq('id', id).maybeSingle()); return row ? appointmentFromRow(row) : null },
    async listAppointmentEvents(appointmentId) { return (await unwrap(client.from('appointment_events').select('*').eq('appointment_id', appointmentId).order('created_at', { ascending: false }))).map(eventFromRow) },
    async createAppointment(input) {
      const payload = { booking_code: input.bookingCode, idempotency_key: input.idempotencyKey, patient_id: input.patientId, provider_id: input.doctorId, availability_slot_id: input.slotId, consultation_type: input.consultationType, symptoms: input.symptoms?.trim() || null, simulated_payment_method: input.paymentMethod, fee_mmk: input.feeMmk }
      const { data, error } = await client.from('appointments').insert(payload).select('*, availability_slots(starts_at)').single()
      if (error?.code === '23505') {
        const { data: existing } = await client.from('appointments').select('*, availability_slots(starts_at)').eq('patient_id', input.patientId).eq('idempotency_key', input.idempotencyKey).maybeSingle()
        if (existing) return appointmentFromRow(existing)
        throw new BookingConflictError()
      }
      if (error) throw new Error('Unable to complete the booking. Please try again.')
      return appointmentFromRow(data)
    },
    async rescheduleAppointment({ appointmentId, slotId, mutationKey }) {
      const { error } = await client.rpc('patient_reschedule_appointment', { p_appointment_id: appointmentId, p_new_slot_id: slotId, p_mutation_key: mutationKey })
      if (error) throw lifecycleError(error, 'That appointment time is no longer available. Please choose another slot.')
      return this.getAppointment(appointmentId)
    },
    async cancelAppointment({ appointmentId, reason, mutationKey }) {
      const { error } = await client.rpc('patient_cancel_appointment', { p_appointment_id: appointmentId, p_reason: reason?.trim() || 'Cancelled by patient', p_mutation_key: mutationKey })
      if (error) throw lifecycleError(error)
      return this.getAppointment(appointmentId)
    },
    async getHealthSummary(patientId) { return unwrap(client.from(CLINICAL_PRESENTATION_TABLES.healthSummary).select('*').eq('patient_id', patientId).maybeSingle()) },
    async listMedications(patientId) { return unwrap(client.from(CLINICAL_PRESENTATION_TABLES.medications).select('*').eq('patient_id', patientId)) },
    async listPrescriptions(patientId) { return unwrap(client.from(CLINICAL_PRESENTATION_TABLES.prescriptions).select('*').eq('patient_id', patientId)) },
    async listLabResults(patientId) { return unwrap(client.from(CLINICAL_PRESENTATION_TABLES.labResults).select('*').eq('patient_id', patientId)) },
    async listMessages(patientId) { return unwrap(client.from(CLINICAL_PRESENTATION_TABLES.messages).select('*').eq('patient_id', patientId)) },
    async listInvoices(patientId) { return unwrap(client.from(CLINICAL_PRESENTATION_TABLES.invoices).select('*').eq('patient_id', patientId)) },
    async listNearbyFacilities() { return unwrap(client.from(CLINICAL_PRESENTATION_TABLES.nearbyFacilities).select('*')) },
    reset() { throw new Error('Remote repository reset is intentionally unsupported.') },
  }
}
import { AppointmentLifecycleError, BookingConflictError } from '../bookingService.js'
