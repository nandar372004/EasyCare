import { describe, expect, it, vi } from 'vitest'
import { createDocumentFactExplanationService } from './document-fact-explanation-service.js'
import { createTemplateDocumentFactExplanationAdapter } from './document-fact-explanation-contract.js'

const id = '76000000-0000-4000-8000-000000000030'
const extractionId = '76000000-0000-4000-8000-000000000021'
const documentId = '76000000-0000-4000-8000-000000000020'
const ownerId = '76000000-0000-4000-8000-000000000001'

function fixture({ status = 'needs_review', rejected = false } = {}) {
  const fact = { id, extraction_id: extractionId, clinical_document_id: documentId, patient_id: ownerId,
    fact_type: 'condition_candidate', name: 'asthma', value_text: null, value_numeric: null, unit: null,
    reference_range_text: null, abnormal_flag: null, source_page: 1, source_section: null,
    source_excerpt: 'History of asthma is noted.', confidence: 0.82, confidence_band: 'medium', review_status: rejected ? 'rejected' : status }
  const results = {
    document_extracted_facts: fact,
    clinical_documents: { id: documentId, status: 'active', source: 'patient_upload' },
    document_extractions: { id: extractionId, clinical_document_id: documentId, patient_id: ownerId, requested_by_profile_id: ownerId },
  }
  const from = vi.fn(table => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: results[table], error: null })) })) })) }))
  let fields
  const rpc = vi.fn(async (_name, params) => {
    fields = params.p_explanation_fields
    return { data: { fact_id: id, explanation: { ...fields, source_reference: {
      fact_id: id, extraction_id: extractionId, source_document_id: documentId, review_state: fact.review_status,
    } } }, error: null }
  })
  const userClient = { auth: { getUser: vi.fn(async () => ({ data: { user: { id: ownerId } }, error: null })) }, from }
  const serviceClient = { rpc }
  return { fact, from, rpc, userClient, serviceClient, service: createDocumentFactExplanationService({ userClient, serviceClient, explanationAdapter: createTemplateDocumentFactExplanationAdapter() }) }
}

describe('document fact explanation service boundary', () => {
  it('uses RLS reads and persists only through the trusted owner-bound RPC', async () => {
    const f = fixture()
    const result = await f.service.explainMyFact(id)
    expect(result).toMatchObject({
      plain_language_explanation: expect.stringMatching(/not a diagnosis confirmed/i),
      review_message: 'AI extracted this from your document. Please review it.',
      source_reference: { fact_id: id, extraction_id: extractionId, source_document_id: documentId, review_state: 'needs_review' },
    })
    expect(f.from.mock.calls.map(([table]) => table)).toEqual(['document_extracted_facts', 'clinical_documents', 'document_extractions'])
    expect(f.rpc).toHaveBeenCalledWith('save_my_document_fact_explanation', {
      p_fact_id: id, p_owner_profile_id: ownerId, p_explanation_fields: expect.any(Object),
    })
    expect(f.rpc.mock.calls[0][1]).not.toHaveProperty('patient_id')
    expect(f.rpc.mock.calls[0][1]).not.toHaveProperty('source_excerpt')
  })

  it('does not call persistence or surface rejected candidate facts', async () => {
    const f = fixture({ rejected: true })
    await expect(f.service.explainMyFact(id)).rejects.toThrow('FACT_UNAVAILABLE')
    expect(f.rpc).not.toHaveBeenCalled()
  })

  it('keeps generation injectable and blocks unsafe adapter output', async () => {
    const f = fixture()
    const explain = vi.fn(async () => ({ simple_title: 'Diagnosis', short_summary: 'You have asthma.',
      plain_language_explanation: 'You have asthma.', why_it_may_matter: 'Start treatment.',
      review_message: 'AI extracted this from your document. Please review it.', uncertainty_note: 'Certain.' }))
    const service = createDocumentFactExplanationService({ userClient: f.userClient, serviceClient: f.serviceClient, explanationAdapter: { explain } })
    await expect(service.explainMyFact(id)).rejects.toThrow('INVALID_FACT_EXPLANATION')
    expect(f.rpc).not.toHaveBeenCalled()
  })

  it('falls back to validated English-only source wording when translation generation fails', async () => {
    const f = fixture()
    const service = createDocumentFactExplanationService({
      userClient: f.userClient, serviceClient: f.serviceClient,
      explanationAdapter: { explain: vi.fn(async () => { throw new Error('provider failure') }) },
    })
    const result = await service.explainMyFact(id)
    expect(result).toMatchObject({
      translation_status: 'english_only', review_message_en: 'AI extracted this from your document. Please review it.',
      simple_title_my: null, plain_language_explanation_my: null,
      source_reference: { fact_id: id, review_state: 'needs_review' },
    })
    expect(f.rpc).toHaveBeenCalledTimes(1)
    expect(f.rpc.mock.calls[0][1].p_explanation_fields.translation_status).toBe('english_only')
  })

  it('surfaces exhausted Gemini and Groq fallback without persisting a partial explanation', async () => {
    const f = fixture()
    const service = createDocumentFactExplanationService({
      userClient: f.userClient, serviceClient: f.serviceClient,
      explanationAdapter: { explain: vi.fn(async () => { throw new Error('PROVIDER_TEMPORARILY_UNAVAILABLE') }) },
    })
    await expect(service.explainMyFact(id)).rejects.toThrow('TEMPORARY_PROVIDER_UNAVAILABLE')
    expect(f.rpc).not.toHaveBeenCalled()
  })
})
