import { describe, expect, it, vi } from 'vitest'
import { createOpenAIDocumentTextExtractor, createOpenAIDocumentModelAdapter, createOpenAIResponsesClient } from './openai-document-provider.js'

function response(output) {
  return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'completed', output_text: JSON.stringify(output) }) }
}

describe('server-side OpenAI document provider adapter', () => {
  it('sends PDF bytes directly to the Responses API with strict structured output and storage disabled', async () => {
    const fetchImpl = vi.fn(async () => response({ pages: [{ page: 1, text: 'LAB REPORT\nHbA1c 6.4 %' }] }))
    const extractor = createOpenAIDocumentTextExtractor({ apiKey: 'server-secret', model: 'configured-model', fetchImpl })
    await expect(extractor.extract({ bytes: new TextEncoder().encode('%PDF-1.7'), mimeType: 'application/pdf', filename: 'report.pdf' }))
      .resolves.toContain('[Page 1]\nLAB REPORT')
    const [url, options] = fetchImpl.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(options.headers.Authorization).toBe('Bearer server-secret')
    expect(body.store).toBe(false)
    expect(body.input[0].content[1]).toMatchObject({ type: 'input_file', filename: 'report.pdf' })
    expect(body.input[0].content[1].file_data).toContain('JVBERi0xLjc=')
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true })
    expect(JSON.stringify(body)).not.toContain('server-secret')
  })

  it('sends JPEG or PNG as an image input and refuses unsupported file types', async () => {
    const fetchImpl = vi.fn(async () => response({ pages: [{ page: 1, text: 'Blood test' }] }))
    const adapter = createOpenAIDocumentModelAdapter({ apiKey: 'key', model: 'vision-model', fetchImpl })
    await adapter.classify({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg', filename: 'report.jpg', source_document_id: 'doc-id', systemInstructions: 'classify' })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).input[0].content[1]).toMatchObject({ type: 'input_image', detail: 'high' })
    await expect(adapter.classify({ bytes: new Uint8Array([1]), mimeType: 'text/plain', filename: 'report.txt', source_document_id: 'doc-id', systemInstructions: 'classify' })).rejects.toThrow('UNSUPPORTED_DOCUMENT')
  })

  it('returns bounded provider errors without leaking response bodies or secrets', async () => {
    const client = createOpenAIResponsesClient({ apiKey: 'secret', model: 'model', fetchImpl: vi.fn(async () => ({ ok: false, text: async () => 'private diagnostic' })) })
    await expect(client.structured({ name: 'x', schema: {}, instructions: '', input: [] })).rejects.toThrow('PROVIDER_REQUEST_FAILED')
    await expect(client.structured({ name: 'x', schema: {}, instructions: '', input: [] })).rejects.not.toThrow('private diagnostic')
  })

  it('emits staging diagnostics with HTTP status and sanitized provider error without logging credentials', async () => {
    const events = []
    const apiKey = 'sk-unique-secret-key-do-not-log'
    const privateSourceText = 'private-medical-source-excerpt'
    const fetchImpl = vi.fn(async () => ({
      ok: false, status: 400,
      text: async () => JSON.stringify({ error: { code: 'invalid_json_schema', message: `Invalid request for ${apiKey}: ${privateSourceText}` } }),
    }))
    const client = createOpenAIResponsesClient({ apiKey, model: 'gpt-example', fetchImpl, onDiagnostic: event => events.push(event) })
    await expect(client.structured({ name: 'classification', schema: {}, instructions: '', input: [{ role: 'user', content: [{ type: 'input_text', text: privateSourceText }] }] }))
      .rejects.toThrow('PROVIDER_REQUEST_FAILED')
    expect(events[0]).toMatchObject({
      stage: 'classification', event: 'request_started', model: 'gpt-example',
      input_content_types: ['input_text'], structured_output: 'json_schema', schema_name: 'classification', strict: true,
    })
    expect(events[1]).toMatchObject({
      stage: 'classification', event: 'provider_http_error', model: 'gpt-example',
      http_status: 400, error_code: 'invalid_json_schema',
    })
    expect(events[1].error_message).not.toContain(apiKey)
    expect(events[1].error_message).not.toContain(privateSourceText)
    expect(JSON.stringify(events)).not.toContain(apiKey)
  })

  it('logs an incomplete provider response category without including its output text', async () => {
    const events = []
    const client = createOpenAIResponsesClient({
      apiKey: 'key', model: 'gpt-example', onDiagnostic: event => events.push(event),
      fetchImpl: vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: 'private document text' }) })),
    })
    await expect(client.structured({ name: 'classification', schema: {}, instructions: '', input: [] }))
      .rejects.toThrow('PROVIDER_INCOMPLETE_RESPONSE')
    expect(events.at(-1)).toMatchObject({ event: 'provider_incomplete_response', incomplete_reason: 'max_output_tokens' })
    expect(JSON.stringify(events)).not.toContain('private document text')
  })
})
