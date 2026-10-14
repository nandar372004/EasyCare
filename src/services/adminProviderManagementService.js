import { supabase } from '../lib/supabase.js'

const FAILURE = 'Unable to complete provider management. Please try again.'
const ERROR_MESSAGES = {
  INVALID_EMAIL: 'Enter a valid email address.',
  INVALID_DISPLAY_NAME: 'Enter a display name.',
  UNSUPPORTED_PROVIDER_TYPE: 'Choose a supported provider type.',
  INVALID_INITIAL_PASSWORD: 'Use an initial password with at least 12 characters, including a letter and a number.',
  PROVIDER_CREATION_UNAVAILABLE: 'An account may already use this email, or provider creation failed.',
}

export function createAdminProviderManagementService(client = supabase) {
  async function invoke(body) {
    if (!client) throw new Error(FAILURE)
    const { data, error } = await client.functions.invoke('admin-provider-management', { body })
    if (error || data?.error) throw new Error(ERROR_MESSAGES[data?.error] || FAILURE)
    return data
  }
  return {
    async list() {
      const result = await invoke({ action: 'list' })
      return Array.isArray(result?.providers) ? result.providers : []
    },
    create(input) {
      return invoke({ action: 'create', email: input.email, display_name: input.displayName, provider_type: input.providerType, initial_password: input.initialPassword })
    },
  }
}

export const adminProviderManagementService = createAdminProviderManagementService()
