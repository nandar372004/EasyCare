import { deriveInternalEmail } from '../lib/phoneIdentity.js'
import { supabase } from '../lib/supabase.js'

export const GENERIC_AUTH_ERROR = 'Unable to sign in. Check your credentials and try again.'
export const PROVIDER_ACCESS_ERROR = 'Provider access is unavailable. Contact EasyCare support if you believe this is an error.'

export async function loadAuthorizedProfileRole(userId, client = supabase) {
  if (!client || !userId) return null
  const { data, error } = await client.from('profiles').select('role').eq('id', userId).maybeSingle()
  if (error || !['patient', 'admin', 'provider'].includes(data?.role)) return null
  return data.role
}

export async function loadAuthorizedPatient(userId, client = supabase) {
  if (!client) return null

  const { data, error } = await client
    .from('patients')
    .select('id, auth_user_id, full_name, primary_phone, date_of_birth, preferred_language, status')
    .eq('auth_user_id', userId)
    .maybeSingle()

  if (error || !data || data.status !== 'active') return null
  return data
}

export async function loadAuthorizedProvider(client = supabase) {
  if (!client || typeof client.rpc !== 'function') return null
  const { data, error } = await client.rpc('get_my_provider_identity')
  if (error || !Array.isArray(data) || data.length !== 1) return null
  const row = data[0]
  if (!row?.provider_id || !row?.display_name || !['doctor', 'nurse', 'nurse_aide', 'skilled_nurse_aide', 'special_nurse', 'caregiver'].includes(row.provider_type)) return null
  return { id: row.provider_id, type: row.provider_type, displayName: row.display_name }
}

export async function loadAuthorizedProviderSetup(client = supabase) {
  if (!client || typeof client.rpc !== 'function') return null
  const { data, error } = await client.rpc('get_my_provider_setup_identity')
  if (error || !Array.isArray(data) || data.length !== 1) return null
  const row = data[0]
  const types = ['doctor', 'nurse_aide', 'skilled_nurse_aide', 'special_nurse']
  if (row?.profile_role !== 'provider' || !row?.provider_id || !types.includes(row.provider_type)
    || !['invited', 'active'].includes(row.account_status)
    || !['setup_required', 'profile_incomplete', 'ready'].includes(row.setup_state)) return null
  return {
    id: row.provider_id, type: row.provider_type, displayName: row.display_name || row.full_name || '',
    fullName: row.full_name || '', phone: row.phone || '', bio: row.bio || '', qualification: row.qualification || '',
    licenseNumber: row.license_number || '', consultationFeeMmk: row.consultation_fee_mmk ?? '',
    teleconsultEnabled: row.teleconsult_enabled === true, homeVisitEnabled: row.home_visit_enabled === true,
    specialtyId: row.specialty_id || '', accountStatus: row.account_status, setupState: row.setup_state,
    verificationStatus: row.verification_status,
  }
}

export async function loadAuthorizedAdmin(client = supabase) {
  if (!client || typeof client.rpc !== 'function') return false
  const { data, error } = await client.rpc('is_main_admin')
  return !error && data === true
}

function providerWorkspaceIdentity(providerSetup) {
  if (!providerSetup || providerSetup.accountStatus !== 'active' || providerSetup.setupState !== 'ready') return null
  return { id: providerSetup.id, type: providerSetup.type, displayName: providerSetup.displayName }
}

export async function resolveAuthenticatedIdentity(userId, client = supabase) {
  const role = await loadAuthorizedProfileRole(userId, client)
  if (role === 'patient') {
    return { role, patient: await loadAuthorizedPatient(userId, client), provider: null, providerSetup: null, admin: false }
  }
  if (role === 'admin') {
    return { role, patient: null, provider: null, providerSetup: null, admin: await loadAuthorizedAdmin(client) }
  }
  if (role === 'provider') {
    const providerSetup = await loadAuthorizedProviderSetup(client)
    return { role, patient: null, provider: providerWorkspaceIdentity(providerSetup), providerSetup, admin: false }
  }
  return { role: null, patient: null, provider: null, providerSetup: null, admin: false }
}

export async function signInPatient({ phoneNumber, password }, client = supabase) {
  if (!client || !phoneNumber || !password) throw new Error(GENERIC_AUTH_ERROR)

  let email
  try {
    email = await deriveInternalEmail(phoneNumber)
  } catch {
    throw new Error(GENERIC_AUTH_ERROR)
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data?.session || !data?.user) throw new Error(GENERIC_AUTH_ERROR)

  const role = await loadAuthorizedProfileRole(data.user.id, client)
  if (role !== 'patient') throw new Error(GENERIC_AUTH_ERROR)
  const patient = await loadAuthorizedPatient(data.user.id, client)
  if (!patient) throw new Error(GENERIC_AUTH_ERROR)
  return { session: data.session, user: data.user, role, patient, provider: null, providerSetup: null, admin: false }
}

export async function signInWithEmail({ email, password }, client = supabase) {
  if (!client || !email?.trim() || !password) throw new Error(GENERIC_AUTH_ERROR)

  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })
  if (error || !data?.session || !data?.user) throw new Error(GENERIC_AUTH_ERROR)

  const identity = await resolveAuthenticatedIdentity(data.user.id, client)
  if (identity.role === 'admin' && !identity.admin) throw new Error(GENERIC_AUTH_ERROR)
  if (identity.role === 'provider' && !identity.providerSetup) throw new Error(PROVIDER_ACCESS_ERROR)
  if (identity.role === 'patient' && !identity.patient) throw new Error(GENERIC_AUTH_ERROR)
  if (!identity.role) throw new Error(GENERIC_AUTH_ERROR)
  return { session: data.session, user: data.user, ...identity }
}

export async function signInAdminWithEmail(credentials, client = supabase) {
  const identity = await signInWithEmail(credentials, client)
  if (identity.role !== 'admin' || identity.admin !== true) throw new Error(GENERIC_AUTH_ERROR)
  return identity
}

export async function signInProvider(credentials, client = supabase) {
  const identity = await signInWithEmail(credentials, client)
  if (identity.role !== 'provider' || !identity.providerSetup) throw new Error(PROVIDER_ACCESS_ERROR)
  return identity
}

export async function signOutPatient(client = supabase) {
  if (!client) return
  const { error } = await client.auth.signOut({ scope: 'local' })
  if (error) throw new Error('Unable to sign out. Please try again.')
}
