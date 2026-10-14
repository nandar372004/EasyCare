import { describe, expect, it, vi } from 'vitest'
import {
  adaptGeminiJsonSchema, createGeminiBilingualFactExplanationAdapter, createGeminiDocumentModelAdapter,
  createGeminiDocumentTextExtractor, createGeminiGenerateContentClient,
} from './gemini-document-provider.js'
import { DOCUMENT_CLASSIFICATION_JSON_SCHEMA } from './document-classification-contract.js'
import { DOCUMENT_EXTRACTION_JSON_SCHEMA } from './document-extraction-contract.js'
import { BILINGUAL_EXPLANATION_JSON_SCHEMA } from './openai-document-provider.js'

const completed = value => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: 'STOP' }] })
const response = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })
const unsupportedGeminiKeywords = new Set(['const', 'minLength', 'maxLength', 'pattern', 'default'])
function expectGeminiJsonSchema(body) {
  expect(body.generationConfig.responseMimeType).toBe('application/json')
  expect(body.generationConfig.responseSchema).toBeUndefined()
  expect(body.generationConfig.responseJsonSchema).toMatchObject({ type: 'object' })
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      expect(unsupportedGeminiKeywords.has(key)).toBe(false)
      visit(child)
    }
  }
  visit(body.generationConfig.responseJsonSchema)
  return body.generationConfig.responseJsonSchema
}

