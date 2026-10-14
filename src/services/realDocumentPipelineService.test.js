import { describe, expect, it, vi } from 'vitest'
import { createRealDocumentPipelineService } from './realDocumentPipelineService.js'

function clientWith(result) {
  return { functions: { invoke: vi.fn().mockResolvedValue(result) } }
}

describe('real document pipeline service', () => {
  it('invokes document-pipeline for the selected document and accepts only needs-review output', async () => {
    const client = clientWith({ data: { source_document_id: 'doc-1', review_status: 'needs_review', candidate_count: 1 }, error: null })
    await expect(createRealDocumentPipelineService(client, { available: true }).processDocument('doc-1'))
      .resolves.toMatchObject({ candidate_count: 1, review_status: 'needs_review' })
    expect(client.functions.invoke).toHaveBeenCalledWith('document-pipeline', { body: { clinical_document_id: 'doc-1' } })
  })

  it('surfaces a safe configuration message from a structured Edge error', async () => {
    const client = clientWith({ data: { error: 'PIPELINE_CONFIGURATION_MISSING' }, error: null })
    await expect(createRealDocumentPipelineService(client, { available: true }).processDocument('doc-1'))
      .rejects.toMatchObject({ code: 'PIPELINE_CONFIGURATION_MISSING', message: 'AI service configuration is missing.' })
  })

  it('surfaces the safe temporary provider overload message', async () => {
    const client = clientWith({ data: { error: 'TEMPORARY_PROVIDER_UNAVAILABLE' }, error: null })
    await expect(createRealDocumentPipelineService(client, { available: true }).processDocument('doc-1'))
      .rejects.toMatchObject({ code: 'TEMPORARY_PROVIDER_UNAVAILABLE', message: 'AI processing is temporarily busy. Please try again shortly.' })
  })

  it('maps invalid provider output to a safe message and rejects unexpected success payloads', async () => {
    const client = clientWith({ data: { error: 'INVALID_EXTRACTION_OUTPUT' }, error: null })
    await expect(createRealDocumentPipelineService(client, { available: true }).processDocument('doc-1'))
      .rejects.toThrow('The AI service returned an invalid response. No candidate was accepted.')
    const malformed = clientWith({ data: { source_document_id: 'other', review_status: 'confirmed' }, error: null })
    await expect(createRealDocumentPipelineService(malformed, { available: true }).processDocument('doc-1'))
      .rejects.toThrow('Document processing is temporarily unavailable.')
  })

  it('does not invoke the function when the local UI gate is disabled', async () => {
    const client = clientWith({ data: {}, error: null })
    await expect(createRealDocumentPipelineService(client, { available: false }).processDocument('doc-1'))
      .rejects.toMatchObject({ code: 'PIPELINE_DISABLED' })
    expect(client.functions.invoke).not.toHaveBeenCalled()
  })
})
