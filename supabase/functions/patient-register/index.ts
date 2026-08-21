const GENERIC_ERROR = { error: 'Registration is temporarily unavailable.' }
const RATE_LIMIT_ATTEMPTS = 5
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const rateWindows = new Map<string, { count: number; resetsAt: number }>()

function consumeRateLimit(key: string) {
  const now = Date.now()
  if (rateWindows.size > 5_000) {
    for (const [storedKey, window] of rateWindows) {
      if (window.resetsAt <= now) rateWindows.delete(storedKey)
    }
  }
  const current = rateWindows.get(key)
  if (!current || current.resetsAt <= now) {
    rateWindows.set(key, { count: 1, resetsAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (current.count >= RATE_LIMIT_ATTEMPTS) return false
  current.count += 1
  return true
}

function logStage(stage: string, details: Record<string, unknown> = {}) {
  console.log(`patient-register:${stage}`, details)
}

function safeError(error: unknown) {
  if (!error || typeof error !== 'object') return { code: 'UNKNOWN' }
  const candidate = error as { code?: string; name?: string; status?: number; message?: string }
  return {
    code: candidate.code ?? 'UNKNOWN',
    name: candidate.name ?? 'Error',
    status: candidate.status,
    message: candidate.message?.slice(0, 240),
  }
}

function isLoopbackDevelopmentOrigin(origin: string) {
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

function response(body: Record<string, unknown>, status: number, origin?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type'
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    headers.Vary = 'Origin'
  }
  // Fetch forbids a response body for null-body statuses such as 204. The
  // browser CORS preflight uses 204, so it must be constructed with `null`.
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers })
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request) => {
  logStage('request_received', { method: request.method })
  const requestOrigin = request.headers.get('origin') ?? ''
  const configuredOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  const allowedOrigin = configuredOrigins.includes(requestOrigin) || isLoopbackDevelopmentOrigin(requestOrigin)
    ? requestOrigin
    : undefined

  if (requestOrigin && !allowedOrigin) {
    logStage('origin_rejected')
    return response(GENERIC_ERROR, 403)
  }
  if (request.method === 'OPTIONS') return response({}, 204, allowedOrigin)
  if (request.method !== 'POST') return response(GENERIC_ERROR, 405, allowedOrigin)

  try {

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const rateLimitPepper = Deno.env.get('AUTH_RATE_LIMIT_PEPPER')
  if (!supabaseUrl || !serviceRoleKey || !rateLimitPepper) {
    logStage('configuration_failed', {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
      hasRateLimitPepper: Boolean(rateLimitPepper),
    })
    return response(GENERIC_ERROR, 503, allowedOrigin)
  }

  let createClient: typeof import('npm:@supabase/supabase-js@2.109.0').createClient
  let executeRegistration: typeof import('../_shared/registration-core.ts').executeRegistration
  try {
    ;({ createClient } = await import('npm:@supabase/supabase-js@2.109.0'))
    ;({ executeRegistration } = await import('../_shared/registration-core.ts'))
  } catch {
    // No request content is logged. This marker only distinguishes a deployed
    // dependency-loading problem from configuration or persistence failures.
    console.error('patient-register:dependency-load-failed')
    return response(GENERIC_ERROR, 503, allowedOrigin)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const clientAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const keyHash = await sha256(`${rateLimitPepper}:patient-registration:${clientAddress}`)
  if (!consumeRateLimit(keyHash)) {
    logStage('rate_limited')
    return response({ error: 'Too many attempts. Please try again later.' }, 429, allowedOrigin)
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    logStage('request_parse_failed')
    return response({ error: 'Unable to register with these details.' }, 400, allowedOrigin)
  }

  const result = await executeRegistration(payload, {
    phoneExists: async (phone) => {
      const { data, error } = await admin.from('patients').select('id').eq('primary_phone', phone).maybeSingle()
      if (error) {
        console.error('patient-register:phone_lookup_error', safeError(error))
        throw new Error('LOOKUP_FAILED')
      }
      return Boolean(data)
    },
    createUser: async (email, password) => {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { registration_method: 'phone_password' },
      })
      if (error || !data.user) {
        console.error('patient-register:auth_create_error', safeError(error))
        throw new Error('CREATE_FAILED')
      }
      return { id: data.user.id }
    },
    persistPatient: async (input) => {
      const { error } = await admin.rpc('create_patient_registration', {
        registration: input,
      })
      if (error) {
        console.error('patient-register:persistence_error', safeError(error))
        throw new Error('PERSIST_FAILED')
      }
    },
    deleteUser: async (id) => {
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) {
        console.error('patient-register:auth_rollback_error', safeError(error))
        throw new Error('CLEANUP_FAILED')
      }
    },
    logStage,
  })

  return response(result.body, result.status, allowedOrigin)
  } catch (error) {
    console.error('patient-register:unexpected_error', safeError(error))
    return response(GENERIC_ERROR, 500, allowedOrigin)
  }
})
