import { describe, expect, it, vi } from 'vitest'
import { createDocumentExtractionReviewService } from './documentExtractionReviewService.js'

const factId = '76000000-0000-4000-8000-000000000030'
const documentId = '76000000-0000-4000-8000-000000000020'
const extractionId = '76000000-0000-4000-8000-000000000021'

function fixture() {
  const fact = { id: factId, extraction_id: extractionId, clinical_document_id: documentId,
    patient_id: '76000000-0000-4000-8000-000000000001', confidence: '0.42', confidence_band: 'low',
    review_status: 'needs_review', source_excerpt: 'Synthetic source excerpt' }
  const document = { id: documentId, title: 'Synthetic document', status: 'active' }
  const run = { id: extractionId, model_provider: 'synthetic-test', model_name: 'fixture', model_version: 'v1' }
  const queries = Object.fromEntries(Object.entries({ document_extracted_facts: fact, clinical_documents: document, document_extractions: run }).map(([table, data]) => {
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data, error: null })),
      then: undefined,
    }
    query.then = (resolve, reject) => Promise.resolve({ data: table === 'document_extracted_facts' ? [data] : [data], error: null }).then(resolve, reject)
    return [table, query]
  }))
  const rpc = vi.fn(async (_name, params) => ({ data: { fact_id: params.p_fact_id, review_status: params.p_decision, reviewed_at: '2026-10-07T00:00:00Z', review_note: params.p_note }, error: null }))
  const client = { from: vi.fn(table => queries[table]), rpc }
  return { fact, document, run, queries, client, service: createDocumentExtractionReviewService(client) }
}

describe('candidate fact review service boundaries', () => {
  it('lists only the requested review status through RLS and never accepts a patient id', async () => {
    const f = fixture()
    await expect(f.service.listMyCandidateFacts()).resolves.toMatchObject([{ id: factId, confidence_band: 'low' }])
    expect(f.client.from).toHaveBeenCalledWith('document_extracted_facts')
    expect(f.queries.document_extracted_facts.eq).toHaveBeenCalledWith('review_status', 'needs_review')
    expect(f.queries.document_extracted_facts.eq.mock.calls.some(([field]) => field === 'patient_id')).toBe(false)
  })

  it('fetches source excerpt, document date and extraction/model provenance without signed URLs', async () => {
    const f = fixture()
    const result = await f.service.getMyFactProvenance(factId)
    expect(result).toMatchObject({
      id: factId, source_excerpt: 'Synthetic source excerpt',
      document: { id: documentId, title: 'Synthetic document' },
      extraction: { id: extractionId, model_provider: 'synthetic-test' },
    })
    for (const query of ['document_extracted_facts', 'clinical_documents', 'document_extractions']) {
      expect(f.client.from).toHaveBeenCalledWith(query)
    }
    expect(result).not.toHaveProperty('signedUrl')
    expect(result).not.toHaveProperty('token')
  })

  it('submits only fact decision and optional note to the auth.uid-bound review RPC', async () => {
    const f = fixture()
    await expect(f.service.reviewMyFact({ factId, decision: 'confirmed', note: 'Reviewed source.' })).resolves.toMatchObject({
      fact_id: factId, review_status: 'confirmed', reviewed_at: expect.any(String),
    })
    expect(f.client.rpc).toHaveBeenCalledWith('review_my_document_extracted_fact', {
      p_fact_id: factId, p_decision: 'confirmed', p_note: 'Reviewed source.',
    })
    expect(f.client.rpc.mock.calls[0][1]).not.toHaveProperty('patient_id')
    expect(f.client.rpc.mock.calls[0][1]).not.toHaveProperty('reviewer_profile_id')
  })

  it('rejects invalid decision and note before any request', async () => {
    const f = fixture()
    await expect(f.service.reviewMyFact({ factId, decision: 'needs_review' })).rejects.toThrow(/unavailable/i)
    await expect(f.service.reviewMyFact({ factId, decision: 'rejected', note: ' '.repeat(4) })).rejects.toThrow(/unavailable/i)
    expect(f.client.rpc).not.toHaveBeenCalled()
  })

  it('lets the active candidate list omit rejected items by default', async () => {
    const f = fixture()
    await f.service.listMyCandidateFacts()
    expect(f.queries.document_extracted_facts.eq).toHaveBeenCalledWith('review_status', 'needs_review')
  })
})
