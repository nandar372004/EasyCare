import { MEDICAL_DOCUMENT_BUCKET, MEDICAL_DOCUMENT_MAX_BYTES, MEDICAL_DOCUMENT_FORMATS } from './medical-document-contract.js'
import {
  DOCUMENT_CLASSIFICATION_JSON_SCHEMA, DOCUMENT_CLASSIFICATION_SYSTEM_INSTRUCTIONS,
  DOCUMENT_CLASSIFICATION_SCHEMA_VERSION, DOCUMENT_CLASSIFICATION_PROMPT_VERSION,
  isDocumentReference, validateDocumentClassificationOutput,
} from './document-classification-contract.js'

const fail = code => { throw new Error(code) }
const SAFE_ERRORS = new Set([
  'INVALID_DOCUMENT_REFERENCE', 'CLASSIFICATION_UNAVAILABLE', 'UNAUTHORIZED',
  'DOCUMENT_UNAVAILABLE', 'INVALID_CLASSIFICATION_OUTPUT', 'TEMPORARY_PROVIDER_UNAVAILABLE',
])

/**
 * Server-only boundary. userClient must carry the verified caller's JWT;
 * serviceClient and modelAdapter must be constructed by trusted server code.
 * No browser endpoint or live AI provider is enabled by this module.
 */
