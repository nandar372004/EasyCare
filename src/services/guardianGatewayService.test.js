import { describe, expect, it, vi } from 'vitest'
import { requestGuardianGuidance } from './guardianGatewayService.js'

const modelResponse = { riskLevel: 'routine', summary: 'General information only.', guidance: ['Book if symptoms persist.'], recommendedSpecialty: 'General Medicine', redFlags: [], disclaimerKey: 'guardian.general_not_diagnosis', actions: ['book_appointment'], sourceMode: 'model', requiresHumanReview: false }

describe('Guardian browser gateway boundary', () => {
  it('calls only the Supabase Edge Function and accepts structured output', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { data: modelResponse }, error: null })
    expect(await requestGuardianGuidance({ message: 'Mild headache', language: 'en' }, { functions: { invoke } })).toEqual(modelResponse)
    expect(invoke).toHaveBeenCalledWith('ai-health-guardian', { body: { message: 'Mild headache', language: 'en', conversation: [] } })
  })

  it('preserves deterministic emergency and provider-failure fallbacks', async () => {
    const unsafe = { ...modelResponse, summary: 'Nothing is wrong.' }
    const invoke = vi.fn().mockResolvedValue({ data: { data: unsafe }, error: null })
    expect(await requestGuardianGuidance({ message: 'I have chest pain', language: 'en' }, { functions: { invoke } })).toMatchObject({ riskLevel: 'emergency', sourceMode: 'deterministic' })
    const failed = { functions: { invoke: vi.fn().mockRejectedValue(new Error('offline')) } }
    expect(await requestGuardianGuidance({ message: 'I feel tired', language: 'en' }, failed)).toMatchObject({ riskLevel: 'routine', sourceMode: 'deterministic' })
  })
})

