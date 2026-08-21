import { describe, expect, it, vi } from 'vitest'
import { createOpenAICompatibleAdapter } from './guardian-provider.ts'

describe('Guardian provider adapter', () => {
  it('requests the exact Guardian JSON schema without exposing the key in the body', async () => {
    const response = {
      riskLevel: 'routine',
      summary: 'General information only.',
      guidance: ['Arrange a clinician review if symptoms persist.'],
      recommendedSpecialty: 'General Medicine',
      redFlags: [],
      disclaimerKey: 'guardian.general_not_diagnosis',
      actions: ['book_appointment'],
      sourceMode: 'model',
      requiresHumanReview: false,
    }
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }),
    })
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'synthetic-secret',
      modelName: 'synthetic-model',
      endpoint: 'https://provider.invalid/chat/completions',
      fetchImpl,
    })

    await expect(adapter.generate({
      systemPrompt: 'synthetic prompt',
      userContent: 'synthetic input',
      modelName: 'synthetic-model',
      signal: new AbortController().signal,
    })).resolves.toEqual(response)

    const request = fetchImpl.mock.calls[0][1]
    const body = JSON.parse(request.body)
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false)
    expect(body.response_format.json_schema.schema.required).toContain('sourceMode')
    expect(body.max_tokens).toBe(700)
    expect(request.body).not.toContain('synthetic-secret')
  })
})
