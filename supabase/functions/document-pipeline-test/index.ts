import { createClient } from 'npm:@supabase/supabase-js@2.109.0'
import { createPhaseITestAdapters, createPhaseITestPipeline, isPhaseITestPdf, PHASE_I_TEST_FIXTURE_MARKER } from '../_shared/phase-i-test-pipeline.js'
import { isPhaseITestPipelineEnabled } from '../_shared/phase-i-test-pipeline-gate.js'

const allowedOrigins = (Deno.env.get('PHASE_I_TEST_ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map(value => value.trim()).filter(Boolean)

Deno.serve(async request => {
  const origin = request.headers.get('origin') ?? ''
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
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
  const url = Deno.env.get('SUPABASE_URL')
  try {
    if (!isPhaseITestPipelineEnabled({
      flag: Deno.env.get('ENABLE_PHASE_I_TEST_PIPELINE'),
      supabaseUrl: url,
    })) {
      return reply({ error: 'TEST_PIPELINE_DISABLED' }, 404)
    }
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const options = { auth: { persistSession: false, autoRefreshToken: false } }
    const rawUserClient = createClient(url, anonKey, {
      ...options, global: { headers: { Authorization: authorization } },
    })
    const token = authorization.slice('Bearer '.length)
    const userClient = {
      auth: { getUser: () => rawUserClient.auth.getUser(token) },
      from: rawUserClient.from.bind(rawUserClient),
      rpc: rawUserClient.rpc.bind(rawUserClient),
      storage: rawUserClient.storage,
    }
    const serviceClient = createClient(url, serviceKey, options)
    const { data: auth, error: authError } = await userClient.auth.getUser()
    const userId = auth?.user?.id
    if (authError || !userId) return reply({ error: 'UNAUTHORIZED' }, 401)

    let body: unknown
    try { body = await request.json() } catch { return reply({ error: 'INVALID_REQUEST' }, 400) }
    const documentId = (body as Record<string, unknown>)?.clinical_document_id
    if (typeof documentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)) {
      return reply({ error: 'INVALID_REQUEST' }, 400)
    }
    const { data: patient, error: patientError } = await userClient.from('patients')
      .select('id').eq('profile_id', userId).eq('auth_user_id', userId).eq('status', 'active').maybeSingle()
    if (patientError || !patient) return reply({ error: 'FORBIDDEN' }, 403)
    const { data: document, error: documentError } = await userClient.from('clinical_documents')
      .select('id,patient_id,uploaded_by_profile_id,document_type,source,status,storage_bucket,storage_path,mime_type,file_size')
      .eq('id', documentId).maybeSingle()
    if (documentError) return reply({ error: 'DOCUMENT_PIPELINE_UNAVAILABLE' }, 503)
    if (!document) {
      // Local/test-only diagnostics distinguish an unknown ID from a known
      // document outside the caller's ownership boundary. No metadata escapes.
      const { data: exactRow, error: lookupError } = await serviceClient.from('clinical_documents')
        .select('id,patient_id,uploaded_by_profile_id').eq('id', documentId).maybeSingle()
      if (lookupError) return reply({ error: 'DOCUMENT_PIPELINE_UNAVAILABLE' }, 503)
      if (!exactRow) return reply({ error: 'DOCUMENT_NOT_FOUND' }, 404)
      return reply({ error: 'WRONG_OWNER' }, 403)
    }
    if (document.patient_id !== patient.id || document.uploaded_by_profile_id !== userId
      || document.source !== 'patient_upload' || document.status !== 'active') {
      return reply({ error: 'WRONG_OWNER' }, 403)
    }
    if (document.document_type !== 'lab_report') return reply({ error: 'WRONG_DOCUMENT_TYPE' }, 422)
    const { data: fixtureFile, error: fixtureFileError } = await userClient.storage
      .from(document.storage_bucket).download(document.storage_path)
    if (fixtureFileError || !fixtureFile || fixtureFile.size !== document.file_size) {
      return reply({ error: 'DOCUMENT_PIPELINE_UNAVAILABLE' }, 503)
    }
    const fixtureBytes = new Uint8Array(await fixtureFile.arrayBuffer())
    if (!isPhaseITestPdf(fixtureBytes)) return reply({ error: 'TEST_FIXTURE_REQUIRED' }, 422)
    const { data: existing, error: existingError } = await userClient.from('document_extracted_facts')
      .select('id').eq('clinical_document_id', documentId).in('review_status', ['needs_review', 'confirmed']).limit(1).maybeSingle()
    if (existingError) return reply({ error: 'DOCUMENT_PIPELINE_UNAVAILABLE' }, 503)
    if (existing) return reply({ error: 'DOCUMENT_ALREADY_PROCESSED' }, 409)

    const { sourceTextExtractor, modelAdapter } = createPhaseITestAdapters()
    const result = await createPhaseITestPipeline({ userClient, serviceClient, sourceTextExtractor, modelAdapter })
      .processDocument(documentId)
    return reply({ ...result, fixture_marker: PHASE_I_TEST_FIXTURE_MARKER })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    const status = code === 'UNAUTHORIZED' ? 401 : code === 'INVALID_REQUEST' ? 400
      : code === 'DOCUMENT_UNAVAILABLE' || code === 'TEST_FIXTURE_REQUIRED' ? 422
        : code === 'FORBIDDEN' || code === 'WRONG_OWNER' ? 403
          : code === 'DOCUMENT_NOT_FOUND' ? 404 : 503
    return reply({ error: status === 503 ? 'DOCUMENT_PIPELINE_UNAVAILABLE' : code }, status)
  }
})
