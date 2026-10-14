import { supabase } from '../lib/supabase.js'

export function createProviderWorkspaceService(client = supabase) {
  return {
    async listPatients() {
      if (!client) throw new Error('Provider patient list is unavailable.')
      const { data, error } = await client.rpc('list_my_clinical_patients')
      if (error || !Array.isArray(data)) throw new Error('Unable to load your authorized patients. Please try again.')
      return data.map(row => ({
        id: row.patient_id,
        displayName: row.display_name,
        relationshipContext: row.relationship_context,
      })).filter(row => row.id && row.displayName && ['appointment', 'care_assignment'].includes(row.relationshipContext))
    },
  }
}

export const providerWorkspaceService = createProviderWorkspaceService()
