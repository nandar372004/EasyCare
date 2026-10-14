// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createDocumentHealthFactExtractionService } from '../../supabase/functions/_shared/document-health-fact-extraction-service.js'

const documentId = '76000000-0000-4000-8000-000000000020'
const extractionId = '76000000-0000-4000-8000-000000000021'
const userId = '76000000-0000-4000-8000-000000000001'
const sourceText = 'Lab Results: HbA1c 6.1 percent. Drug X 5 mg once daily. oxygen saturation 97%. The patient denies Drug X. Imaging reports no acute findings. Follow-up in two weeks.'

function candidate(overrides = {}) {
  return {
    factType: 'lab_result', name: 'HbA1c', valueText: null, valueNumeric: 6.1,
    unit: 'percent', referenceRangeText: null, observedAt: null, observedAtTime: null,
    abnormalFlag: null, strengthText: null, formText: null, frequencyText: null,
    instructionText: null, recommendedAt: null, sourceContext: null,
    sourceLocator: { page: 1, section: 'Lab Results', excerpt: 'HbA1c 6.1 percent' },
    confidence: 0.9, reviewRequired: true, explanation: 'A source-reported laboratory value.',
    ...overrides,
  }
}

function setup({ facts = [candidate()], requestDenied = false, document = {}, output = {} } = {}) {
  const file = new Blob(['synthetic PDF bytes'], { type: 'application/pdf' })
  const run = requestDenied ? null : { id: extractionId, clinical_document_id: documentId, requested_by_profile_id: userId,
    extraction_status: 'needs_review', document_type: 'lab_report', classified_at: '2026-10-07T00:00:00Z' }
  const source = { id: documentId, source: 'patient_upload', status: 'active', storage_bucket: 'medical-documents',
    storage_path: `patient/${documentId}/source.pdf`, mime_type: 'application/pdf', file_size: file.size, ...document }
  const queries = {
    document_extractions: {
      select: vi.fn(() => queries.document_extractions), eq: vi.fn(() => queries.document_extractions),
      not: vi.fn(() => queries.document_extractions), order: vi.fn(() => queries.document_extractions),
      limit: vi.fn(() => queries.document_extractions), maybeSingle: vi.fn(async () => ({ data: run, error: null })),
    },
    clinical_documents: { select: vi.fn(() => queries.clinical_documents), eq: vi.fn(() => queries.clinical_documents), maybeSingle: vi.fn(async () => ({ data: source, error: null })) },
  }
  const userClient = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })) },
    rpc: vi.fn(),
    from: vi.fn(table => queries[table]),
    storage: { from: vi.fn(() => ({ download: vi.fn(async () => ({ data: file, error: null })) })) },
  }
  const payload = { sourceDocumentId: documentId, documentType: 'lab_report', summary: 'A result is printed.', candidateFacts: facts, reviewRequired: true, ...output }
  const serviceClient = { rpc: vi.fn(async () => ({ data: facts.length, error: null })) }
  const sourceTextExtractor = { extract: vi.fn(async () => sourceText) }
  const modelAdapter = { metadata: { provider: 'synthetic-test', name: 'fixture', version: 'v1' }, extract: vi.fn(async () => payload) }
  return { userClient, serviceClient, sourceTextExtractor, modelAdapter, queries,
    service: createDocumentHealthFactExtractionService({ userClient, serviceClient, sourceTextExtractor, modelAdapter }) }
}

