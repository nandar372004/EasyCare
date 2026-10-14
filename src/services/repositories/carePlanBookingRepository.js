import { supabase } from '../../lib/supabase.js'

const FAMILY_PERMISSION_MESSAGE = 'You no longer have permission to book care for this family member.'

export function createCarePlanBookingRepository(client = supabase) {
  if (!client) throw new Error('Home Care booking requires a configured EasyCare account.')
  return {
    async createBooking(input) {
      const { data, error } = await client.rpc('create_home_care_booking', {
        p_recipient_patient_id: input.recipientPatientId,
        p_package_id: input.packageId,
        p_service_id: input.serviceId,
        p_duration_days: input.durationDays,
        p_preferred_date: input.preferredDate,
        p_preferred_time: input.preferredTime,
        p_address: input.address,
        p_reason_symptoms: input.reasonSymptoms || null,
        p_idempotency_key: input.idempotencyKey,
      })
      if (error) {
        const denied = error.code === '42501' && /permission to book care for this family member/i.test(error.message || '')
        const failure = new Error(denied ? FAMILY_PERMISSION_MESSAGE : 'We could not send your Home Care request. Please try again.')
        failure.code = error.code || 'HOME_CARE_BOOKING_FAILED'
        throw failure
      }
      return Array.isArray(data) ? data[0] || null : data
    },
  }
}
