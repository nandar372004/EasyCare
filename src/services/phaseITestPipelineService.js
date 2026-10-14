import { supabase } from '../lib/supabase.js'

export const isPhaseITestPipelineAvailable = import.meta.env.DEV || import.meta.env.MODE === 'test'

const developmentErrors = Object.freeze({
  DOCUMENT_NOT_FOUND: 'That document could not be found. Refresh your document list and try again.',
  WRONG_OWNER: 'That document is not owned by the active patient account.',
  WRONG_DOCUMENT_TYPE: 'Test processing is available for Lab Reports only.',
  TEST_PIPELINE_DISABLED: 'The development test-processing endpoint is disabled.',
  TEST_FIXTURE_REQUIRED: 'This deterministic test pipeline accepts the supplied synthetic Lab Report PDF only.',
  DOCUMENT_ALREADY_PROCESSED: 'This document already has an active candidate. Review or reject it before running test processing again.',
  UNAUTHORIZED: 'Your session is no longer valid. Sign in again and retry.',
  FORBIDDEN: 'An active patient account is required to process this document.',
  DOCUMENT_PIPELINE_UNAVAILABLE: 'Document processing failed. Check the test endpoint configuration and retry.',
})

async function getFunctionErrorCode(error, data) {
  if (typeof data?.error === 'string') return data.error
  const response = error?.context
  if (response && typeof response.clone === 'function') {
    try {
      const body = await response.clone().json()
      if (typeof body?.error === 'string') return body.error
    } catch { /* The response body may not be JSON. */ }
  }
  return ''
}

export function createPhaseITestPipelineService(client = supabase) {
  return {
    async processDocument(documentId) {
      if (!isPhaseITestPipelineAvailable || !client || !documentId) {
        throw new Error('Document test processing is available only in development or test mode.')
      }
      const { data, error } = await client.functions.invoke('document-pipeline-test', {
        body: { clinical_document_id: documentId },
      })
      if (error || !data || data.source_document_id !== documentId || data.synthetic_test_fixture !== true
        || data.review_status !== 'needs_review') {
        const code = await getFunctionErrorCode(error, data)
        const message = isPhaseITestPipelineAvailable
          ? developmentErrors[code] || 'Test processing failed. Refresh your document list and retry.'
          : 'We could not process this document for testing. Please try again.'
        throw new Error(message)
      }
      return data
    },
  }
}

export const phaseITestPipelineService = createPhaseITestPipelineService()
