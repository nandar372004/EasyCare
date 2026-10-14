import { describe, expect, it, vi } from 'vitest'
import {
  createGroqBilingualFactExplanationAdapter, createGroqDocumentModelAdapter, createGroqDocumentTextExtractor,
  createGroqStructuredClient,
} from './groq-document-provider.js'

const result = value => ({ choices: [{ message: { content: JSON.stringify(value) } }] })
const ok = value => ({ ok: true, status: 200, text: async () => JSON.stringify(result(value)) })

describe('Groq fallback provider', () => {
  it('sends strict structured output and JPEG/PNG vision data using the configured model', async () => {
    const classification = { document_type: 'lab_report', confidence: 0.9, review_required: true, source_document_id: 'doc-id' }
    for (const mimeType of ['image/jpeg', 'image/png']) {
      const fetchImpl = vi.fn(async () => ok(classification))
      const adapter = createGroqDocumentModelAdapter({ apiKey: 'groq-secret', model: 'qwen/qwen3.8-27b', fetchImpl })
      await expect(adapter.classify({ bytes: new Uint8Array([1, 2, 3]), mimeType, source_document_id: 'doc-id', systemInstructions: 'Classify safely.' }))
        .resolves.toEqual(classification)
      const [url, options] = fetchImpl.mock.calls[0]
      const body = JSON.parse(options.body)
      expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
      expect(options.headers.Authorization).toBe('Bearer groq-secret')
      expect(body.model).toBe('qwen/qwen3.8-27b')
      expect(body.response_format.json_schema.strict).toBe(true)
      expect(body.messages[1].content[1].image_url.url).toBe(`data:${mimeType};base64,AQID`)
      expect(adapter.metadata).toMatchObject({ provider: 'Groq', name: 'qwen/qwen3.8-27b' })
    }
  })

  it('refuses raw PDF transcription and keeps JPEG/PNG OCR vision support', async () => {
    const fetchImpl = vi.fn(async () => ok({ pages: [{ page: 1, text: 'Transcribed text' }] }))
    const extractor = createGroqDocumentTextExtractor({ apiKey: 'key', model: 'qwen/qwen3.8-27b', fetchImpl })
    await expect(extractor.extract({ bytes: new Uint8Array([37, 80, 68, 70, 45]), mimeType: 'application/pdf' })).rejects.toThrow('GROQ_UNSUPPORTED_PDF')
    expect(fetchImpl).not.toHaveBeenCalled()
    for (const mimeType of ['image/jpeg', 'image/png']) {
      await expect(extractor.extract({ bytes: new Uint8Array([1, 2, 3]), mimeType })).resolves.toContain('Transcribed text')
      const request = JSON.parse(fetchImpl.mock.calls.at(-1)[1].body)
      expect(request.messages[1].content[1].image_url.url).toContain(`data:${mimeType};base64,`)
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('returns the bilingual explanation contract from Groq structured output', async () => {
    const output = { simple_title_en: 'Lab result', simple_title_my: 'ဓာတ်ခွဲရလဒ်',
      short_summary_en: 'Source note', short_summary_my: 'ရင်းမြစ်မှတ်စု',
      plain_language_explanation_en: 'The source records a result.', plain_language_explanation_my: 'ရင်းမြစ်တွင် ရလဒ်တစ်ခု မှတ်တမ်းတင်ထားသည်။',
      why_it_may_matter_en: 'It may help review.', why_it_may_matter_my: 'သုံးသပ်ရာတွင် အထောက်အကူဖြစ်နိုင်သည်။',
      review_message_en: 'ignored by server', review_message_my: 'server replaces this',
      uncertainty_note_en: 'Not confirmed.', uncertainty_note_my: 'အတည်မပြုရသေးပါ။',
      source_assertion: 'affirmed', translation_status: 'complete' }
    const fetchImpl = vi.fn(async () => ok(output))
    const adapter = createGroqBilingualFactExplanationAdapter({ apiKey: 'key', model: 'qwen/qwen3.8-27b', fetchImpl })
    await expect(adapter.explain({ fact_type: 'lab_result', name: 'HbA1c', review_status: 'needs_review' })).resolves.toEqual(output)
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(request.response_format.json_schema.schema.properties.review_message_en.type).toBe('string')
  })

  it('retries 503 once and then completes; reports safe provider diagnostics', async () => {
    const delays = []
    const events = []
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => JSON.stringify({ error: { code: 'unavailable', message: 'contains private text' } }) })
      .mockResolvedValueOnce(ok({ value: 'ok' }))
    const client = createGroqStructuredClient({ apiKey: 'key', model: 'qwen/qwen3.8-27b', fetchImpl,
      onDiagnostic: event => events.push(event), sleepImpl: async ms => delays.push(ms), randomImpl: () => 0 })
    await expect(client.structured({ name: 'test', schema: { type: 'object' }, instructions: 'safe', text: 'private text' })).resolves.toEqual({ value: 'ok' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(delays).toEqual([500])
    expect(events.map(event => event.event)).toEqual(['groq_request_sent', 'groq_http_error', 'provider_retry', 'groq_request_sent', 'groq_response_ok'])
    expect(JSON.stringify(events)).not.toContain('private text')
  })

  it('returns temporary unavailable after two transient failures and does not retry permanent errors', async () => {
    const exhausted = vi.fn(async () => ({ ok: false, status: 503, text: async () => '{}' }))
    const client = createGroqStructuredClient({ apiKey: 'key', model: 'model', fetchImpl: exhausted, sleepImpl: async () => {} })
    await expect(client.structured({ name: 'test', schema: {}, instructions: '', text: '' })).rejects.toThrow('GROQ_TEMPORARILY_UNAVAILABLE')
    expect(exhausted).toHaveBeenCalledTimes(2)
    for (const status of [400, 401, 403]) {
      const permanent = vi.fn(async () => ({ ok: false, status, text: async () => '{}' }))
      const permanentClient = createGroqStructuredClient({ apiKey: 'key', model: 'model', fetchImpl: permanent, sleepImpl: async () => {} })
      await expect(permanentClient.structured({ name: 'test', schema: {}, instructions: '', text: '' })).rejects.toThrow('GROQ_REQUEST_FAILED')
      expect(permanent).toHaveBeenCalledOnce()
    }
  })
})
