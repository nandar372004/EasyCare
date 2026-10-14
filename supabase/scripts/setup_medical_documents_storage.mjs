import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'

export const MEDICAL_DOCUMENT_BUCKET = 'medical-documents'
export const MEDICAL_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024
export const MEDICAL_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png']

export async function ensureMedicalDocumentsBucket(client) {
  const existing = await client.storage.getBucket(MEDICAL_DOCUMENT_BUCKET)
  if (existing.data) {
    if (existing.data.public !== false) throw new Error('medical-documents must be private; refusing to reuse a public bucket')
    const limit = Number(existing.data.file_size_limit)
    const tooLarge = existing.data.file_size_limit == null || !Number.isFinite(limit) || limit > MEDICAL_DOCUMENT_MAX_BYTES
    const mimeTypes = [...(existing.data.allowed_mime_types ?? [])].sort()
    const mimeMismatch = JSON.stringify(mimeTypes) !== JSON.stringify([...MEDICAL_DOCUMENT_MIME_TYPES].sort())
    if (tooLarge || mimeMismatch) {
      const { error } = await client.storage.updateBucket(MEDICAL_DOCUMENT_BUCKET, {
        public: false,
        fileSizeLimit: MEDICAL_DOCUMENT_MAX_BYTES,
        allowedMimeTypes: MEDICAL_DOCUMENT_MIME_TYPES,
      })
      if (error) throw error
    }
    return
  }
  if (Number(existing.error?.statusCode) !== 404) throw existing.error ?? new Error('Unable to inspect medical-documents bucket')
  const { error } = await client.storage.createBucket(MEDICAL_DOCUMENT_BUCKET, {
    public: false,
    fileSizeLimit: MEDICAL_DOCUMENT_MAX_BYTES,
    allowedMimeTypes: MEDICAL_DOCUMENT_MIME_TYPES,
  })
  if (error) throw error
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  await ensureMedicalDocumentsBucket(createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }))
  console.log('Private medical-documents bucket ready (10 MB; PDF, JPEG, PNG)')
}
