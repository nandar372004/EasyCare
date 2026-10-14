// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createDocumentHealthPipeline } from './document-health-pipeline.js'
import { createGeminiGroqFallbackAdapters } from './gemini-groq-fallback.js'

const documentId = '76000000-0000-4000-8000-000000000020'
const userId = '76000000-0000-4000-8000-000000000001'
const extractionId = '76000000-0000-4000-8000-000000000021'
const factId = '76000000-0000-4000-8000-000000000030'
const sourceText = '[Page 1]\nLab results\nHbA1c: 6.4%'
const candidate = {
  factType: 'lab_result', name: 'HbA1c', valueText: null, valueNumeric: 6.4, unit: '%',
  referenceRangeText: null, observedAt: null, observedAtTime: null, abnormalFlag: null,
  strengthText: null, formText: null, frequencyText: null, instructionText: null,
  recommendedAt: null, sourceContext: null,
  sourceLocator: { page: 1, section: 'Lab results', excerpt: 'HbA1c: 6.4%' },
  confidence: 0.9, reviewRequired: true, explanation: 'A value copied from the uploaded source.',
}
const explanation = {
  simple_title_en: 'Lab result: HbA1c', simple_title_my: 'HbA1c ဓာတ်ခွဲရလဒ်',
  short_summary_en: 'The document records a laboratory value.', short_summary_my: 'စာရွက်စာတမ်းတွင် ဓာတ်ခွဲတန်ဖိုးတစ်ခု မှတ်တမ်းတင်ထားသည်။',
  plain_language_explanation_en: 'The document records HbA1c as a laboratory result.', plain_language_explanation_my: 'စာရွက်စာတမ်းတွင် HbA1c ကို ဓာတ်ခွဲရလဒ်အဖြစ် မှတ်တမ်းတင်ထားသည်။',
  why_it_may_matter_en: 'It may help with a later review.', why_it_may_matter_my: 'နောက်ပိုင်း ပြန်လည်သုံးသပ်ရာတွင် အထောက်အကူဖြစ်နိုင်သည်။',
  review_message_en: 'AI extracted this from your document. Please review it.', review_message_my: 'ဒီအချက်အလက်ကို AI က သင့် document ထဲကနေ ထုတ်ယူထားတာပါ။ ကျေးဇူးပြုပြီး ပြန်လည်စစ်ဆေးပါ။',
  uncertainty_note_en: 'The source does not provide a reference range or abnormal flag; this explanation does not interpret the value.', uncertainty_note_my: 'ရင်းမြစ်တွင် ပုံမှန်အတိုင်းအတာ သို့မဟုတ် မူမမှန်အမှတ်အသားကို မဖော်ပြထားသဖြင့် ဤရှင်းလင်းချက်သည် တန်ဖိုးကို အဓိပ္ပာယ်ဖွင့်ဆိုခြင်းမပြုပါ။',
  source_assertion: 'affirmed', translation_status: 'complete',
}

function pipelineFixture(mimeType = 'image/png') {
  const bytes = mimeType === 'application/pdf' ? new Uint8Array([37, 80, 68, 70, 45]) : new Uint8Array([1, 2, 3])
  const file = new Blob([bytes], { type: mimeType })
  const document = { id: documentId, source: 'patient_upload', status: 'active', storage_bucket: 'medical-documents',
    storage_path: `patient/${documentId}/source.${mimeType === 'application/pdf' ? 'pdf' : 'png'}`, mime_type: mimeType, file_size: file.size,
    title: 'Synthetic lab report', document_date: null }
  let run = { id: extractionId, clinical_document_id: documentId, requested_by_profile_id: userId,
    patient_id: userId, extraction_status: 'pending' }
  let fact = null
  const userClient = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })) },
    rpc: vi.fn(async () => ({ data: extractionId, error: null })),
    storage: { from: vi.fn(() => ({ download: vi.fn(async () => ({ data: file, error: null })) })) },
    from: vi.fn(table => {
      const filters = {}
      const query = {
        select() { return this }, eq(key, value) { filters[key] = value; return this }, not() { return this }, order() { return this }, limit() { return this },
        value() {
          if (table === 'clinical_documents') return document
          if (table === 'document_extractions') return run
          if (table === 'document_extracted_facts') return filters.id ? (fact?.id === filters.id ? fact : null) : (fact ? [fact] : [])
          return null
        },
        async maybeSingle() { const value = this.value(); return { data: Array.isArray(value) ? value[0] ?? null : value, error: null } },
        then(resolve, reject) { return Promise.resolve({ data: this.value(), error: null }).then(resolve, reject) },
      }
      return query
    }),
  }
  const serviceClient = { rpc: vi.fn(async (name, args) => {
    if (name === 'record_document_classification_candidate') {
      run = { ...run, extraction_status: 'needs_review', document_type: args.p_document_type,
        classified_at: '2026-10-08T00:00:00Z', model_provider: args.p_model_provider, model_name: args.p_model_name }
      return { data: extractionId, error: null }
    }
    if (name === 'record_document_extracted_facts') {
      fact = { id: factId, extraction_id: extractionId, clinical_document_id: documentId, patient_id: userId,
        fact_type: candidate.factType, name: candidate.name, value_text: candidate.valueText, value_numeric: candidate.valueNumeric,
        unit: candidate.unit, reference_range_text: candidate.referenceRangeText, observed_at: candidate.observedAt,
        observed_at_time: candidate.observedAtTime, abnormal_flag: candidate.abnormalFlag, source_page: 1,
        source_section: candidate.sourceLocator.section, source_excerpt: candidate.sourceLocator.excerpt,
        confidence: candidate.confidence, confidence_band: 'high', review_status: 'needs_review' }
      return { data: 1, error: null }
    }
    if (name === 'save_my_document_fact_explanation') return { data: { fact_id: factId, explanation: {
      ...args.p_explanation_fields, source_reference: { fact_id: factId, extraction_id: extractionId,
        source_document_id: documentId, source_page: 1, source_section: candidate.sourceLocator.section,
        source_excerpt: candidate.sourceLocator.excerpt, confidence: 0.9, confidence_band: 'high', review_state: 'needs_review' },
    } }, error: null }
    throw new Error(`Unexpected operation: ${name}`)
  }) }
  return { userClient, serviceClient, get fact() { return fact }, get run() { return run } }
}

