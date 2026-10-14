// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createDocumentClassificationService } from '../../supabase/functions/_shared/document-classification-service.js'

const documentId = '76000000-0000-4000-8000-000000000020'
const extractionId = '76000000-0000-4000-8000-000000000021'
const userId = '76000000-0000-4000-8000-000000000001'

function fixture({ document_type = 'lab_report', confidence = 0.95, content = '%PDF-Laboratory Report\nTest results', output = {} } = {}) {
  const file = new Blob([content], { type: 'application/pdf' })
  const document = {
    id: documentId, source: 'patient_upload', status: 'active', storage_bucket: 'medical-documents',
    storage_path: `patient/${documentId}/source.pdf`, mime_type: 'application/pdf', file_size: file.size,
  }
  const extraction = { id: extractionId, clinical_document_id: documentId, requested_by_profile_id: userId, extraction_status: 'pending' }
  const queries = Object.fromEntries(Object.entries({ clinical_documents: document, document_extractions: extraction }).map(([table, data]) => {
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: vi.fn(async () => ({ data, error: null })) }
    return [table, query]
  }))
  const download = vi.fn(async () => ({ data: file, error: null }))
  const userClient = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })) },
    rpc: vi.fn(async () => ({ data: extractionId, error: null })),
    from: vi.fn(table => queries[table]), storage: { from: vi.fn(() => ({ download })) },
  }
  const serviceClient = { rpc: vi.fn(async () => ({ data: extractionId, error: null })) }
  const modelAdapter = {
    metadata: { provider: 'synthetic-test', name: 'classification-fixture', version: 'v1' },
    classify: vi.fn(async () => ({ document_type, confidence, review_required: true, source_document_id: documentId, ...output })),
  }
  return { userClient, serviceClient, modelAdapter, document, extraction, queries, download, service: createDocumentClassificationService({ userClient, serviceClient, modelAdapter }) }
}

