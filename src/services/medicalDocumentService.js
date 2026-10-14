import { supabase } from '../lib/supabase.js'
import {
  MEDICAL_DOCUMENT_BUCKET,
  MEDICAL_DOCUMENT_MAX_BYTES,
  MEDICAL_DOCUMENT_TYPES,
  validateMedicalDocument,
} from '../../supabase/functions/_shared/medical-document-contract.js'

const FAILURE = 'Unable to complete this medical document request. Please try again.'
const FUNCTION_TIMEOUT_MS = 60_000
const LIST_TIMEOUT_MS = 15_000
const SIGNED_URL_TIMEOUT_MS = 15_000
const INTAKE_ERRORS = Object.freeze({
  UNAUTHORIZED: 'Your session is no longer valid. Sign in again and retry.',
  PATIENT_IDENTITY_UNAVAILABLE: 'We could not confirm your patient account. Sign in again and retry.',
  FORBIDDEN: 'This account is not authorized to remove this document.',
  NOT_OWNER: 'This account is not authorized to remove this document.',
  DOCUMENT_UNAVAILABLE: 'This document was not found or you do not have permission to remove it.',
  DOCUMENT_NOT_FOUND: 'This document was not found or you do not have permission to remove it.',
  STORAGE_READ_FAILED: 'The private document file could not be verified. Nothing was removed.',
  STORAGE_DELETE_FAILED: 'The private document file could not be removed. Your document record was kept.',
  STORAGE_STATE_UNKNOWN: 'The private document file could not be safely verified. Refresh before retrying.',
  METADATA_REMOVE_FAILED: 'The document record could not be updated. The service attempted to restore the private file.',
  DATABASE_DEPENDENCY_BLOCKED: 'A linked record prevents this document from being removed. The service attempted to restore the private file.',
  REMOVAL_COMPENSATION_FAILED: 'The document could not be safely removed. Contact support before retrying.',
  REMOVAL_VERIFICATION_FAILED: 'The document could not be safely removed. The service attempted to restore its private file.',
  PRIVATE_BUCKET_UNAVAILABLE: 'Private document storage is unavailable. Try again later.',
  ORIGIN_DENIED: 'This browser origin is not allowed to manage medical documents.',
  ENDPOINT_VERSION_MISMATCH: 'The document service is unavailable or out of date. Please retry later.',
  NETWORK_FUNCTION_ERROR: 'Could not reach the document service. Check your connection and retry.',
  UNCLASSIFIED_FAILURE: 'The document service could not safely complete this request. Please retry later.',
  STORAGE_UPLOAD_FAILED: 'The private document file could not be saved.',
  METADATA_CREATE_FAILED: 'The document record could not be saved.',
  STORAGE_CLEANUP_FAILED: 'The upload could not be completed safely. Contact support before retrying.',
  FILE_SIZE_INVALID: 'Choose a file that is 10 MB or smaller.',
  UNSUPPORTED_FILE_TYPE: 'Choose a PDF, JPG, JPEG, or PNG file with a matching file type.',
  FILE_CONTENT_INVALID: 'This file could not be read. Choose it again and retry.',
  INVALID_REQUEST: 'The medical document request could not be validated. Refresh and try again.',
})

async function responseCode(data, error) {
  let code = typeof data?.error === 'string' ? data.error : ''
  let status = error?.context?.status ?? error?.status
  if (!code && error?.context?.clone) {
    try { code = (await error.context.clone().json())?.error ?? '' } catch { /* Use a safe generic message. */ }
  }
  return { code, status }
}

function withTimeout(promise, timeoutMs, message) {
  let timer
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs) }),
  ]).finally(() => clearTimeout(timer))
}

async function readFileBytes(file) {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer())
  if (typeof FileReader === 'undefined') throw new Error('FILE_CONTENT_INVALID')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('FILE_CONTENT_INVALID'))
    reader.onload = () => resolve(new Uint8Array(reader.result))
    reader.readAsArrayBuffer(file)
  })
}

