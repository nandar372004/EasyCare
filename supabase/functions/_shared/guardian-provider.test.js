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
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }),
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

  it.each([
    [401, 'invalid_api_key', 'The API key is invalid: synthetic-secret and input private phrase', 'Provider rejected the configured credentials.'],
    [404, 'model_not_found', 'The requested model does not exist', 'Configured model or endpoint was not found.'],
    [429, 'rate_limit_exceeded', 'Quota exceeded', 'Provider quota or rate limit was reached.'],
    [503, 'server_error', 'The service is temporarily unavailable', 'Provider reports temporary unavailability.'],
  ])('captures redacted provider diagnostics for HTTP %i', async (status, code, message, safeMessage) => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status,
      text: async () => JSON.stringify({ error: { code, message } }),
    })
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'synthetic-secret', modelName: 'synthetic-model',
      endpoint: 'https://api.provider.invalid/v1/chat/completions', fetchImpl,
    })
    let caught
    try {
      await adapter.generate({ systemPrompt: 'private prompt', userContent: 'private phrase', modelName: 'synthetic-model', signal: new AbortController().signal })
    } catch (error) { caught = error }
    expect(caught.diagnostics).toMatchObject({
      providerHost: 'api.provider.invalid', modelName: 'synthetic-model', httpStatus: status,
      providerErrorCode: code, providerErrorMessage: safeMessage, responseBodyValidJson: true,
      networkErrorType: null, timeout: false,
    })
    const serialized = JSON.stringify(caught.diagnostics)
    expect(serialized).not.toContain('synthetic-secret')
    expect(serialized).not.toContain('private phrase')
    expect(serialized).not.toContain(message)
  })

  it('classifies malformed provider JSON without retaining its body', async () => {
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'synthetic-secret', modelName: 'synthetic-model', endpoint: 'https://api.provider.invalid/chat',
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => 'secret provider payload' }),
    })
    await expect(adapter.generate({ systemPrompt: '', userContent: '', modelName: 'synthetic-model', signal: new AbortController().signal })).rejects.toMatchObject({
      diagnostics: { httpStatus: 502, responseBodyValidJson: false, providerErrorCode: null, providerErrorMessage: null },
    })
  })

  it('classifies network failures without logging exception text', async () => {
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'synthetic-secret', modelName: 'synthetic-model', endpoint: 'https://api.provider.invalid/chat',
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('secret request detail')),
    })
    await expect(adapter.generate({ systemPrompt: '', userContent: '', modelName: 'synthetic-model', signal: new AbortController().signal })).rejects.toMatchObject({
      diagnostics: { httpStatus: null, responseBodyValidJson: null, networkErrorType: 'TypeError', timeout: false },
    })
  })
})