describe('server-side Gemini document provider', () => {
  it('uses configured model, API key header, strict JSON response schema, and base64 PDF input', async () => {
    const fetchImpl = vi.fn(async () => response(completed({ pages: [{ page: 1, text: 'Test report' }] })))
    const extractor = createGeminiDocumentTextExtractor({ apiKey: 'gemini-secret', model: 'gemini-3.6-flash', fetchImpl })
    await expect(extractor.extract({ bytes: new TextEncoder().encode('%PDF-1.7'), mimeType: 'application/pdf', filename: 'report.pdf' }))
      .resolves.toContain('[Page 1]\nTest report')
    const [url, options] = fetchImpl.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent')
    expect(options.headers['x-goog-api-key']).toBe('gemini-secret')
    expect(body.contents[0].parts[1]).toMatchObject({ inlineData: { mimeType: 'application/pdf' } })
    expect(body.contents[0].parts[1].inlineData.data).toBe(btoa('%PDF-1.7'))
    expectGeminiJsonSchema(body)
    expect(JSON.stringify(body)).not.toContain('gemini-secret')
  })

  it.each(['image/jpeg', 'image/png'])('accepts %s for classification using the existing contract', async mimeType => {
    const classification = {
      document_type: 'lab_report', confidence: 0.91, review_required: true,
      source_document_id: '123e4567-e89b-42d3-a456-426614174000',
    }
    const fetchImpl = vi.fn(async () => response(completed(classification)))
    const adapter = createGeminiDocumentModelAdapter({ apiKey: 'key', model: 'gemini-3.6-flash', fetchImpl })
    const payload = await adapter.classify({
      bytes: new Uint8Array([1, 2, 3]), mimeType, source_document_id: classification.source_document_id,
      systemInstructions: 'Classify safely.',
    })
    expect(payload).toEqual(classification)
    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(requestBody.contents[0].parts[1].inlineData.mimeType).toBe(mimeType)
    expectGeminiJsonSchema(requestBody)
    expect(requestBody.generationConfig.responseJsonSchema.properties.review_required.type).toBe('boolean')
    expect(adapter.metadata).toMatchObject({ provider: 'Google Gemini', name: 'gemini-3.6-flash' })
  })

  it('preserves extraction and bilingual explanation adapters behind the injectable interface', async () => {
    const extraction = { sourceDocumentId: 'doc', documentType: 'lab_report', summary: 'Summary', candidateFacts: [], reviewRequired: true }
    const fetchImpl = vi.fn(async () => response(completed(extraction)))
    const adapter = createGeminiDocumentModelAdapter({ apiKey: 'key', model: 'model', fetchImpl })
    await expect(adapter.extract({ sourceText: 'OCR text', source_document_id: 'doc', documentType: 'lab_report', systemInstructions: 'Extract.' }))
      .resolves.toEqual(extraction)
    expectGeminiJsonSchema(JSON.parse(fetchImpl.mock.calls[0][1].body))

    const explanation = {
      simple_title_en: 'Lab result', simple_title_my: 'စမ်းသပ်မှုရလဒ်',
      short_summary_en: 'A result', short_summary_my: 'ရလဒ်တစ်ခု',
      plain_language_explanation_en: 'A result was recorded.', plain_language_explanation_my: 'ရလဒ်တစ်ခု မှတ်တမ်းတင်ထားသည်။',
      why_it_may_matter_en: 'It may help review.', why_it_may_matter_my: 'ပြန်လည်သုံးသပ်ရာတွင် အထောက်အကူဖြစ်နိုင်သည်။',
      review_message_en: 'AI extracted this from your document. Please review it.', review_message_my: 'AI က သင့်စာရွက်စာတမ်းမှ ထုတ်ယူထားသည်။ ကျေးဇူးပြု၍ ပြန်လည်စစ်ဆေးပါ။',
      uncertainty_note_en: 'This is not confirmed.', uncertainty_note_my: 'ဤအချက်ကို အတည်မပြုရသေးပါ။',
      source_assertion: 'affirmed', translation_status: 'complete',
    }
    const explanationFetch = vi.fn(async () => response(completed(explanation)))
    const explanationAdapter = createGeminiBilingualFactExplanationAdapter({ apiKey: 'key', model: 'model', fetchImpl: explanationFetch })
    await expect(explanationAdapter.explain({ fact_type: 'lab_result', review_status: 'needs_review' })).resolves.toEqual(explanation)
    expectGeminiJsonSchema(JSON.parse(explanationFetch.mock.calls[0][1].body))
  })

  it('adapts all three contracts to the supported JSON Schema subset and retains locally enforced constraints', () => {
    for (const schema of [DOCUMENT_CLASSIFICATION_JSON_SCHEMA, DOCUMENT_EXTRACTION_JSON_SCHEMA, BILINGUAL_EXPLANATION_JSON_SCHEMA]) {
      const adapted = adaptGeminiJsonSchema(schema)
      expect(adapted.schema.type).toBe('object')
      expect(adapted.unsupportedKeywords).not.toContain('additionalProperties')
    }
    const classification = adaptGeminiJsonSchema(DOCUMENT_CLASSIFICATION_JSON_SCHEMA).schema
    const extraction = adaptGeminiJsonSchema(DOCUMENT_EXTRACTION_JSON_SCHEMA).schema
    expect(classification.properties.confidence).toMatchObject({ minimum: 0, maximum: 1 })
    expect(classification.properties.review_required).toMatchObject({ type: 'boolean' })
    expect(extraction.properties.candidateFacts).toMatchObject({ maxItems: 100 })
    expect(extraction.properties.candidateFacts.items.properties.confidence).toMatchObject({ minimum: 0, maximum: 1 })
    expect(extraction.properties.candidateFacts.items.properties.reviewRequired).toMatchObject({ type: 'boolean' })
    expect(extraction.properties.candidateFacts.items.properties.observedAt.type).toEqual(['string', 'null'])
    expect(adaptGeminiJsonSchema(DOCUMENT_EXTRACTION_JSON_SCHEMA).unsupportedKeywords).toEqual(['const', 'maxLength', 'minLength'])
  })

  it('sanitizes Gemini HTTP errors and logs status without the API key', async () => {
    const events = []
    const apiKey = 'AIza-secret-key-do-not-log'
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: `Quota unavailable ${apiKey} safe prompt` } }) }))
    const client = createGeminiGenerateContentClient({
      apiKey, model: 'gemini-3.6-flash', onDiagnostic: event => events.push(event), sleepImpl: async () => {}, fetchImpl,
    })
    await expect(client.structured({ name: 'classification', schema: {}, instructions: '', parts: [{ text: 'safe prompt' }] }))
      .rejects.toThrow('PROVIDER_TEMPORARILY_UNAVAILABLE')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(events.at(-1)).toMatchObject({ event: 'provider_final_failure', http_status: 429, attempt: 3, max_attempts: 3 })
    const httpErrors = events.filter(event => event.event === 'provider_http_error')
    expect(httpErrors[0]).toMatchObject({ http_status: 429, error_code: 'RESOURCE_EXHAUSTED', response_body_exists: true })
    expect(JSON.stringify(httpErrors)).not.toContain(apiKey)
    expect(JSON.stringify(httpErrors)).not.toContain('safe prompt')
    expect(JSON.stringify(events)).not.toContain(apiKey)
  })

  it.each([1, 2])('retries a transient 503 %i time(s) before succeeding', async failuresBeforeSuccess => {
    const delays = []
    const events = []
    const fetchImpl = vi.fn()
    for (let index = 0; index < failuresBeforeSuccess; index += 1) {
      fetchImpl.mockResolvedValueOnce({ ok: false, status: 503, text: async () => JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'Temporary overload' } }) })
    }
    fetchImpl.mockResolvedValueOnce(response(completed({ pages: [{ page: 1, text: 'Recovered' }] })))
    const client = createGeminiGenerateContentClient({
      apiKey: 'key', model: 'model', fetchImpl, onDiagnostic: event => events.push(event),
      sleepImpl: async ms => delays.push(ms), randomImpl: () => 0,
    })
    await expect(client.structured({ name: 'medical_document_transcription', schema: { type: 'object' }, instructions: '', parts: [] }))
      .resolves.toEqual({ pages: [{ page: 1, text: 'Recovered' }] })
    expect(fetchImpl).toHaveBeenCalledTimes(failuresBeforeSuccess + 1)
    expect(delays).toEqual(failuresBeforeSuccess === 1 ? [1000] : [1000, 2000])
    expect(events.filter(event => event.event === 'provider_retry')).toHaveLength(failuresBeforeSuccess)
  })

  it('stops after three temporary failures and does not retry permanent request or authorization errors', async () => {
    const temporary = vi.fn(async () => ({ ok: false, status: 503, text: async () => JSON.stringify({ error: { status: 'UNAVAILABLE' } }) }))
    const temporaryClient = createGeminiGenerateContentClient({ apiKey: 'key', model: 'model', fetchImpl: temporary, sleepImpl: async () => {}, randomImpl: () => 0 })
    await expect(temporaryClient.structured({ name: 'x', schema: {}, instructions: '', parts: [] })).rejects.toThrow('PROVIDER_TEMPORARILY_UNAVAILABLE')
    expect(temporary).toHaveBeenCalledTimes(3)

    for (const status of [400, 401]) {
      const permanent = vi.fn(async () => ({ ok: false, status, text: async () => JSON.stringify({ error: { status: status === 400 ? 'INVALID_ARGUMENT' : 'UNAUTHENTICATED' } }) }))
      const permanentClient = createGeminiGenerateContentClient({ apiKey: 'key', model: 'model', fetchImpl: permanent, sleepImpl: async () => {} })
      await expect(permanentClient.structured({ name: 'x', schema: {}, instructions: '', parts: [] })).rejects.toThrow('PROVIDER_REQUEST_FAILED')
      expect(permanent).toHaveBeenCalledTimes(1)
    }
  })

  it('reports malformed provider and structured JSON responses without logging their contents', async () => {
    const events = []
    const malformedFetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'not-json-private' }))
    const malformedClient = createGeminiGenerateContentClient({ apiKey: 'key', model: 'model', fetchImpl: malformedFetch, onDiagnostic: event => events.push(event) })
    await expect(malformedClient.structured({ name: 'classification', schema: {}, instructions: '', parts: [] })).rejects.toThrow('PROVIDER_INVALID_RESPONSE')
    expect(events.at(-1)).toMatchObject({ event: 'provider_malformed_response', malformed_json: true })

    const invalidJson = createGeminiGenerateContentClient({
      apiKey: 'key', model: 'model', onDiagnostic: event => events.push(event),
      fetchImpl: vi.fn(async () => response({ candidates: [{ content: { parts: [{ text: 'not-json-private' }] } }] })),
    })
    await expect(invalidJson.structured({ name: 'classification', schema: {}, instructions: '', parts: [] })).rejects.toThrow('PROVIDER_INVALID_RESPONSE')
    expect(events.at(-1)).toMatchObject({ event: 'provider_structured_json_parse_failed', malformed_json: true })
    expect(JSON.stringify(events)).not.toContain('not-json-private')
  })
})
