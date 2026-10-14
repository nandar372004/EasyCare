import { describe, expect, it, vi } from 'vitest'
import { createPhaseITestPipelineService } from './phaseITestPipelineService.js'

describe('Phase I test processing service', () => {
  it('sends the exact clicked document ID in the request body', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: {
      source_document_id: 'report-b', synthetic_test_fixture: true, review_status: 'needs_review', candidate_count: 1,
    }, error: null })
    const service = createPhaseITestPipelineService({ functions: { invoke } })
    await service.processDocument('report-b')
    expect(invoke).toHaveBeenCalledWith('document-pipeline-test', { body: { clinical_document_id: 'report-b' } })
  })

  it('maps server ownership, type, and disabled-endpoint errors to clear development messages', async () => {
    for (const [code, message] of [
      ['DOCUMENT_NOT_FOUND', /could not be found/i],
      ['WRONG_OWNER', /not owned/i],
      ['WRONG_DOCUMENT_TYPE', /Lab Reports only/i],
      ['TEST_PIPELINE_DISABLED', /endpoint is disabled/i],
      ['DOCUMENT_PIPELINE_UNAVAILABLE', /processing failed/i],
    ]) {
      const error = { context: new Response(JSON.stringify({ error: code }), { status: 422 }) }
      const service = createPhaseITestPipelineService({ functions: { invoke: vi.fn().mockResolvedValue({ data: null, error }) } })
      await expect(service.processDocument('report-a')).rejects.toThrow(message)
    }
  })
})