describe('server-only document classification boundary', () => {
  it.each([
    ['lab_report', '%PDF-Laboratory Report\nHb 12 g/dL'],
    ['prescription', '%PDF-Prescription\nIssued medicines'],
    ['imaging_report', '%PDF-Imaging Report\nRadiologist findings'],
    ['discharge_summary', '%PDF-Discharge Summary\nHospital stay'],
    ['referral', '%PDF-Referral Letter'], ['progress_note', '%PDF-Progress Note'],
    ['other', '%PDF-Ambiguous mixed notes'],
  ])('validates and saves a candidate %s without extracting facts', async (type, content) => {
    const f = fixture({ document_type: type, content, confidence: type === 'other' ? 0.2 : 0.95 })
    const result = await f.service.classifyForDocument(documentId)
    expect(result).toMatchObject({ document_type: type, confidence: type === 'other' ? 0.2 : 0.95,
      review_required: true, source_document_id: documentId, extraction_id: extractionId, review_status: 'needs_review' })
    expect(new TextDecoder().decode(f.modelAdapter.classify.mock.calls[0][0].bytes)).toBe(content)
    expect(f.modelAdapter.classify.mock.calls[0][0]).not.toHaveProperty('document_type')
    expect(f.userClient.rpc).toHaveBeenCalledTimes(3)
    expect(f.userClient.rpc).toHaveBeenCalledWith('request_my_document_extraction', { p_clinical_document_id: documentId })
    expect(f.serviceClient.rpc).toHaveBeenCalledOnce()
    expect(f.serviceClient.rpc).toHaveBeenCalledWith('record_document_classification_candidate', {
      p_extraction_id: extractionId, p_document_type: type, p_confidence: type === 'other' ? 0.2 : 0.95,
      p_model_provider: 'synthetic-test', p_model_name: 'classification-fixture', p_model_version: 'v1',
    })
    expect(new Set(f.userClient.from.mock.calls.map(([table]) => table)))
      .toEqual(new Set(['document_extractions', 'clinical_documents']))
    expect(result).not.toHaveProperty('candidateFacts')
  })

  it.each(['unauthorized', 'removed'])('stops before reading content or calling AI when request is %s', async () => {
    const f = fixture()
    f.userClient.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(f.service.classifyForDocument(documentId)).rejects.toThrow('DOCUMENT_UNAVAILABLE')
    expect(f.download).not.toHaveBeenCalled()
    expect(f.modelAdapter.classify).not.toHaveBeenCalled()
    expect(f.serviceClient.rpc).not.toHaveBeenCalled()
  })

  it('requires a verified caller', async () => {
    const f = fixture()
    f.userClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: {} })
    await expect(f.service.classifyForDocument(documentId)).rejects.toThrow('UNAUTHORIZED')
    expect(f.userClient.rpc).not.toHaveBeenCalled()
  })

  it.each([
    { status: 'removed' }, { source: 'clinical_record' }, { storage_bucket: 'public' },
    { mime_type: 'text/plain' }, { file_size: 0 }, { file_size: 11 * 1024 * 1024 },
  ])('rejects an unavailable or unsupported source %# before AI', async override => {
    const f = fixture()
    Object.assign(f.document, override)
    await expect(f.service.classifyForDocument(documentId)).rejects.toThrow('DOCUMENT_UNAVAILABLE')
    expect(f.modelAdapter.classify).not.toHaveBeenCalled()
  })

  it('fails closed when Storage RLS denies access', async () => {
    const f = fixture()
    f.download.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(f.service.classifyForDocument(documentId)).rejects.toThrow('DOCUMENT_UNAVAILABLE')
    expect(f.modelAdapter.classify).not.toHaveBeenCalled()
  })

  it('rejects mismatched downloaded file size', async () => {
    const f = fixture()
    f.download.mockResolvedValue({ data: new Blob(['wrong']), error: null })
    await expect(f.service.classifyForDocument(documentId)).rejects.toThrow('DOCUMENT_UNAVAILABLE')
    expect(f.modelAdapter.classify).not.toHaveBeenCalled()
  })

  it.each([
    { document_type: 'diagnosis' }, { confidence: 2 }, { review_required: false },
    { source_document_id: extractionId }, { medications: ['not allowed'] },
  ])('rejects invalid AI payload %# before any candidate save', async output => {
    const f = fixture({ output })
    await expect(f.service.classifyForDocument(documentId)).rejects.toThrow('INVALID_CLASSIFICATION_OUTPUT')
    expect(f.serviceClient.rpc).not.toHaveBeenCalled()
  })

  it('preserves temporary provider exhaustion without creating a duplicate classification candidate', async () => {
    const f = fixture()
    f.modelAdapter.classify.mockRejectedValue(new Error('PROVIDER_TEMPORARILY_UNAVAILABLE'))
    await expect(f.service.classifyForDocument(documentId)).rejects.toThrow('TEMPORARY_PROVIDER_UNAVAILABLE')
    expect(f.modelAdapter.classify).toHaveBeenCalledOnce()
    expect(f.serviceClient.rpc).not.toHaveBeenCalled()
  })

  it('rechecks removal or revoked access after classification', async () => {
    const f = fixture()
    f.userClient.rpc.mockResolvedValueOnce({ data: extractionId, error: null })
      .mockResolvedValueOnce({ data: extractionId, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    await expect(f.service.classifyForDocument(documentId)).rejects.toThrow('DOCUMENT_UNAVAILABLE')
    expect(f.modelAdapter.classify).toHaveBeenCalledOnce()
    expect(f.serviceClient.rpc).not.toHaveBeenCalled()
  })

  it('rechecks source authorization after download and before calling AI', async () => {
    const f = fixture()
    f.userClient.rpc.mockResolvedValueOnce({ data: extractionId, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    await expect(f.service.classifyForDocument(documentId)).rejects.toThrow('DOCUMENT_UNAVAILABLE')
    expect(f.download).toHaveBeenCalledOnce()
    expect(f.modelAdapter.classify).not.toHaveBeenCalled()
    expect(f.serviceClient.rpc).not.toHaveBeenCalled()
  })

  it('suppresses raw transport errors', async () => {
    const f = fixture()
    f.userClient.auth.getUser.mockRejectedValue(new Error('sensitive transport detail'))
    await expect(f.service.classifyForDocument(documentId)).rejects.toThrow(/^CLASSIFICATION_UNAVAILABLE$/)
  })

  it('rejects an extraction run belonging to another caller', async () => {
    const f = fixture()
    f.extraction.requested_by_profile_id = extractionId
    await expect(f.service.classifyForDocument(documentId)).rejects.toThrow('DOCUMENT_UNAVAILABLE')
    expect(f.modelAdapter.classify).not.toHaveBeenCalled()
  })

  it('rejects a concurrent processing run rather than overwriting it', async () => {
    const f = fixture()
    f.extraction.extraction_status = 'processing'
    await expect(f.service.classifyForDocument(documentId)).rejects.toThrow('DOCUMENT_UNAVAILABLE')
    expect(f.modelAdapter.classify).not.toHaveBeenCalled()
  })

  it('sanitizes provider failures and writes no candidate result', async () => {
    const f = fixture()
    f.modelAdapter.classify.mockRejectedValue(new Error('sensitive provider content'))
    await expect(f.service.classifyForDocument(documentId)).rejects.toThrow(/^CLASSIFICATION_UNAVAILABLE$/)
    expect(f.serviceClient.rpc).not.toHaveBeenCalled()
  })

  it('reports the safe first failing boundary for provider and persistence errors', async () => {
    const providerFailure = fixture()
    const providerEvents = []
    providerFailure.modelAdapter.classify.mockRejectedValue(new Error('PROVIDER_TIMEOUT'))
    const providerService = createDocumentClassificationService({
      userClient: providerFailure.userClient, serviceClient: providerFailure.serviceClient,
      modelAdapter: providerFailure.modelAdapter, onDiagnostic: event => providerEvents.push(event),
    })
    await expect(providerService.classifyForDocument(documentId)).rejects.toThrow('CLASSIFICATION_UNAVAILABLE')
    expect(providerEvents).toContainEqual({
      stage: 'private_document_read', event: 'success', mime_type: 'application/pdf', byte_length: providerFailure.document.file_size,
    })
    expect(providerEvents).toContainEqual({
      stage: 'classification_adapter', event: 'failed', error_code: 'PROVIDER_TIMEOUT',
    })

    const persistenceFailure = fixture()
    const persistenceEvents = []
    persistenceFailure.serviceClient.rpc.mockResolvedValue({ data: null, error: { code: '23503', message: 'private database detail' } })
    const persistenceService = createDocumentClassificationService({
      userClient: persistenceFailure.userClient, serviceClient: persistenceFailure.serviceClient,
      modelAdapter: persistenceFailure.modelAdapter, onDiagnostic: event => persistenceEvents.push(event),
    })
    await expect(persistenceService.classifyForDocument(documentId)).rejects.toThrow('CLASSIFICATION_UNAVAILABLE')
    expect(persistenceEvents).toContainEqual({
      stage: 'classification_persistence', event: 'failed', error_code: '23503',
    })
    expect(JSON.stringify(persistenceEvents)).not.toContain('private database detail')
  })

  it('fails closed if the server save recheck is denied', async () => {
    const f = fixture()
    f.serviceClient.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(f.service.classifyForDocument(documentId)).rejects.toThrow('CLASSIFICATION_UNAVAILABLE')
  })

  it('rejects malformed document references before authentication', async () => {
    const f = fixture()
    await expect(f.service.classifyForDocument('bad')).rejects.toThrow('INVALID_DOCUMENT_REFERENCE')
    expect(f.userClient.auth.getUser).not.toHaveBeenCalled()
  })
})
