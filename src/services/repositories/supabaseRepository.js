const CLINICAL_PRESENTATION_TABLES = Object.freeze({
  healthSummary: 'health_summaries', prescriptions: 'prescriptions', labResults: 'lab_results', messages: 'messages', invoices: 'invoices', nearbyFacilities: 'nearby_facilities', hospitals: 'hospitals',
})

function requireClient(client) {
  if (!client) throw new Error('Supabase repository requires a configured client.')
}

async function unwrap(query) {
  const { data, error } = await query
  if (error) throw new Error('Repository request failed.')
  return data
}

const doctorFromRow = (row) => {
  const primarySpecialty = row.provider_specialties?.find((item) => item.is_primary) ?? row.provider_specialties?.[0]
  const consultationTypes = [
    row.teleconsult_enabled ? 'video' : null,
    row.teleconsult_enabled ? 'voice' : null,
    row.home_visit_enabled ? 'home_visit' : null,
  ].filter(Boolean)
  return {
    id: row.id,
    displayName: row.display_name ?? 'Verified doctor',
    specialty: primarySpecialty?.specialties?.name ?? 'General Practitioner',
    qualification: row.qualification ?? 'Qualification information unavailable',
    experienceYears: row.years_experience ?? null,
    rating: row.rating_average == null ? null : Number(row.rating_average),
    consultationFeeMmk: row.consultation_fee_mmk ?? 0,
    languages: row.languages ?? [],
    bio: row.bio ?? '',
    hospitalName: row.service_area?.hospital ?? row.service_area?.clinic ?? 'Independent provider',
    city: row.service_area?.city ?? null,
    consultationTypes: consultationTypes.length ? consultationTypes : ['video'],
    verificationStatus: row.verification_status,
    isSynthetic: false,
  }
}
const slotFromRow = (row) => ({ ...row, doctorId: row.provider_id, startsAt: row.start_at, endsAt: row.end_at, serviceType: row.service_type, consultationType: row.service_type === 'home_visit' ? 'home_visit' : 'video' })
const appointmentFromRow = (row) => ({
  ...row,
  bookingCode: row.booking_code ?? `ECA-${row.id.slice(0, 8).toUpperCase()}`,
  patientId: row.patient_id,
  doctorId: row.provider_id,
  slotId: row.provider_availability_id,
  scheduledAt: row.scheduled_start,
  scheduledEnd: row.scheduled_end,
  consultationType: row.consultation_channel ?? (row.appointment_type === 'home_visit' ? 'home_visit' : 'video'),
  symptoms: row.reason_symptoms,
  feeMmk: Number(row.fee_amount ?? 0),
  doctor: row.provider ? doctorFromRow({ ...row.provider, provider_specialties: [] }) : null,
})
const APPOINTMENT_SELECT = 'id, patient_id, provider_id, provider_availability_id, appointment_type, consultation_channel, scheduled_start, scheduled_end, status, reason_symptoms, fee_amount, currency, booking_code, created_at, provider:providers!appointments_provider_id_fkey(id, provider_type, display_name, qualification, verification_status, years_experience, consultation_fee_mmk, rating_average)'
const PATIENT_PROFILE_SELECT = 'id, auth_user_id, full_name, date_of_birth, gender, primary_phone, preferred_language, address_line, township, city, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone, blood_type, care_preferences, status'
const PATIENT_MEDICATION_SELECT = 'id, patient_id, medication_name, dose, frequency, instructions, start_date, end_date, status, medication_schedules(id, time_of_day, days_of_week, timezone, valid_from, valid_until)'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
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
    async getPatient(id) { return unwrap(client.from('patients').select(PATIENT_PROFILE_SELECT).eq('id', id).maybeSingle()) },
    async getPatientProfile({ patientId, authUserId }) { return unwrap(client.from('patients').select(PATIENT_PROFILE_SELECT).eq('id', patientId).eq('auth_user_id', authUserId).single()) },
    async updatePatientProfile({ patientId, authUserId, changes }) { return unwrap(client.from('patients').update(changes).eq('id', patientId).eq('auth_user_id', authUserId).select(PATIENT_PROFILE_SELECT).single()) },
    async listHospitals() { return unwrap(client.from(CLINICAL_PRESENTATION_TABLES.hospitals).select('*')) },
    async listDoctors() {
      const rows = await unwrap(client.from('providers')
        .select('id, provider_type, display_name, qualification, verification_status, years_experience, bio, languages, service_area, home_visit_enabled, teleconsult_enabled, consultation_fee_mmk, rating_average, provider_specialties(is_primary, specialties(name))')
        .eq('provider_type', 'doctor')
        .eq('verification_status', 'verified'))
      return rows.map(doctorFromRow)
    },
    async getDoctor(id) {
      const row = await unwrap(client.from('providers')
        .select('id, provider_type, display_name, qualification, verification_status, years_experience, bio, languages, service_area, home_visit_enabled, teleconsult_enabled, consultation_fee_mmk, rating_average, provider_specialties(is_primary, specialties(name))')
        .eq('id', id)
        .eq('provider_type', 'doctor')
        .eq('verification_status', 'verified')
        .maybeSingle())
      return row ? doctorFromRow(row) : null
    },
    async listAvailabilitySlots({ doctorId } = {}) { let query = client.from('provider_availability').select('id, provider_id, service_type, start_at, end_at, status').eq('status', 'available'); if (doctorId) query = query.eq('provider_id', doctorId); return (await unwrap(query)).map(slotFromRow) },
    async listAppointments({ patientId, status } = {}) { let query = client.from('appointments').select(APPOINTMENT_SELECT); if (patientId) query = query.eq('patient_id', patientId); if (status) query = query.eq('status', status); return (await unwrap(query)).map(appointmentFromRow) },
    async getAppointment(id, { patientId } = {}) { let query = client.from('appointments').select(APPOINTMENT_SELECT).eq('id', id); if (patientId) query = query.eq('patient_id', patientId); const row = await unwrap(query.maybeSingle()); return row ? appointmentFromRow(row) : null },
    async listAppointmentEvents(appointmentId) { return (await unwrap(client.from('appointment_events').select('*').eq('appointment_id', appointmentId).order('created_at', { ascending: false }))).map(eventFromRow) },
    async createAppointment(input) {
      const appointmentType = input.consultationType === 'home_visit' ? 'home_visit' : 'teleconsultation'
      const payload = { booking_code: input.bookingCode, patient_id: input.patientId, provider_id: input.doctorId, provider_availability_id: input.slotId, appointment_type: appointmentType, consultation_channel: input.consultationType, scheduled_start: input.startsAt, scheduled_end: input.endsAt, reason_symptoms: input.symptoms?.trim() || null, status: 'pending', fee_amount: input.feeMmk, currency: 'MMK', booked_by_profile_id: null }
      const { data, error } = await client.from('appointments').insert(payload).select(APPOINTMENT_SELECT).single()
      if (['23505', '23P01'].includes(error?.code)) throw new BookingConflictError()
      if (error?.code === '42501') throw new Error('Please sign in again.')
      if (error) throw new Error('Unable to book appointment.')
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
    async listMedications(patientId) {
      if (!UUID_PATTERN.test(patientId ?? '')) throw new Error('A valid patient account is required.')
      const rows = await unwrap(client.from('patient_medications').select(PATIENT_MEDICATION_SELECT).eq('patient_id', patientId).order('start_date', { ascending: false }))
      return rows.map((row) => ({
        id: row.id, patientId: row.patient_id, name: row.medication_name,
        dosage: row.dose ?? '', frequency: row.frequency ?? '', instructions: row.instructions ?? '',
        startDate: row.start_date, endDate: row.end_date, status: row.status,
        schedules: (row.medication_schedules ?? []).map((schedule) => ({
          id: schedule.id, timeOfDay: schedule.time_of_day, daysOfWeek: schedule.days_of_week,
          timezone: schedule.timezone, validFrom: schedule.valid_from, validUntil: schedule.valid_until,
        })),
      }))
    },
    async listPrescriptions(patientId) { return unwrap(client.from(CLINICAL_PRESENTATION_TABLES.prescriptions).select('*').eq('patient_id', patientId)) },
    async listLabResults(patientId) { return unwrap(client.from(CLINICAL_PRESENTATION_TABLES.labResults).select('*').eq('patient_id', patientId)) },
    async listMessages(patientId) { return unwrap(client.from(CLINICAL_PRESENTATION_TABLES.messages).select('*').eq('patient_id', patientId)) },
    async listInvoices(patientId) { return unwrap(client.from(CLINICAL_PRESENTATION_TABLES.invoices).select('*').eq('patient_id', patientId)) },
    async listNearbyFacilities() { return unwrap(client.from(CLINICAL_PRESENTATION_TABLES.nearbyFacilities).select('*')) },
    reset() { throw new Error('Remote repository reset is intentionally unsupported.') },
  }
}
import { AppointmentLifecycleError, BookingConflictError } from '../bookingService.js'
