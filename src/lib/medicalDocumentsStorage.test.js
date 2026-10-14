// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ensureMedicalDocumentsBucket, MEDICAL_DOCUMENT_BUCKET, MEDICAL_DOCUMENT_MAX_BYTES, MEDICAL_DOCUMENT_MIME_TYPES } from '../../supabase/scripts/setup_medical_documents_storage.mjs'

function storage(getResult, updateResult = { error: null }) {
  return { storage: {
    getBucket: vi.fn().mockResolvedValue(getResult),
    createBucket: vi.fn().mockResolvedValue({ error: null }),
    updateBucket: vi.fn().mockResolvedValue(updateResult),
  } }
}

describe('private medical document bucket provisioning', () => {
  it('creates a dedicated private bucket with a 10 MB limit and supported MIME types', async () => {
    const client = storage({ error: { statusCode: '404' } })
    await ensureMedicalDocumentsBucket(client)
    expect(client.storage.createBucket).toHaveBeenCalledWith(MEDICAL_DOCUMENT_BUCKET, {
      public: false, fileSizeLimit: MEDICAL_DOCUMENT_MAX_BYTES, allowedMimeTypes: MEDICAL_DOCUMENT_MIME_TYPES,
    })
  })
  it('refuses to reuse a public bucket', async () => {
    await expect(ensureMedicalDocumentsBucket(storage({ data: { public: true } }))).rejects.toThrow(/must be private/)
  })
  it('tightens an existing private bucket that is missing upload limits', async () => {
    const client = storage({ data: { public: false, file_size_limit: null, allowed_mime_types: null } })
    await ensureMedicalDocumentsBucket(client)
    expect(client.storage.updateBucket).toHaveBeenCalledWith(MEDICAL_DOCUMENT_BUCKET, {
      public: false, fileSizeLimit: MEDICAL_DOCUMENT_MAX_BYTES, allowedMimeTypes: MEDICAL_DOCUMENT_MIME_TYPES,
    })
  })
  it('does not change an already correctly configured bucket', async () => {
    const client = storage({ data: { public: false, file_size_limit: MEDICAL_DOCUMENT_MAX_BYTES, allowed_mime_types: MEDICAL_DOCUMENT_MIME_TYPES } })
    await ensureMedicalDocumentsBucket(client)
    expect(client.storage.updateBucket).not.toHaveBeenCalled()
  })
  it('propagates inspection and update failures', async () => {
    await expect(ensureMedicalDocumentsBucket(storage({ error: { statusCode: '403' } }))).rejects.toEqual({ statusCode: '403' })
    await expect(ensureMedicalDocumentsBucket(storage({ data: { public: false } }, { error: new Error('update failed') }))).rejects.toThrow('update failed')
  })
})
