import { supabase } from '../lib/supabase.js'
import { createSafeFallback, resolveGuardianResponse, screenGuardianInput } from '../features/guardian/guardianSafety.js'
import { HACKATHON_PROTOTYPE } from '../lib/prototypeMode.js'

const SIGN_IN_REQUIRED = 'Please sign in again to use AI Health Guardian.'

function isUnauthorized(error) {
  return error?.status === 401
    || error?.context?.status === 401
    || error?.code === 'UNAUTHORIZED'
}

export async function requestGuardianGuidance(input, client = supabase) {
  const deterministic = screenGuardianInput(input)
  if (HACKATHON_PROTOTYPE && client === supabase) return deterministic
  if (deterministic.sourceMode === 'deterministic') return deterministic
  if (!client) return deterministic

  let session
  try {
    const { data, error } = await client.auth.getSession()
    if (error) return createSafeFallback(SIGN_IN_REQUIRED)
    session = data?.session
  } catch {
    return createSafeFallback(SIGN_IN_REQUIRED)
  }

  const accessToken = session?.access_token
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    return createSafeFallback(SIGN_IN_REQUIRED)
  }

  try {
    const { data, error } = await client.functions.invoke('ai-health-guardian', {
      body: { ...input, conversation: [] },
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (isUnauthorized(error)) return createSafeFallback(SIGN_IN_REQUIRED)
    if (error || !data?.data) return deterministic.sourceMode === 'fallback' ? createSafeFallback() : deterministic
    return resolveGuardianResponse(input, data.data)
  } catch {
    return deterministic.sourceMode === 'fallback' ? createSafeFallback() : deterministic
  }
}
