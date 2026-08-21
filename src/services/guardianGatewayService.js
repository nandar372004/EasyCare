import { supabase } from '../lib/supabase.js'
import { createSafeFallback, resolveGuardianResponse, screenGuardianInput } from '../features/guardian/guardianSafety.js'

export async function requestGuardianGuidance(input, client = supabase) {
  const deterministic = screenGuardianInput(input)
  if (!client) return deterministic

  try {
    const { data, error } = await client.functions.invoke('ai-health-guardian', { body: { ...input, conversation: [] } })
    if (error || !data?.data) return deterministic.sourceMode === 'fallback' ? createSafeFallback() : deterministic
    return resolveGuardianResponse(input, data.data)
  } catch {
    return deterministic.sourceMode === 'fallback' ? createSafeFallback() : deterministic
  }
}

