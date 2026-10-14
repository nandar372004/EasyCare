import { createClient } from 'npm:@supabase/supabase-js@2.109.0'
import { removeDraftProviderCredential } from '../_shared/provider-application-document-removal.ts'

const BUCKET = 'provider-credential-evidence'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_FAILURES = new Set([
  'PROFILE_UNAVAILABLE', 'APPLICATION_UNAVAILABLE', 'DOCUMENT_UNAVAILABLE', 'BUCKET_UNAVAILABLE',
  'STORAGE_UNAVAILABLE', 'STORAGE_DELETE_FAILED', 'STORAGE_STATE_UNKNOWN', 'METADATA_DELETE_FAILED',
  'DOCUMENT_STATE_UNKNOWN', 'STORAGE_COMPENSATION_FAILED', 'METADATA_COMPENSATION_FAILED',
])

Deno.serve(async request => {
  const origin = request.headers.get('origin') ?? ''
  const allowedOrigins = (Deno.env.get('PROVIDER_APPLICATION_ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map(value => value.trim()).filter(Boolean)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

  if (origin && !allowedOrigins.includes(origin)) return reply({ error: 'ORIGIN_DENIED' }, 403)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return reply({ error: 'UNAUTHORIZED' }, 401)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const options = { auth: { persistSession: false, autoRefreshToken: false } }
    const userClient = createClient(url, anonKey, { ...options, global: { headers: { Authorization: authorization } } })
    const admin = createClient(url, serviceKey, options)
    const token = authorization.slice('Bearer '.length)
    const { data: userData, error: userError } = await userClient.auth.getUser(token)
    if (userError || !userData.user) return reply({ error: 'UNAUTHORIZED' }, 401)

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return reply({ error: 'INVALID_JSON' }, 400) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'INVALID_BODY' }, 400)
    const applicationId = body.application_id
    const documentId = body.document_id
    if (Object.keys(body).some(key => !['application_id', 'document_id'].includes(key))) return reply({ error: 'INVALID_FIELDS' }, 400)
    if (typeof applicationId !== 'string' || !applicationId) return reply({ error: 'APPLICATION_ID_MISSING' }, 400)
    if (!UUID.test(applicationId)) return reply({ error: 'APPLICATION_ID_FORMAT_INVALID' }, 400)
    if (typeof documentId !== 'string' || !documentId) return reply({ error: 'DOCUMENT_ID_MISSING' }, 400)
    if (!UUID.test(documentId)) return reply({ error: 'DOCUMENT_ID_FORMAT_INVALID' }, 400)

    const result = await removeDraftProviderCredential({
      authorization,
      applicationId,
      documentId,
    }, {
      authenticate: async () => ({ id: userData.user.id }),
      getProfile: async userId => {
        // Profiles are intentionally not readable by service_role in this project.
        // Read only the signed-in user's role/status through their own-profile policy.
        const { data, error } = await userClient.from('profiles').select('role,status').eq('id', userId).maybeSingle()
        if (error) throw new Error('PROFILE_UNAVAILABLE')
        return data
      },
      getApplication: async (id, userId) => {
        const { data, error } = await admin.from('provider_applications').select('id,applicant_profile_id,status')
          .eq('id', id).eq('applicant_profile_id', userId).maybeSingle()
        if (error) throw new Error('APPLICATION_UNAVAILABLE')
        return data
      },
      getDocument: async (id, appId, userId) => {
        const { data, error } = await admin.from('provider_application_documents').select('*')
          .eq('id', id).eq('application_id', appId).eq('applicant_profile_id', userId).maybeSingle()
        if (error) throw new Error('DOCUMENT_UNAVAILABLE')
        return data
      },
      isPrivateBucket: async () => {
        const { data, error } = await admin.storage.getBucket(BUCKET)
        if (error) throw new Error('BUCKET_UNAVAILABLE')
        return data?.public === false
      },
      download: async path => {
        const { data, error } = await admin.storage.from(BUCKET).download(path)
        if (error) {
          if (String(error.message ?? '').toLowerCase().includes('not found') || String(error.statusCode ?? '') === '404') return null
          throw new Error('STORAGE_UNAVAILABLE')
        }
        return data ? new Uint8Array(await data.arrayBuffer()) : null
      },
      removeStorage: async path => {
        const { error } = await admin.storage.from(BUCKET).remove([path])
        if (error) throw new Error('STORAGE_DELETE_FAILED')
      },
      storageExists: async path => {
        const { data, error } = await admin.storage.from(BUCKET).download(path)
        if (!error && data) return true
        if (String(error?.message ?? '').toLowerCase().includes('not found') || String(error?.statusCode ?? '') === '404') return false
        throw new Error('STORAGE_STATE_UNKNOWN')
      },
      deleteMetadata: async (userId, appId, docId) => {
        const { error } = await admin.rpc('delete_provider_application_document_for_owner', {
          p_applicant_profile_id: userId,
          p_application_id: appId,
          p_document_id: docId,
        })
        if (error) throw new Error('METADATA_DELETE_FAILED')
      },
      documentExists: async (id, appId, userId) => {
        const { data, error } = await admin.from('provider_application_documents').select('id').eq('id', id)
          .eq('application_id', appId).eq('applicant_profile_id', userId).maybeSingle()
        if (error) throw new Error('DOCUMENT_STATE_UNKNOWN')
        return Boolean(data)
      },
      restoreStorage: async (path, bytes, mimeType) => {
        const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: mimeType, upsert: true })
        if (error) throw new Error('STORAGE_COMPENSATION_FAILED')
      },
      restoreMetadata: async document => {
        const { error } = await admin.from('provider_application_documents').upsert(document, { onConflict: 'id', ignoreDuplicates: true })
        if (error) throw new Error('METADATA_COMPENSATION_FAILED')
      },
    })
    return reply(result.body, result.status)
  } catch (error) {
    const classification = error instanceof Error && SAFE_FAILURES.has(error.message)
      ? error.message
      : 'UNCLASSIFIED_FAILURE'
    console.error('provider credential removal failed', classification)
    return reply({ error: classification }, 503)
  }
})