export function createMedicalDocumentService(client = supabase) {
  async function invoke(body, errorMessage = FAILURE) {
    if (!client?.functions?.invoke) {
      const failure = new Error(INTAKE_ERRORS.NETWORK_FUNCTION_ERROR)
      failure.code = 'NETWORK_FUNCTION_ERROR'
      throw failure
    }
    let result
    try {
      result = await client.functions.invoke('medical-document-intake', { body, timeout: FUNCTION_TIMEOUT_MS })
    } catch {
      const failure = new Error(INTAKE_ERRORS.NETWORK_FUNCTION_ERROR)
      failure.code = 'NETWORK_FUNCTION_ERROR'
      throw failure
    }
    const { data, error } = result ?? {}
    if (error || data?.ok !== true) {
      const { code: responseError, status } = await responseCode(data, error)
      let code = Object.hasOwn(INTAKE_ERRORS, responseError) ? responseError : ''
      if (!code && status === 401) code = 'UNAUTHORIZED'
      else if (!code && (status === 404 || responseError)) code = 'ENDPOINT_VERSION_MISMATCH'
      else if (!code) code = 'NETWORK_FUNCTION_ERROR'
      const failure = new Error(INTAKE_ERRORS[code] ?? errorMessage)
      failure.code = code
      throw failure
    }
    return data
  }

  return {
    async listMine(profileId) {
      if (!client || !profileId) throw new Error('We could not confirm your patient account. Sign in again and try once more.')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS)
      try {
        let query = client.from('clinical_documents')
          .select('id,patient_id,document_type,title,original_filename,storage_bucket,storage_path,mime_type,file_size,document_date,uploaded_by_profile_id,source,status,created_at')
          .eq('uploaded_by_profile_id', profileId).eq('source', 'patient_upload').eq('status', 'active')
          .order('created_at', { ascending: false })
        if (typeof query.abortSignal === 'function') query = query.abortSignal(controller.signal)
        const { data, error } = await query
        if (error || !Array.isArray(data)) throw new Error('Unable to load your medical documents. Please try again.')
        return data
      } finally { clearTimeout(timer) }
    },

    async list(patientId) {
      if (!client || !patientId) throw new Error('Unable to load your medical documents. Please try again.')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS)
      try {
        let query = client.from('clinical_documents')
        .select('id,patient_id,document_type,title,original_filename,storage_bucket,storage_path,mime_type,file_size,document_date,uploaded_by_profile_id,source,status,created_at')
        .eq('patient_id', patientId).eq('source', 'patient_upload').eq('status', 'active')
        .order('created_at', { ascending: false })
        if (typeof query.abortSignal === 'function') query = query.abortSignal(controller.signal)
        const { data, error } = await query
        if (error || !Array.isArray(data)) throw new Error('Unable to load your medical documents. Please try again.')
        return data
      } finally { clearTimeout(timer) }
    },

    async upload({ file, documentType, title = '', documentDate = '' }) {
      if (!file || !MEDICAL_DOCUMENT_TYPES.includes(documentType)) throw new Error('Choose a document type and file.')
      if (file.size > MEDICAL_DOCUMENT_MAX_BYTES) throw new Error('Choose a file that is 10 MB or smaller.')
      const bytes = await readFileBytes(file)
      const validation = validateMedicalDocument({ filename: file.name, mimeType: file.type, size: file.size, bytes, documentType })
      if (validation === 'UNSUPPORTED_FILE_TYPE') throw new Error('Choose a PDF, JPG, JPEG, or PNG file whose file type matches its extension.')
      if (validation === 'FILE_SIZE_INVALID') throw new Error('Choose a file that is 10 MB or smaller.')
      if (validation) throw new Error('This file could not be validated. Choose a valid PDF, JPG, JPEG, or PNG file.')
      if (title.trim().length > 200) throw new Error('Title must be 200 characters or fewer.')
      const form = new FormData()
      form.set('action', 'upload')
      form.set('document_type', documentType)
      form.set('title', title.trim())
      if (documentDate) form.set('document_date', documentDate)
      form.set('file', file)
      return invoke(form, 'We could not upload this document. Please try again.')
    },

    async createSignedUrl(document, patientId, { download = false } = {}) {
      if (!client || !document?.id) throw new Error('Unable to open this document. Please try again.')
      let query = client.from('clinical_documents')
        .select('storage_bucket,storage_path,original_filename')
        .eq('id', document.id).eq('source', 'patient_upload').eq('status', 'active')
      if (patientId) query = query.eq('patient_id', patientId)
      const { data: row, error: rowError } = await query.maybeSingle()
      if (rowError || !row || row.storage_bucket !== MEDICAL_DOCUMENT_BUCKET || !row.storage_path) {
        throw new Error('Unable to open this document. Please try again.')
      }
      const { data, error } = await withTimeout(
        client.storage.from(MEDICAL_DOCUMENT_BUCKET)
          .createSignedUrl(row.storage_path, 60, download ? { download: row.original_filename || true } : undefined),
        SIGNED_URL_TIMEOUT_MS,
        'Unable to open this document. Please try again.',
      )
      if (error || !data?.signedUrl) throw new Error('Unable to open this document. Please try again.')
      return data.signedUrl
    },

    remove(documentId) {
      if (!documentId) throw new Error('Unable to remove this document. Please try again.')
      return invoke({ action: 'remove', document_id: documentId }, 'We could not safely remove this document. Refresh and try again.')
    },
  }
}

export const medicalDocumentService = createMedicalDocumentService()
