import { supabase } from '../lib/supabase.js'

export function createProviderAvailabilityService(client = supabase) {
  return {
    async listMySlots(doctorId) {
      if (!client) throw new Error('Availability service unavailable.')
      let query = client
        .from('provider_availability')
        .select('id, provider_id, service_type, start_at, end_at, status')
        .order('start_at', { ascending: true })
      if (doctorId) {
        query = query.eq('provider_id', doctorId)
      }
      const { data, error } = await query
      if (error) throw new Error('Unable to load availability slots. Please try again.')
      return (data || []).map(row => ({
        id: row.id,
        doctorId: row.provider_id,
        serviceType: row.service_type,
        startsAt: row.start_at,
        endsAt: row.end_at,
        status: row.status,
      }))
    },
    async addSlot({ doctorId, serviceType, startsAt, endsAt }) {
      if (!client) throw new Error('Availability service unavailable.')
      const { data, error } = await client
        .from('provider_availability')
        .insert({
          provider_id: doctorId,
          service_type: serviceType,
          start_at: startsAt,
          end_at: endsAt,
          status: 'available',
        })
        .select()
        .single()
      if (error) {
        throw new Error(error.message || 'Unable to add availability slot.')
      }
      return data
    },
    async removeAvailableSlot(slotId) {
      if (!client) throw new Error('Availability service unavailable.')
      const { data, error } = await client
        .from('provider_availability')
        .delete()
        .eq('id', slotId)
        .eq('status', 'available')
      if (error) {
        throw new Error(error.message || 'Unable to remove availability slot.')
      }
      return data
    },
  }
}

export const providerAvailabilityService = createProviderAvailabilityService()
