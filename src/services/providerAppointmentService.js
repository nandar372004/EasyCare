import { supabase } from '../lib/supabase.js'

export function createProviderAppointmentService(client = supabase) {
  return {
    async list() {
      if (!client) throw new Error('Provider appointments are unavailable.')
      const { data, error } = await client.rpc('list_my_provider_appointments')
      if (error || !Array.isArray(data)) throw new Error('Unable to load your appointments. Please try again.')
      return data
    },
    async transition(id, status) {
      if (!client || !id || !['confirmed', 'completed', 'no_show'].includes(status)) throw new Error('Invalid appointment action.')
      const { data, error } = await client.rpc('transition_my_provider_appointment', { p_appointment_id: id, p_status: status })
      if (error || data !== status) throw new Error('Unable to update this appointment. Reload to check its current status before trying again.')
      return data
    },
  }
}
export const providerAppointmentService = createProviderAppointmentService()
