import { describe, expect, it, vi } from 'vitest'
import { requestGuardianGuidance } from './guardianGatewayService.js'

const modelResponse = { riskLevel: 'soon', summary: 'General information only.', guidance: ['Book if symptoms persist.'], recommendedSpecialty: 'General Medicine', redFlags: [], disclaimerKey: 'guardian.general_not_diagnosis', actions: ['book_appointment'], sourceMode: 'model', requiresHumanReview: false }

describe('Guardian browser gateway boundary', () => {
  it('calls only the Supabase Edge Function and accepts structured output', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { data: modelResponse }, error: null })
    const client = { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'patient-access-token' } }, error: null }) }, functions: { invoke } }
    expect(await requestGuardianGuidance({ message: 'I feel unusual after studying', language: 'en' }, client)).toEqual(modelResponse)
    expect(client.auth.getSession).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith('ai-health-guardian', {
      body: { message: 'I feel unusual after studying', language: 'en', conversation: [] },
      headers: { Authorization: 'Bearer patient-access-token' },
    })
  })

  it('preserves deterministic emergency and provider-failure fallbacks', async () => {
    const unsafe = { ...modelResponse, summary: 'Nothing is wrong.' }
    const invoke = vi.fn().mockResolvedValue({ data: { data: unsafe }, error: null })
    expect(await requestGuardianGuidance({ message: 'I have chest pain', language: 'en' }, { functions: { invoke } })).toMatchObject({ riskLevel: 'emergency', sourceMode: 'deterministic' })
    expect(invoke).not.toHaveBeenCalled()
    const failed = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'patient-access-token' } }, error: null }) },
      functions: { invoke: vi.fn().mockRejectedValue(new Error('offline')) },
    }
    expect(await requestGuardianGuidance({ message: 'My focus has been inconsistent today', language: 'en' }, failed)).toMatchObject({ riskLevel: 'soon', sourceMode: 'fallback' })
  })

  it('returns a signed-out response and does not invoke the Edge Function without a session', async () => {
    const invoke = vi.fn()
    const client = { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) }, functions: { invoke } }
    const result = await requestGuardianGuidance({ message: 'I feel unusual after studying', language: 'en' }, client)
    expect(result).toMatchObject({ sourceMode: 'fallback', summary: 'Please sign in again to use AI Health Guardian.' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('maps an Edge Function 401 to a clean sign-in fallback', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { context: { status: 401 } } })
    const client = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'expired-access-token' } }, error: null }) },
      functions: { invoke },
    }
    expect(await requestGuardianGuidance({ message: 'I feel unusual after studying', language: 'en' }, client))
      .toMatchObject({ sourceMode: 'fallback', summary: 'Please sign in again to use AI Health Guardian.' })
  })
})

