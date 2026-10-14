import { createClient } from 'npm:@supabase/supabase-js@2.109.0'
import {
  MEDICAL_DOCUMENT_BUCKET,
  MEDICAL_DOCUMENT_FORMATS,
  MEDICAL_DOCUMENT_MAX_BYTES,
  validateMedicalDocument,
} from '../_shared/medical-document-contract.js'
import { removeMedicalDocument, uploadMedicalDocument } from '../_shared/medical-document-operations.js'

const SAFE_ERRORS = new Set([
  'UNAUTHORIZED', 'PATIENT_IDENTITY_UNAVAILABLE', 'FORBIDDEN', 'INVALID_REQUEST',
  'UNSUPPORTED_DOCUMENT_TYPE', 'INVALID_FILENAME', 'UNSUPPORTED_FILE_TYPE',
  'FILE_SIZE_INVALID', 'FILE_CONTENT_INVALID', 'PRIVATE_BUCKET_UNAVAILABLE',
  'STORAGE_UPLOAD_FAILED', 'METADATA_CREATE_FAILED', 'STORAGE_CLEANUP_FAILED',
  'DOCUMENT_UNAVAILABLE', 'STORAGE_READ_FAILED', 'STORAGE_DELETE_FAILED',
  'STORAGE_STATE_UNKNOWN', 'METADATA_REMOVE_FAILED', 'REMOVAL_COMPENSATION_FAILED',
  'REMOVAL_VERIFICATION_FAILED', 'DATABASE_DEPENDENCY_BLOCKED', 'ORIGIN_DENIED',
  'UNCLASSIFIED_FAILURE',
])

