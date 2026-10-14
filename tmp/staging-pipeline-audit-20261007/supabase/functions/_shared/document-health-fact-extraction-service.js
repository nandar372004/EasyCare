import {
  DOCUMENT_EXTRACTION_JSON_SCHEMA, DOCUMENT_EXTRACTION_SCHEMA_VERSION,
  DOCUMENT_EXTRACTION_SYSTEM_INSTRUCTIONS, getDocumentExtractionConfidenceBand,
  validateDocumentExtractionOutput,
} from './document-extraction-contract.js'
import { MEDICAL_DOCUMENT_BUCKET, MEDICAL_DOCUMENT_FORMATS, MEDICAL_DOCUMENT_MAX_BYTES } from './medical-document-contract.js'
import { isDocumentReference } from './document-classification-contract.js'

const fail = code => { throw new Error(code) }
const SAFE_ERRORS = new Set(['INVALID_DOCUMENT_REFERENCE', 'UNAUTHORIZED', 'DOCUMENT_UNAVAILABLE', 'INVALID_EXTRACTION_OUTPUT', 'EXTRACTION_UNAVAILABLE'])

/** Trusted server boundary; callers must provide authenticated userClient and server-only adapters. */
export function createDocumentHealthFactExtractionService({ userClient, serviceClient, sourceTextExtractor, modelAdapter } = {}) {
  async function authorize(documentId, userId) {
    // This is deliberately read-only: request_my_document_extraction creates a
    // new pending run after classification, so it must not be used as a lookup.
    const { data: run, error: runError } = await userClient.from('document_extractions')
      .select('id,clinical_document_id,requested_by_profile_id,extraction_status,document_type,classified_at')
      .eq('clinical_document_id', documentId).eq('requested_by_profile_id', userId)
      .eq('extraction_status', 'needs_review').not('classified_at', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const extractionId = run?.id
    if (runError || run?.clinical_document_id !== documentId || run?.requested_by_profile_id !== userId
      || !isDocumentReference(extractionId) || run?.extraction_status !== 'needs_review' || !run?.classified_at || !run?.document_type) fail('DOCUMENT_UNAVAILABLE')
    return { extractionId, documentType: run.document_type }
  }

  async function extract(documentId) {
    if (!isDocumentReference(documentId)) fail('INVALID_DOCUMENT_REFERENCE')
    documentId = documentId.toLowerCase()
    if (!userClient?.auth?.getUser || !serviceClient?.rpc || typeof sourceTextExtractor?.extract !== 'function'
      || typeof modelAdapter?.extract !== 'function') fail('EXTRACTION_UNAVAILABLE')
    const metadata = { ...modelAdapter.metadata }
    if (!metadata || ['provider', 'name', 'version'].some(key => typeof metadata[key] !== 'string'
      || !metadata[key].trim() || metadata[key].length > (key === 'provider' ? 120 : 160))) fail('EXTRACTION_UNAVAILABLE')

    const { data: authData, error: authError } = await userClient.auth.getUser()
    const rawUserId = authData?.user?.id
    if (authError || !isDocumentReference(rawUserId)) fail('UNAUTHORIZED')
    const userId = rawUserId.toLowerCase()
    const { extractionId, documentType } = await authorize(documentId, userId)
    const { data: document, error: documentError } = await userClient.from('clinical_documents')
      .select('id,source,status,storage_bucket,storage_path,mime_type,file_size,original_filename')
      .eq('id', documentId).eq('source', 'patient_upload').eq('status', 'active').maybeSingle()
    if (documentError || document?.id !== documentId || document.source !== 'patient_upload'
      || document.status !== 'active' || document.storage_bucket !== MEDICAL_DOCUMENT_BUCKET
      || !document.storage_path || !MEDICAL_DOCUMENT_FORMATS[document.mime_type]
      || !Number.isSafeInteger(document.file_size) || document.file_size < 1 || document.file_size > MEDICAL_DOCUMENT_MAX_BYTES) {
      fail('DOCUMENT_UNAVAILABLE')
    }

    const { data: file, error: fileError } = await userClient.storage.from(document.storage_bucket).download(document.storage_path)
    if (fileError || !file || file.size !== document.file_size || typeof file.arrayBuffer !== 'function') fail('DOCUMENT_UNAVAILABLE')
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.byteLength !== document.file_size) fail('DOCUMENT_UNAVAILABLE')
    if ((await authorize(documentId, userId)).extractionId !== extractionId) fail('DOCUMENT_UNAVAILABLE')

    let sourceText
    try { sourceText = await sourceTextExtractor.extract({ bytes, mimeType: document.mime_type, filename: document.original_filename || 'medical-document', source_document_id: documentId }) }
    catch { fail('EXTRACTION_UNAVAILABLE') }
    if (typeof sourceText !== 'string' || !sourceText.trim() || sourceText.length > 500_000) fail('DOCUMENT_UNAVAILABLE')

    let payload
    try {
      payload = await modelAdapter.extract({
        sourceText, mimeType: document.mime_type, source_document_id: documentId,
        documentType, systemInstructions: DOCUMENT_EXTRACTION_SYSTEM_INSTRUCTIONS,
        outputSchema: DOCUMENT_EXTRACTION_JSON_SCHEMA,
      })
    } catch { fail('EXTRACTION_UNAVAILABLE') }
    const result = validateDocumentExtractionOutput(payload, {
      expectedSourceDocumentId: documentId, allowedDocumentTypes: [documentType], sourceText,
    })
    if (!result.success) fail('INVALID_EXTRACTION_OUTPUT')
    if ((await authorize(documentId, userId)).extractionId !== extractionId) fail('DOCUMENT_UNAVAILABLE')

    const { data: insertedCount, error: saveError } = await serviceClient.rpc('record_document_extracted_facts', {
      p_extraction_id: extractionId,
      p_summary: result.data.summary,
      p_candidate_facts: result.data.candidateFacts,
    })
    if (saveError || !Number.isInteger(insertedCount) || insertedCount < 0) fail('EXTRACTION_UNAVAILABLE')
    return {
      extraction_id: extractionId, source_document_id: documentId,
      document_type: result.data.documentType, summary: result.data.summary,
      candidate_facts: result.data.candidateFacts.map(fact => ({
        ...fact, confidence_band: getDocumentExtractionConfidenceBand(fact.confidence), review_status: 'needs_review',
      })),
      inserted_count: insertedCount, review_required: true,
      schema_version: DOCUMENT_EXTRACTION_SCHEMA_VERSION,
    }
  }

  return {
    async extractForDocument(documentId) {
      try { return await extract(documentId) }
      catch (error) { fail(SAFE_ERRORS.has(error?.message) ? error.message : 'EXTRACTION_UNAVAILABLE') }
    },
  }
}
