export const MEDICAL_DOCUMENT_BUCKET = 'medical-documents'
export const MEDICAL_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024
export const MEDICAL_DOCUMENT_TYPES = Object.freeze([
  'discharge_summary', 'lab_report', 'prescription', 'procedure_report',
  'imaging_report', 'medical_certificate', 'other',
])
export const MEDICAL_DOCUMENT_FORMATS = Object.freeze({
  'application/pdf': Object.freeze({ extensions: ['pdf'], storageExtension: 'pdf' }),
  'image/jpeg': Object.freeze({ extensions: ['jpg', 'jpeg'], storageExtension: 'jpg' }),
  'image/png': Object.freeze({ extensions: ['png'], storageExtension: 'png' }),
})

export function validateMedicalDocument({ filename, mimeType, size, bytes, documentType }) {
  if (!MEDICAL_DOCUMENT_TYPES.includes(documentType)) return 'UNSUPPORTED_DOCUMENT_TYPE'
  if (typeof filename !== 'string' || filename.trim().length < 1 || filename.length > 255
    || /[\/\\\u0000-\u001f\u007f]/.test(filename)) return 'INVALID_FILENAME'
  const format = MEDICAL_DOCUMENT_FORMATS[mimeType]
  const extension = filename.split('.').at(-1)?.toLowerCase()
  if (!format || !format.extensions.includes(extension)) return 'UNSUPPORTED_FILE_TYPE'
  if (!Number.isSafeInteger(size) || size < 1 || size > MEDICAL_DOCUMENT_MAX_BYTES) return 'FILE_SIZE_INVALID'
  if (!bytes || typeof bytes.length !== 'number' || typeof bytes.slice !== 'function') return 'FILE_CONTENT_INVALID'
  const signatureMatches = mimeType === 'application/pdf'
    ? new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'
    : mimeType === 'image/jpeg'
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  return signatureMatches ? null : 'FILE_CONTENT_INVALID'
}

export function safeMedicalDocumentFilename(filename) {
  return filename.trim().normalize('NFKD').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[^A-Za-z0-9]+/, '').slice(0, 200) || 'medical-document'
}
