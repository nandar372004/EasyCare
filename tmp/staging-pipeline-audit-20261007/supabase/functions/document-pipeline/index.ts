import { createClient } from 'npm:@supabase/supabase-js@2.109.0'
import { createDocumentHealthPipeline } from '../_shared/document-health-pipeline.js'
import { createOpenAIDocumentModelAdapter, createOpenAIDocumentTextExtractor, createOpenAIBilingualFactExplanationAdapter } from '../_shared/openai-document-provider.js'
import { isPhaseITestPipelineEnabled, PHASE_I_TEST_STAGING_PROJECT_REF } from '../_shared/phase-i-test-pipeline-gate.js'
import { MEDICAL_DOCUMENT_BUCKET, MEDICAL_DOCUMENT_FORMATS, MEDICAL_DOCUMENT_MAX_BYTES } from '../_shared/medical-document-contract.js'

const baseHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }

Deno.serve(async request => {
  const origin = request.headers.get('origin') ?? ''
  const allowedOrigins = (Deno.env.get('PHASE_I_EXTRACTION_ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map(value => value.trim()).filter(Boolean)
  const headers = { ...baseHeaders, ...(origin && allowedOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}) }
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
  if (origin && !allowedOrigins.includes(origin)) return reply({ error: 'ORIGIN_DENIED' }, 403)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return reply({ error: 'UNAUTHORIZED' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const enabled = isPhaseITestPipelineEnabled({ flag: Deno.env.get('ENABLE_PHASE_I_REAL_EXTRACTION'), supabaseUrl })
  if (!enabled || new URL(supabaseUrl!).hostname.split('.')[0] !== PHASE_I_TEST_STAGING_PROJECT_REF) {
    return reply({ error: 'PIPELINE_DISABLED' }, 404)
  }

  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  const model = Deno.env.get('OPENAI_DOCUMENT_MODEL')
  if (!anonKey || !serviceKey || !apiKey || !model) return reply({ error: 'PIPELINE_CONFIGURATION_MISSING' }, 503)

  try {
    let body: unknown
    try { body = await request.json() } catch { return reply({ error: 'INVALID_REQUEST' }, 400) }
    const documentId = (body as Record<string, unknown>)?.clinical_document_id
    if (typeof documentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)) return reply({ error: 'INVALID_REQUEST' }, 400)

    const options = { auth: { persistSession: false, autoRefreshToken: false } }
    const rawUserClient = createClient(supabaseUrl!, anonKey, { ...options, global: { headers: { Authorization: authorization } } })
    const accessToken = authorization.slice('Bearer '.length)
    const userClient = {
      auth: { getUser: () => rawUserClient.auth.getUser(accessToken) },
      from: rawUserClient.from.bind(rawUserClient), rpc: rawUserClient.rpc.bind(rawUserClient),
      storage: rawUserClient.storage,
    }
    const serviceClient = createClient(supabaseUrl!, serviceKey, options)
    const { data: auth, error: authError } = await userClient.auth.getUser()
    const userId = auth?.user?.id
    if (authError || !userId) return reply({ error: 'UNAUTHORIZED' }, 401)

    const { data: patient, error: patientError } = await userClient.from('patients')
      .select('id').eq('profile_id', userId).eq('auth_user_id', userId).eq('status', 'active').maybeSingle()
    if (patientError || !patient) return reply({ error: 'FORBIDDEN' }, 403)
    const { data: document, error: documentError } = await userClient.from('clinical_documents')
      .select('id,patient_id,uploaded_by_profile_id,source,status,storage_bucket,storage_path,mime_type,file_size,original_filename')
      .eq('id', documentId).maybeSingle()
    if (documentError) return reply({ error: 'DOCUMENT_UNAVAILABLE' }, 503)
    if (!document) return reply({ error: 'DOCUMENT_NOT_FOUND' }, 404)
    if (document.patient_id !== patient.id || document.uploaded_by_profile_id !== userId
      || document.source !== 'patient_upload' || document.status !== 'active') return reply({ error: 'FORBIDDEN' }, 403)
    if (document.storage_bucket !== MEDICAL_DOCUMENT_BUCKET || !MEDICAL_DOCUMENT_FORMATS[document.mime_type]
      || !Number.isSafeInteger(document.file_size) || document.file_size < 1 || document.file_size > MEDICAL_DOCUMENT_MAX_BYTES) return reply({ error: 'UNSUPPORTED_DOCUMENT' }, 422)

    const { data: existing, error: existingError } = await userClient.from('document_extracted_facts')
      .select('id').eq('clinical_document_id', documentId).in('review_status', ['needs_review', 'confirmed']).limit(1).maybeSingle()
    if (existingError) return reply({ error: 'DOCUMENT_UNAVAILABLE' }, 503)
    if (existing) return reply({ error: 'DOCUMENT_ALREADY_PROCESSED' }, 409)

    const providerConfig = { apiKey, model }
    const modelAdapter = createOpenAIDocumentModelAdapter(providerConfig)
    const pipeline = createDocumentHealthPipeline({
      userClient, serviceClient, modelAdapter,
      sourceTextExtractor: createOpenAIDocumentTextExtractor(providerConfig),
      explanationAdapter: createOpenAIBilingualFactExplanationAdapter(providerConfig),
    })
    const result = await pipeline.processDocument(documentId)
    return reply({ ...result, provider: 'server_configured_model' })
  } catch (error) {
    const safeCode = error instanceof Error && [
      'UNAUTHORIZED', 'INVALID_REQUEST', 'DOCUMENT_UNAVAILABLE', 'CLASSIFICATION_UNAVAILABLE',
      'EXTRACTION_UNAVAILABLE', 'INVALID_EXTRACTION_OUTPUT', 'INVALID_CLASSIFICATION_OUTPUT',
      'INVALID_FACT_EXPLANATION', 'EXPLANATION_UNAVAILABLE', 'DOCUMENT_ALREADY_PROCESSED',
    ].includes(error.message) ? error.message : 'DOCUMENT_PIPELINE_FAILED'
    const status = safeCode === 'UNAUTHORIZED' ? 401 : safeCode === 'INVALID_REQUEST' ? 400 : safeCode === 'DOCUMENT_UNAVAILABLE' ? 403 : 503
    return reply({ error: safeCode }, status)
  }
})
