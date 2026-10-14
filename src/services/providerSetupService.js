import { supabase } from '../lib/supabase.js'

export const PROVIDER_SETUP_TYPES = Object.freeze(['doctor', 'nurse_aide', 'skilled_nurse_aide', 'special_nurse'])

export function normalizeProviderSetupIdentity(row) {
  if (row?.profile_role !== 'provider' || !row?.provider_id || !PROVIDER_SETUP_TYPES.includes(row.provider_type)) return null
  if (!['invited', 'active'].includes(row.account_status) || !['setup_required', 'profile_incomplete', 'ready'].includes(row.setup_state)) return null
  return {
    id: row.provider_id,
    type: row.provider_type,
    displayName: row.display_name || row.full_name || '',
    fullName: row.full_name || '',
    phone: row.phone || '',
    bio: row.bio || '',
    qualification: row.qualification || '',
    licenseNumber: row.license_number || '',
    consultationFeeMmk: row.consultation_fee_mmk ?? '',
    teleconsultEnabled: row.teleconsult_enabled === true,
    homeVisitEnabled: row.home_visit_enabled === true,
    specialtyId: row.specialty_id || '',
    accountStatus: row.account_status,
    setupState: row.setup_state,
    verificationStatus: row.verification_status,
  }
}

export function createProviderSetupService(client = supabase) {
  if (!client) return null
  return {
    async loadIdentity() {
      const { data, error } = await client.rpc('get_my_provider_setup_identity')
      if (error || !Array.isArray(data) || data.length !== 1) return null
      return normalizeProviderSetupIdentity(data[0])
    },
    async begin() {
      const { data, error } = await client.rpc('begin_my_provider_setup')
      if (error) throw new Error('We could not start provider setup. Sign in again and try once more.')
      return data
    },
    async changeInitialPassword(password) {
      const { data, error } = await client.functions.invoke('provider-initial-password', { body: { new_password: password } })
      if (error || data?.error) throw new Error('We could not change your initial password. Sign in again and try once more.')
      return data
    },
    async complete(fields) {
      const { data, error } = await client.rpc('complete_my_provider_setup', {
        p_display_name: fields.displayName,
        p_phone: fields.phone,
        p_bio: fields.bio || null,
        p_qualification: fields.qualification || null,
        p_specialty_id: fields.specialtyId || null,
        p_license_number: fields.licenseNumber || null,
        p_teleconsult_enabled: fields.teleconsultEnabled === true,
        p_home_visit_enabled: fields.homeVisitEnabled === true,
        p_consultation_fee_mmk: fields.consultationFeeMmk === '' ? null : Number(fields.consultationFeeMmk),
      })
      if (error) throw new Error('We could not save provider setup. Check the required fields and try again.')
      return data
    },
    async listSpecialties() {
      const { data, error } = await client.from('specialties').select('id,name').order('name')
      if (error) throw new Error('We could not load specialties.')
      return data || []
    },
  }
}

export const providerSetupService = createProviderSetupService()
