import { supabase } from '../lib/supabase.js'

export const isRealDocumentPipelineAvailable = (import.meta.env.DEV || import.meta.env.MODE === 'test')
  && import.meta.env.VITE_ENABLE_PHASE_I_REAL_EXTRACTION_UI === 'true'

const developmentErrors = Object.freeze({
  PIPELINE_DISABLED: 'Real document extraction is disabled for this environment.',
  PIPELINE_CONFIGURATION_MISSING: 'AI service configuration is missing.',
  ORIGIN_DENIED: 'This browser origin is not allowed to use document extraction.',
  DOCUMENT_NOT_FOUND: 'That document could not be found. Refresh your document list and try again.',
  FORBIDDEN: 'Only the active patient who uploaded this document can process it.',
  UNSUPPORTED_DOCUMENT: 'This file is not a supported PDF, JPEG, or PNG document under 10 MB.',
  DOCUMENT_UNAVAILABLE: 'This file could not be read. Confirm it is still available and try again.',
  DOCUMENT_ALREADY_PROCESSED: 'This document already has active candidate information. Review or reject it before processing again.',
  TEMPORARY_PROVIDER_UNAVAILABLE: 'AI processing is temporarily busy. Please try again shortly.',
  UNAUTHORIZED: 'Your session is no longer valid. Sign in again and retry.',
  INVALID_REQUEST: 'The extraction request could not be validated. Refresh and try again.',
  CLASSIFICATION_UNAVAILABLE: 'Document processing is temporarily unavailable. Your source document remains unchanged.',
  INVALID_CLASSIFICATION_OUTPUT: 'The AI service returned an invalid response. No candidate was accepted.',
  EXTRACTION_UNAVAILABLE: 'Document processing is temporarily unavailable. Your source document remains unchanged.',
  INVALID_EXTRACTION_OUTPUT: 'The AI service returned an invalid response. No candidate was accepted.',
  INVALID_FACT_EXPLANATION: 'The AI service returned an invalid response. No candidate was accepted.',
  EXPLANATION_UNAVAILABLE: 'Document processing is temporarily unavailable. Your source document remains unchanged.',
  DOCUMENT_PIPELINE_FAILED: 'Document processing is temporarily unavailable. Your source document remains unchanged.',
})

function pipelineError(code, fallback = 'Document processing is temporarily unavailable. Your source document remains unchanged.') {
  const error = new Error(developmentErrors[code] ?? fallback)
  error.code = code || 'DOCUMENT_PIPELINE_FAILED'
  return error
}

export function createRealDocumentPipelineService(client = supabase, { available = isRealDocumentPipelineAvailable } = {}) {
  return {
    async processDocument(documentId) {
      if (!available || !client || !documentId) throw pipelineError('PIPELINE_DISABLED')
      const { data, error } = await client.functions.invoke('document-pipeline', { body: { clinical_document_id: documentId } })
      if (error || !data || data.source_document_id !== documentId || data.review_status !== 'needs_review') {
        let code = typeof data?.error === 'string' ? data.error : ''
        if (!code && error?.context?.clone) {
          try { code = (await error.context.clone().json())?.error ?? '' } catch { /* Use safe generic error. */ }
        }
        throw pipelineError(code)
      }
      return data
    },
  }
}

export const realDocumentPipelineService = createRealDocumentPipelineService()