const origins = (Deno.env.get('MEDICAL_DOCUMENT_ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map(value => value.trim()).filter(Boolean)

Deno.serve(async request => {
  const origin = request.headers.get('origin') ?? ''
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (origins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
  if (origin && !origins.includes(origin)) return reply({ error: 'ORIGIN_DENIED' }, 403)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MEDICAL_DOCUMENT_MAX_BYTES + 128 * 1024) {
    return reply({ error: 'FILE_SIZE_INVALID' }, 413)
  }

  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return reply({ error: 'UNAUTHORIZED' }, 401)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authOptions = { auth: { persistSession: false, autoRefreshToken: false } }
    const userClient = createClient(url, anonKey, { ...authOptions, global: { headers: { Authorization: authorization } } })
    const admin = createClient(url, serviceKey, authOptions)
    const token = authorization.slice('Bearer '.length)
    const { data: authData, error: authError } = await userClient.auth.getUser(token)
    if (authError || !authData.user) return reply({ error: 'UNAUTHORIZED' }, 401)
    const userId = authData.user.id

    const [profileResult, patientResult, bucketResult] = await Promise.all([
      userClient.from('profiles').select('role,status').eq('id', userId).maybeSingle(),
      userClient.from('patients').select('id').eq('auth_user_id', userId).eq('status', 'active').maybeSingle(),
      admin.storage.getBucket(MEDICAL_DOCUMENT_BUCKET),
    ])
    if (profileResult.error || patientResult.error) return reply({ error: 'PATIENT_IDENTITY_UNAVAILABLE' }, 403)
    if (!profileResult.data || profileResult.data.role !== 'patient' || profileResult.data.status !== 'active' || !patientResult.data) {
      return reply({ error: 'FORBIDDEN' }, 403)
    }
    if (bucketResult.error || bucketResult.data?.public !== false) return reply({ error: 'PRIVATE_BUCKET_UNAVAILABLE' }, 503)
    const patientId = patientResult.data.id

    let body: FormData | Record<string, unknown>
    if ((request.headers.get('content-type') ?? '').toLowerCase().includes('multipart/form-data')) {
      try { body = await request.formData() } catch { return reply({ error: 'INVALID_REQUEST' }, 400) }
    } else {
      try { body = await request.json() as Record<string, unknown> } catch { return reply({ error: 'INVALID_REQUEST' }, 400) }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'INVALID_REQUEST' }, 400)
    }

    const action = body instanceof FormData ? body.get('action') : body.action
    if (action === 'upload' && body instanceof FormData) {
      const permittedFields = new Set(['action', 'document_type', 'title', 'document_date', 'file'])
      if ([...body.keys()].some(key => !permittedFields.has(key))
        || [...permittedFields].some(key => body.getAll(key).length > 1)) return reply({ error: 'INVALID_REQUEST' }, 400)
      const file = body.get('file')
      const documentType = body.get('document_type')
      const title = body.get('title')
      const rawDate = body.get('document_date')
      if (!(file instanceof File) || typeof documentType !== 'string'
        || (title !== null && typeof title !== 'string')
        || (rawDate !== null && typeof rawDate !== 'string')) return reply({ error: 'INVALID_REQUEST' }, 400)
      if (file.size < 1 || file.size > MEDICAL_DOCUMENT_MAX_BYTES) return reply({ error: 'FILE_SIZE_INVALID' }, 413)
      const documentId = crypto.randomUUID()
      const bytes = new Uint8Array(await file.arrayBuffer())
      const validation = validateMedicalDocument({
        filename: file.name, mimeType: file.type, size: file.size, bytes, documentType,
      })
      if (validation) return reply({ error: validation }, 400)
      const extension = MEDICAL_DOCUMENT_FORMATS[file.type].storageExtension
      const storagePath = `${patientId}/${documentId}/${crypto.randomUUID()}.${extension}`
      const saved = await uploadMedicalDocument({
        path: storagePath, bytes, mimeType: file.type,
        metadata: {
          p_document_id: documentId, p_document_type: documentType, p_title: title,
          p_original_filename: file.name, p_storage_path: storagePath, p_mime_type: file.type,
          p_file_size: file.size, p_document_date: rawDate || null,
        },
      }, {
        uploadStorage: async (path, content, mimeType) => {
          const { error } = await admin.storage.from(MEDICAL_DOCUMENT_BUCKET).upload(path, content, { contentType: mimeType, upsert: false, cacheControl: '0' })
          if (error) throw error
        },
        recordMetadata: async metadata => {
          const { data, error } = await userClient.rpc('record_my_medical_document', metadata)
          if (error) throw error
          return data
        },
        removeStorage: async path => {
          const { error } = await admin.storage.from(MEDICAL_DOCUMENT_BUCKET).remove([path])
          if (error) throw error
        },
        storageExists: async path => {
          const { data, error } = await admin.storage.from(MEDICAL_DOCUMENT_BUCKET).download(path)
          if (!error && data) return true
          if (error && (String(error.message ?? '').toLowerCase().includes('not found') || String(error.statusCode ?? '') === '404')) return false
          throw error ?? new Error('Storage object state unknown')
        },
      })
      if (!saved.ok) return reply({ error: saved.error }, saved.error === 'METADATA_CREATE_FAILED' ? 400 : 503)
      return reply({ ok: true, id: saved.id }, 201)
    }

    if (action === 'remove' && !(body instanceof FormData)) {
      const documentId = body.document_id
      if (Object.keys(body).some(key => !['action', 'document_id'].includes(key))
        || typeof documentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(documentId)) {
        return reply({ error: 'INVALID_REQUEST' }, 400)
      }
      const { data: document, error: documentError } = await admin.from('clinical_documents')
        .select('*').eq('id', documentId).eq('patient_id', patientId)
        .eq('uploaded_by_profile_id', userId).eq('source', 'patient_upload').eq('status', 'active').maybeSingle()
      if (documentError || !document) return reply({ error: 'DOCUMENT_UNAVAILABLE' }, 404)

      const removal = await removeMedicalDocument(document, {
        download: async path => {
          const { data, error } = await admin.storage.from(MEDICAL_DOCUMENT_BUCKET).download(path)
          if (error) throw error
          return data ? new Uint8Array(await data.arrayBuffer()) : null
        },
        removeStorage: async path => {
          const { error } = await admin.storage.from(MEDICAL_DOCUMENT_BUCKET).remove([path])
          if (error) throw error
        },
        storageExists: async path => {
          const { data, error } = await admin.storage.from(MEDICAL_DOCUMENT_BUCKET).download(path)
          if (!error && data) return true
          if (error && (String(error.message ?? '').toLowerCase().includes('not found') || String(error.statusCode ?? '') === '404')) return false
          throw error ?? new Error('Storage object state unknown')
        },
        setRemoved: async row => {
          const now = new Date().toISOString()
          const { data, error } = await admin.from('clinical_documents')
            .update({ status: 'removed', removed_at: now, updated_at: now })
            .eq('id', row.id).eq('patient_id', patientId).eq('uploaded_by_profile_id', userId)
            .eq('source', 'patient_upload').eq('status', 'active').select('id').maybeSingle()
          if (error || !data) throw error ?? new Error('Metadata row was not updated')
        },
        status: async id => {
          const { data, error } = await admin.from('clinical_documents').select('status').eq('id', id).maybeSingle()
          if (error) throw error
          return data?.status ?? null
        },
        restoreStorage: async (path, bytes, mimeType) => {
          const { error } = await admin.storage.from(MEDICAL_DOCUMENT_BUCKET).upload(path, bytes, { contentType: mimeType, upsert: true, cacheControl: '0' })
          if (error) throw error
        },
        restoreActive: async id => {
          const { error } = await admin.from('clinical_documents').update({ status: 'active', removed_at: null, updated_at: new Date().toISOString() })
            .eq('id', id).eq('patient_id', patientId).eq('uploaded_by_profile_id', userId).eq('status', 'removed')
          if (error) throw error
        },
      })
      return removal.ok ? reply({ ok: true }) : reply({ error: removal.error }, 503)
    }
    return reply({ error: 'INVALID_REQUEST' }, 400)
  } catch (error) {
    const code = error instanceof Error && SAFE_ERRORS.has(error.message) ? error.message : 'UNCLASSIFIED_FAILURE'
    console.error('medical document intake failed', code)
    return reply({ error: code }, 503)
  }
})
