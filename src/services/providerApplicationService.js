import { supabase } from '../lib/supabase.js'

export const PROVIDER_APPLICATION_BUCKET = 'provider-credential-evidence'
export const PROVIDER_APPLICATION_MAX_FILE_SIZE = 10 * 1024 * 1024
export const PROVIDER_APPLICATION_FILE_TYPES = Object.freeze({
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg or .jpeg',
  'image/png': '.png',
})

function genericFailure() {
  return new Error('Unable to complete your provider application. Please try again.')
}

export const CREDENTIAL_REMOVAL_ERRORS = new Set([
  'UNAUTHORIZED', 'FORBIDDEN', 'DOCUMENT_UNAVAILABLE', 'DRAFT_REQUIRED', 'PRIVATE_STORAGE_UNAVAILABLE',
  'PROFILE_UNAVAILABLE', 'APPLICATION_UNAVAILABLE', 'BUCKET_UNAVAILABLE', 'METADATA_DELETE_FAILED',
  'DOCUMENT_STATE_UNKNOWN', 'STORAGE_COMPENSATION_FAILED', 'METADATA_COMPENSATION_FAILED',
  'STORAGE_UNAVAILABLE', 'STORAGE_DELETE_FAILED', 'STORAGE_STATE_UNKNOWN', 'REMOVAL_FAILED_RESTORED',
  'REMOVAL_COMPENSATION_FAILED', 'REMOVAL_VERIFICATION_FAILED_RESTORED', 'REMOVAL_VERIFICATION_FAILED',
  'INVALID_REQUEST', 'INVALID_JSON', 'INVALID_BODY', 'INVALID_FIELDS', 'APPLICATION_ID_MISSING',
  'APPLICATION_ID_FORMAT_INVALID', 'DOCUMENT_ID_MISSING', 'DOCUMENT_ID_FORMAT_INVALID',
  'REMOVAL_UNAVAILABLE', 'UNCLASSIFIED_FAILURE',
])

export function createProviderApplicationService(client = supabase, randomUuid = () => globalThis.crypto.randomUUID()) {
  async function rpc(name, args) {
    if (!client) throw genericFailure()
    const { data, error } = await client.rpc(name, args)
    if (error) throw genericFailure()
    return data
  }

  function validateCredential(file) {
    if (!file || !Object.hasOwn(PROVIDER_APPLICATION_FILE_TYPES, file.type)) {
      throw new Error('Upload a PDF, JPG, JPEG, or PNG credential file.')
    }
    const extension = String(file.name || '').split('.').at(-1).toLowerCase()
    const extensions = { 'application/pdf': ['pdf'], 'image/jpeg': ['jpg','jpeg'], 'image/png': ['png'] }
    if (!extensions[file.type].includes(extension)) throw new Error('The file extension must match its PDF, JPG, JPEG, or PNG type.')
    if (!Number.isFinite(file.size) || file.size < 1 || file.size > PROVIDER_APPLICATION_MAX_FILE_SIZE) {
      throw new Error('Credential files must be smaller than 10 MB.')
    }
  }

  return {
    async listSpecialties() {
      if (!client) throw genericFailure()
      const { data, error } = await client.from('specialties').select('id,name').order('name')
      if (error || !Array.isArray(data)) throw genericFailure()
      return data
    },
    load() { return rpc('get_my_provider_application') },
    saveDraft(applicationId, fields) {
      return rpc('save_provider_application_draft', { p_application_id: applicationId || null, p_fields: fields })
    },
    submit(applicationId) {
      if (!applicationId) throw new Error('Save your application draft before submitting.')
      return rpc('submit_provider_application', { p_application_id: applicationId })
    },
    async removeCredential(applicationId, documentId) {
      if (!client || !applicationId || !documentId || !client.functions?.invoke) throw genericFailure()
      const { data, error } = await client.functions.invoke('remove-provider-application-document', {
        body: { application_id: applicationId, document_id: documentId },
      })
      let errorBody
      if (error?.context?.json) {
        try { errorBody = await error.context.json() } catch { /* keep a safe generic classification */ }
      }
      const code = data?.error || errorBody?.error
      if (error || data?.ok !== true) {
        throw new Error(CREDENTIAL_REMOVAL_ERRORS.has(code) ? code : 'REMOVAL_UNAVAILABLE')
      }
      return true
    },
    async uploadCredential(applicationId, file, documentType) {
      validateCredential(file)
      if (!client || !applicationId || !client.storage || !client.auth?.getUser) throw genericFailure()
      const { data: userData, error: userError } = await client.auth.getUser()
      const userId = userData?.user?.id
      if (userError || !userId) throw genericFailure()
      const safeName = file.name.normalize('NFKD').replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, '_').replace(/^[^A-Za-z0-9]+/, '').slice(0, 140) || 'credential'
      const path = `${userId}/${applicationId}/${randomUuid()}-${safeName}`
      const { error: uploadError } = await client.storage.from(PROVIDER_APPLICATION_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) throw genericFailure()
      let documentId
      try {
        documentId = await rpc('record_provider_application_document', {
          p_application_id: applicationId,
          p_document_type: documentType,
          p_file_name: safeName,
          p_storage_path: path,
          p_mime_type: file.type,
          p_file_size: file.size,
        })
      } catch {
        await client.storage.from(PROVIDER_APPLICATION_BUCKET).remove([path]).catch(() => {})
        throw genericFailure()
      }
      return { id: documentId, fileName: safeName, storagePath: path, mimeType: file.type, fileSize: file.size }
    },
    async createDownloadUrl(storagePath) {
      if (!client) throw genericFailure()
      const { data: userData, error: userError } = await client.auth.getUser()
      if (userError || !userData?.user?.id || !storagePath?.startsWith(`${userData.user.id}/`)) throw genericFailure()
      const { data, error } = await client.storage.from(PROVIDER_APPLICATION_BUCKET).createSignedUrl(storagePath, 60)
      if (error || !data?.signedUrl) throw genericFailure()
      return data.signedUrl
    },
  }
}

export const providerApplicationService = createProviderApplicationService()
