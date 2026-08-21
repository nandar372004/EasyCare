import { deriveInternalEmail } from '../lib/phoneIdentity.js'
import { supabase } from '../lib/supabase.js'

export const GENERIC_AUTH_ERROR = 'Unable to sign in. Check your credentials and try again.'

export async function loadAuthorizedPatient(userId, client = supabase) {
  if (!client) return null

  const { data, error } = await client
    .from('patients')
    .select('id, auth_user_id, full_name, primary_phone, preferred_language, status')
    .eq('auth_user_id', userId)
    .single()

  if (error || !data || data.status !== 'active') return null
  return data
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

  const patient = await loadAuthorizedPatient(data.user.id, client)
  if (!patient) {
    await client.auth.signOut({ scope: 'local' })
    throw new Error(GENERIC_AUTH_ERROR)
  }

  return { session: data.session, user: data.user, patient }
}

export async function signOutPatient(client = supabase) {
  if (!client) return
  const { error } = await client.auth.signOut({ scope: 'local' })
  if (error) throw new Error('Unable to sign out. Please try again.')
}
