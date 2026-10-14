import { describe, expect, it, vi } from 'vitest'
import { createDocumentExtractionService } from './documentExtractionService.js'

const documentId = '76000000-0000-4000-8000-000000000020'
const extractionId = '76000000-0000-4000-8000-000000000021'

describe('document extraction service boundary', () => {
  it('requests an extraction using only the document id; patient ownership is server-derived', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: extractionId, error: null }) }
    await expect(createDocumentExtractionService(client).requestForDocument(documentId))
      .resolves.toEqual({ id: extractionId, extractionStatus: 'pending' })
    expect(client.rpc).toHaveBeenCalledWith('request_my_document_extraction', {
      p_clinical_document_id: documentId,
    })
    expect(client.rpc.mock.calls[0][1]).not.toHaveProperty('patient_id')
    expect(client.rpc.mock.calls[0][1]).not.toHaveProperty('user_id')
  })

  it('rejects invalid document ids before contacting the backend', async () => {
    const client = { rpc: vi.fn() }
    await expect(createDocumentExtractionService(client).requestForDocument('not-a-uuid')).rejects.toThrow(/unavailable/i)
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('fails closed when the ownership-bound request is denied', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } }) }
    await expect(createDocumentExtractionService(client).requestForDocument(documentId)).rejects.toThrow(/unavailable/i)
  })

  it('reads only through the RLS-protected extraction table', async () => {
    const row = { id: extractionId, extraction_status: 'pending' }
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) }
    const client = { from: vi.fn(() => query) }
    await expect(createDocumentExtractionService(client).get(extractionId)).resolves.toBe(row)
    expect(client.from).toHaveBeenCalledWith('document_extractions')
    expect(query.eq).toHaveBeenCalledWith('id', extractionId)
  })
})