describe('document pipeline Groq fallback', () => {
  it('completes PNG extraction with Groq after Gemini overload and persists only review candidates', async () => {
    const clients = pipelineFixture()
    const geminiModelAdapter = { metadata: { provider: 'Google Gemini', name: 'gemini-3.6-flash', version: 'configured' },
      classify: vi.fn(async () => ({ document_type: 'lab_report', confidence: 0.95, review_required: true, source_document_id: documentId })),
      extract: vi.fn().mockRejectedValue(new Error('PROVIDER_TEMPORARILY_UNAVAILABLE')) }
    const extractionOutput = { sourceDocumentId: documentId, documentType: 'lab_report', summary: 'A source lab result.', candidateFacts: [candidate], reviewRequired: true }
    const groqModelAdapter = { metadata: { provider: 'Groq', name: 'qwen/qwen3.8-27b', version: 'configured' },
      classify: vi.fn(), extract: vi.fn(async () => extractionOutput) }
    const geminiTextExtractor = { extract: vi.fn().mockRejectedValue(new Error('PROVIDER_TEMPORARILY_UNAVAILABLE')) }
    const groqTextExtractor = { extract: vi.fn(async ({ mimeType }) => {
      expect(mimeType).toBe('image/png')
      return sourceText
    }) }
    const adapters = createGeminiGroqFallbackAdapters({
      geminiModelAdapter,
      geminiTextExtractor,
      geminiExplanationAdapter: { explain: vi.fn(async () => explanation) },
      groqModelAdapter,
      groqTextExtractor,
      groqExplanationAdapter: { explain: vi.fn(async () => explanation) },
      groqModel: 'qwen/qwen3.8-27b',
    })
    const pipeline = createDocumentHealthPipeline({ ...clients, ...adapters })
    await expect(pipeline.processDocument(documentId)).resolves.toMatchObject({
      source_document_id: documentId, candidate_count: 1, review_status: 'needs_review', explanation_count: 1,
    })
    expect(geminiModelAdapter.classify).toHaveBeenCalledOnce()
    expect(geminiModelAdapter.extract).toHaveBeenCalledOnce()
    expect(groqModelAdapter.classify).not.toHaveBeenCalled()
    expect(groqModelAdapter.extract).toHaveBeenCalledOnce()
    expect(geminiTextExtractor.extract).toHaveBeenCalledOnce()
    expect(groqTextExtractor.extract).toHaveBeenCalledOnce()
    expect(clients.fact).toMatchObject({ review_status: 'needs_review', source_excerpt: candidate.sourceLocator.excerpt })
    expect(clients.serviceClient.rpc.mock.calls.map(([name]) => name)).toEqual([
      'record_document_classification_candidate', 'record_document_extracted_facts', 'save_my_document_fact_explanation',
    ])
    expect(clients.serviceClient.rpc.mock.calls.some(([name]) => /patient_conditions|patient_medications|prescriptions|care_plan/i.test(name))).toBe(false)
  })

  it('returns the safe temporary error for exhausted Gemini PDF transcription without calling Groq', async () => {
    const clients = pipelineFixture('application/pdf')
    const geminiModelAdapter = { metadata: { provider: 'Google Gemini', name: 'gemini-3.6-flash', version: 'configured' },
      classify: vi.fn(async () => ({ document_type: 'lab_report', confidence: 0.95, review_required: true, source_document_id: documentId })),
      extract: vi.fn() }
    const geminiTextExtractor = { extract: vi.fn().mockRejectedValue(new Error('PROVIDER_TEMPORARILY_UNAVAILABLE')) }
    const groqTextExtractor = { extract: vi.fn() }
    const groqModelAdapter = { metadata: { provider: 'Groq', name: 'qwen/qwen3.8-27b', version: 'configured' }, classify: vi.fn(), extract: vi.fn() }
    const adapters = createGeminiGroqFallbackAdapters({ geminiModelAdapter, geminiTextExtractor,
      geminiExplanationAdapter: { explain: vi.fn() }, groqModelAdapter, groqTextExtractor,
      groqExplanationAdapter: { explain: vi.fn() }, groqModel: 'qwen/qwen3.8-27b' })
    const pipeline = createDocumentHealthPipeline({ ...clients, ...adapters })

    await expect(pipeline.processDocument(documentId)).rejects.toThrow('TEMPORARY_PROVIDER_UNAVAILABLE')
    expect(geminiTextExtractor.extract).toHaveBeenCalledOnce()
    expect(groqTextExtractor.extract).not.toHaveBeenCalled()
    expect(groqModelAdapter.classify).not.toHaveBeenCalled()
    expect(clients.serviceClient.rpc.mock.calls.map(([name]) => name)).toEqual(['record_document_classification_candidate'])
    expect(clients.serviceClient.rpc.mock.calls.some(([name]) => /patient_conditions|patient_medications|prescriptions|care_plan/i.test(name))).toBe(false)
  })
})