describe('structured health-fact extraction boundary', () => {
  it.each([
    ['lab result', candidate()],
    ['medication mention', candidate({ factType: 'medication_candidate', name: 'Drug X', valueNumeric: null,
      unit: null, strengthText: '5 mg', frequencyText: 'once daily', valueText: null,
      sourceLocator: { page: 1, section: 'Medication', excerpt: 'Drug X 5 mg once daily' } })],
    ['vital', candidate({ factType: 'vital_candidate', name: 'oxygen saturation', valueNumeric: 97,
      unit: '%', sourceLocator: { page: 1, section: 'Vitals', excerpt: 'oxygen saturation 97%' } })],
    ['condition mention', candidate({ factType: 'condition_candidate', name: 'Drug X use', valueText: 'patient denies',
      valueNumeric: null, sourceLocator: { page: 1, section: 'History', excerpt: 'The patient denies Drug X' } })],
    ['imaging finding', candidate({ factType: 'procedure_candidate', name: 'Imaging finding', valueText: 'no acute findings',
      valueNumeric: null, sourceLocator: { page: 1, section: 'Imaging', excerpt: 'Imaging reports no acute findings' } })],
    ['follow-up instruction', candidate({ factType: 'follow_up_candidate', name: 'Follow-up', valueText: 'in two weeks',
      valueNumeric: null, instructionText: 'Follow-up in two weeks',
      sourceLocator: { page: 1, section: 'Plan', excerpt: 'Follow-up in two weeks' } })],
  ])('stores %s only as a review-required candidate', async (_label, fact) => {
    const f = setup({ facts: [fact] })
    const result = await f.service.extractForDocument(documentId)
    expect(result.candidate_facts[0].review_status).toBe('needs_review')
    expect(result.review_required).toBe(true)
    expect(f.serviceClient.rpc).toHaveBeenCalledWith('record_document_extracted_facts', {
      p_extraction_id: extractionId, p_summary: 'A result is printed.', p_candidate_facts: [fact],
    })
    expect(f.userClient.rpc).not.toHaveBeenCalled()
    expect(f.serviceClient.rpc.mock.calls[0][0]).not.toMatch(/diagnos|medication|prescription|care_plan/i)
  })

  it('denies unauthorized or removed documents before extraction or persistence', async () => {
    const f = setup({ requestDenied: true })
    await expect(f.service.extractForDocument(documentId)).rejects.toThrow('DOCUMENT_UNAVAILABLE')
    expect(f.sourceTextExtractor.extract).not.toHaveBeenCalled()
    expect(f.modelAdapter.extract).not.toHaveBeenCalled()
    expect(f.serviceClient.rpc).not.toHaveBeenCalled()
  })

  it('rejects removed or non-patient-upload sources', async () => {
    for (const override of [{ status: 'removed' }, { source: 'clinical_record' }]) {
      const f = setup({ document: override })
      await expect(f.service.extractForDocument(documentId)).rejects.toThrow('DOCUMENT_UNAVAILABLE')
      expect(f.modelAdapter.extract).not.toHaveBeenCalled()
    }
  })

  it('preserves negation and rejects invented source excerpts', async () => {
    const uncertain = candidate({ factType: 'condition_candidate', name: 'Drug X use', valueText: 'denied',
      valueNumeric: null, explanation: 'The record contains a denial, not an established diagnosis.',
      sourceLocator: { page: 1, section: 'History', excerpt: 'The patient denies Drug X' } })
    expect((await setup({ facts: [uncertain] }).service.extractForDocument(documentId)).candidate_facts[0].valueText).toBe('denied')
    const invented = setup({ facts: [candidate({ sourceLocator: { page: 1, section: 'Lab Results', excerpt: 'Invented 999 value' } })] })
    await expect(invented.service.extractForDocument(documentId)).rejects.toThrow('INVALID_EXTRACTION_OUTPUT')
    expect(invented.serviceClient.rpc).not.toHaveBeenCalled()
  })

  it('rejects model self-confirmation and writes no authoritative clinical records', async () => {
    const invalid = setup({ facts: [candidate({ reviewRequired: false })] })
    await expect(invalid.service.extractForDocument(documentId)).rejects.toThrow('INVALID_EXTRACTION_OUTPUT')
    expect(invalid.serviceClient.rpc).not.toHaveBeenCalled()
    const valid = setup()
    await valid.service.extractForDocument(documentId)
    expect(valid.serviceClient.rpc.mock.calls.map(([name]) => name)).toEqual(['record_document_extracted_facts'])
  })

  it('preserves temporary provider exhaustion before writing candidate facts', async () => {
    const f = setup()
    f.sourceTextExtractor.extract.mockRejectedValue(new Error('PROVIDER_TEMPORARILY_UNAVAILABLE'))
    await expect(f.service.extractForDocument(documentId)).rejects.toThrow('TEMPORARY_PROVIDER_UNAVAILABLE')
    expect(f.modelAdapter.extract).not.toHaveBeenCalled()
    expect(f.serviceClient.rpc).not.toHaveBeenCalled()
  })
})
