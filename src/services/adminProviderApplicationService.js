import { supabase } from '../lib/supabase.js'
import { PROVIDER_APPLICATION_BUCKET } from './providerApplicationService.js'

const FAILURE = 'Unable to load or update provider applications. Please try again.'

export function createAdminProviderApplicationService(client = supabase) {
  async function rpc(name, args) {
    if (!client) throw new Error(FAILURE)
    const { data, error } = await client.rpc(name, args)
    if (error) throw new Error(FAILURE)
    return data
  }

  return {
    async isAdmin() {
      try { return (await rpc('is_main_admin')) === true } catch { return false }
    },
    list(status = null) {
      return rpc('admin_list_provider_applications', { p_status: status || null })
        .then(rows => (Array.isArray(rows) ? rows.map(row => ({ ...row, status: row.status ?? row.application_status })) : rows))
    },
    load(applicationId) {
      return rpc('admin_get_provider_application', { p_application_id: applicationId })
    },
    startReview(applicationId) {
      return rpc('admin_start_provider_application_review', { p_application_id: applicationId })
    },
    approve(applicationId) {
      return rpc('admin_approve_provider_application', { p_application_id: applicationId })
    },
    reject(applicationId, safeReason) {
      return rpc('admin_reject_provider_application', { p_application_id: applicationId, p_safe_reason: safeReason })
    },
    async createCredentialUrl(applicationId, storagePath) {
      const detail = await rpc('admin_get_provider_application', { p_application_id: applicationId })
      if (!detail?.documents?.some(document => document.storage_path === storagePath)) throw new Error(FAILURE)
      if (!client?.storage) throw new Error(FAILURE)
      const { data, error } = await client.storage.from(PROVIDER_APPLICATION_BUCKET).createSignedUrl(storagePath, 60)
      if (error || !data?.signedUrl) throw new Error(FAILURE)
      return data.signedUrl
    },
  }
}

export const adminProviderApplicationService = createAdminProviderApplicationService()
