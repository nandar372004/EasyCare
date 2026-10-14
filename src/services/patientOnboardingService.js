import { supabase } from '../lib/supabase.js'

const emptyProfile = {
  addressLine: '', township: '', city: '', emergencyContactName: '',
  emergencyContactRelationship: '', emergencyContactPhone: '',
}

export async function getPatientOnboarding(client = supabase) {
  if (!client) return { status: 'not_started', profile: { ...emptyProfile }, identity: {} }
  const { data, error } = await client.rpc('get_my_patient_onboarding')
  if (error) throw error
  return data
}

export async function savePatientOnboarding(status, profile = {}, client = supabase) {
  if (!['in_progress', 'completed', 'skipped'].includes(status)) throw new Error('Invalid onboarding status')
  const allowed = Object.fromEntries(Object.entries(profile).filter(([key]) => Object.hasOwn(emptyProfile, key)))
  if (!client) return { status, profile: { ...emptyProfile, ...allowed }, identity: {} }
  const { data, error } = await client.rpc('save_my_patient_onboarding', { p_status: status, p_profile: allowed })
  if (error) throw error
  return data
}