export function createDocumentClassificationService({ userClient, serviceClient, modelAdapter, onDiagnostic } = {}) {
  const reportDiagnostic = details => {
    if (typeof onDiagnostic !== 'function') return
    try { onDiagnostic(details) } catch { /* Diagnostics must not affect classification. */ }
  }
  async function authorize(documentId, userId) {
    const { data: extractionId, error } = await userClient.rpc('request_my_document_extraction', {
      p_clinical_document_id: documentId,
    })
    if (error || !isDocumentReference(extractionId)) {
      reportDiagnostic({ stage: 'document_lookup', event: 'failed', operation: 'extraction_authorization' })
      fail('DOCUMENT_UNAVAILABLE')
    }
    const { data: extraction, error: readError } = await userClient.from('document_extractions')
      .select('id,clinical_document_id,requested_by_profile_id,extraction_status')
      .eq('id', extractionId).maybeSingle()
    if (readError || extraction?.clinical_document_id !== documentId
      || extraction?.requested_by_profile_id !== userId
      || extraction?.extraction_status !== 'pending') {
      reportDiagnostic({ stage: 'document_lookup', event: 'failed', operation: 'extraction_record' })
      fail('DOCUMENT_UNAVAILABLE')
    }
    reportDiagnostic({ stage: 'document_lookup', event: 'success' })
    return extractionId
  }

  async function classify(documentId) {
      if (!isDocumentReference(documentId)) fail('INVALID_DOCUMENT_REFERENCE')
      documentId = documentId.toLowerCase()
      if (!userClient?.auth?.getUser || !serviceClient?.rpc
        || typeof modelAdapter?.classify !== 'function') fail('CLASSIFICATION_UNAVAILABLE')
      let metadata = { ...modelAdapter.metadata }
      if (!metadata || ['provider', 'name', 'version'].some(key =>
        typeof metadata[key] !== 'string' || !metadata[key].trim()
          || metadata[key].length > (key === 'provider' ? 120 : 160))) {
        reportDiagnostic({ stage: 'classification_setup', event: 'invalid_model_metadata' })
        fail('CLASSIFICATION_UNAVAILABLE')
      }

      const { data: authData, error: authError } = await userClient.auth.getUser()
      const rawUserId = authData?.user?.id
      if (authError || !isDocumentReference(rawUserId)) fail('UNAUTHORIZED')
      const userId = rawUserId.toLowerCase()
      const extractionId = await authorize(documentId, userId)
      const { data: document, error: documentError } = await userClient.from('clinical_documents')
        .select('id,source,status,storage_bucket,storage_path,mime_type,file_size,original_filename')
        .eq('id', documentId).eq('source', 'patient_upload').eq('status', 'active').maybeSingle()
      if (documentError || document?.id !== documentId || document.source !== 'patient_upload'
        || document.status !== 'active' || document.storage_bucket !== MEDICAL_DOCUMENT_BUCKET
        || !document.storage_path || !MEDICAL_DOCUMENT_FORMATS[document.mime_type]
        || !Number.isSafeInteger(document.file_size) || document.file_size < 1
        || document.file_size > MEDICAL_DOCUMENT_MAX_BYTES) {
        reportDiagnostic({ stage: 'document_lookup', event: 'failed', operation: 'clinical_document_metadata' })
        fail('DOCUMENT_UNAVAILABLE')
      }
      reportDiagnostic({ stage: 'document_lookup', event: 'success' })

      // Download through the caller's Storage RLS, never a privileged file URL.
      const { data: file, error: fileError } = await userClient.storage.from(document.storage_bucket).download(document.storage_path)
      if (fileError || !file || file.size !== document.file_size
        || typeof file.arrayBuffer !== 'function') {
        reportDiagnostic({ stage: 'private_document_read', event: 'failed', error_code: 'STORAGE_DOWNLOAD_FAILED' })
        fail('DOCUMENT_UNAVAILABLE')
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (bytes.byteLength !== document.file_size) {
        reportDiagnostic({ stage: 'private_document_read', event: 'failed', error_code: 'SIZE_MISMATCH' })
        fail('DOCUMENT_UNAVAILABLE')
      }
      reportDiagnostic({ stage: 'private_document_read', event: 'success', mime_type: document.mime_type, byte_length: bytes.byteLength })
      // A file may have been removed or access revoked during the download.
      if (await authorize(documentId, userId) !== extractionId) fail('DOCUMENT_UNAVAILABLE')
      let payload
      try {
        payload = await modelAdapter.classify({
          bytes, mimeType: document.mime_type, filename: document.original_filename || 'medical-document', source_document_id: documentId,
          systemInstructions: DOCUMENT_CLASSIFICATION_SYSTEM_INSTRUCTIONS,
          outputSchema: DOCUMENT_CLASSIFICATION_JSON_SCHEMA,
        })
      } catch (error) {
        const providerCode = typeof error?.message === 'string' && /^PROVIDER_[A-Z_]+$/.test(error.message)
          ? error.message : 'CLASSIFICATION_ADAPTER_ERROR'
        reportDiagnostic({ stage: 'classification_adapter', event: 'failed', error_code: providerCode })
        fail(error?.message === 'PROVIDER_TEMPORARILY_UNAVAILABLE' ? 'TEMPORARY_PROVIDER_UNAVAILABLE' : 'CLASSIFICATION_UNAVAILABLE')
      }
      metadata = { ...modelAdapter.metadata }
      const result = validateDocumentClassificationOutput(payload, documentId)
      if (!result.success) {
        reportDiagnostic({ stage: 'classification_schema_validation', event: 'failed', error_code: result.error })
        fail(result.error)
      }
      reportDiagnostic({ stage: 'classification_schema_validation', event: 'success' })

      // Recheck current caller/source access after the model operation. The save
      // RPC also locks and rechecks source, identity and storage before updating.
      if (await authorize(documentId, userId) !== extractionId) fail('DOCUMENT_UNAVAILABLE')
      let savedId
      let saveError
      try {
        ({ data: savedId, error: saveError } = await serviceClient.rpc('record_document_classification_candidate', {
          p_extraction_id: extractionId,
          p_document_type: result.data.document_type,
          p_confidence: result.data.confidence,
          p_model_provider: metadata.provider,
          p_model_name: metadata.name,
          p_model_version: metadata.version,
        }))
      } catch (error) { saveError = error }
      if (saveError || savedId !== extractionId) {
        const databaseCode = typeof saveError?.code === 'string' && /^[0-9A-Z]{5}$/.test(saveError.code)
          ? saveError.code : saveError ? 'DATABASE_ERROR' : 'RESULT_MISMATCH'
        reportDiagnostic({ stage: 'classification_persistence', event: 'failed', error_code: databaseCode })
        fail('CLASSIFICATION_UNAVAILABLE')
      }
      reportDiagnostic({ stage: 'classification_persistence', event: 'success' })
      return {
        ...result.data, source_document_id: documentId,
        extraction_id: extractionId, review_status: 'needs_review',
        schema_version: DOCUMENT_CLASSIFICATION_SCHEMA_VERSION,
        prompt_version: DOCUMENT_CLASSIFICATION_PROMPT_VERSION,
      }
  }

  return {
    async classifyForDocument(documentId) {
      try { return await classify(documentId) }
      catch (error) {
        fail(SAFE_ERRORS.has(error?.message) ? error.message : 'CLASSIFICATION_UNAVAILABLE')
      }
    },
  }
}
