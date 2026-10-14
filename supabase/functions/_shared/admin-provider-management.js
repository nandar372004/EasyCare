export const ADMIN_PROVIDER_TYPES = Object.freeze(['doctor', 'nurse_aide', 'skilled_nurse_aide', 'special_nurse'])

const ALLOWED_REQUEST_KEYS = new Set(['action', 'email', 'display_name', 'provider_type', 'initial_password'])

export function createAdminProviderManagementHandler({ createClient, env }) {
  return async request => {
    const origin = request.headers.get('origin') ?? ''
    const allowedOrigins = (env.get('PROVIDER_APPLICATION_ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',').map(value => value.trim()).filter(Boolean)
    const headers = {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }
    if (allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers })
    if (origin && !allowedOrigins.includes(origin)) return reply({ error: 'ORIGIN_DENIED' }, 403)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405)

    const authorization = request.headers.get('authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return reply({ error: 'UNAUTHORIZED' }, 401)
    try {
      const url = env.get('SUPABASE_URL')
      const anonKey = env.get('SUPABASE_ANON_KEY')
      const serviceKey = env.get('SUPABASE_SERVICE_ROLE_KEY')
      const options = { auth: { persistSession: false, autoRefreshToken: false } }
      const userClient = createClient(url, anonKey, { ...options, global: { headers: { Authorization: authorization } } })
      const admin = createClient(url, serviceKey, options)
      const token = authorization.slice('Bearer '.length)
      const authorizationResult = await authorizeAdminProviderManagement(userClient, token)
      if (!authorizationResult.allowed) return reply({ error: authorizationResult.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN' }, authorizationResult.status)

      let body
      try { body = await request.json() } catch { return reply({ error: 'INVALID_REQUEST' }, 400) }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !ALLOWED_REQUEST_KEYS.has(key)))
        return reply({ error: 'INVALID_REQUEST' }, 400)

      if (body.action === 'list') {
        const { data, error } = await admin.from('providers').select('id,profile_id,provider_type,display_name,verification_status,account_status,setup_state,profiles(full_name,email,status)')
          .in('provider_type', ADMIN_PROVIDER_TYPES).order('created_at', { ascending: false })
        if (error) return reply({ error: 'PROVIDER_LIST_UNAVAILABLE' }, 500)
        return reply({ providers: data ?? [] })
      }

      if (body.action !== 'create') return reply({ error: 'INVALID_REQUEST' }, 400)
      const result = await createAdminProvider(admin, {
        email: body.email,
        displayName: body.display_name,
        providerType: body.provider_type,
        initialPassword: body.initial_password,
      })
      return reply(result.body, result.status)
    } catch {
      return reply({ error: 'PROVIDER_MANAGEMENT_UNAVAILABLE' }, 500)
    }
  }
}

export async function authorizeAdminProviderManagement(userClient, token) {
  const { data, error } = await userClient.auth.getUser(token)
  if (error || !data?.user) return { allowed: false, status: 401 }
  const result = await userClient.rpc('is_main_admin')
  if (result.error || result.data !== true) return { allowed: false, status: 403 }
  return { allowed: true, user: data.user }
}

export function validateInitialPassword(password) {
  return typeof password === 'string' && password.length >= 12 && password.length <= 128
    && /[A-Za-z]/.test(password) && /[0-9]/.test(password)
}

export async function createAdminProvider(admin, { email, displayName, providerType, initialPassword }) {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  const normalizedName = typeof displayName === 'string' ? displayName.trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 320)
    return { status: 400, body: { error: 'INVALID_EMAIL' } }
  if (!normalizedName || normalizedName.length > 160)
    return { status: 400, body: { error: 'INVALID_DISPLAY_NAME' } }
  if (!ADMIN_PROVIDER_TYPES.includes(providerType))
    return { status: 400, body: { error: 'UNSUPPORTED_PROVIDER_TYPE' } }
  if (!validateInitialPassword(initialPassword))
    return { status: 400, body: { error: 'INVALID_INITIAL_PASSWORD' } }

  const { data, error } = await admin.auth.admin.createUser({
    email: normalizedEmail,
    password: initialPassword,
    email_confirm: true,
    user_metadata: { full_name: normalizedName },
  })
  if (error || !data?.user) return { status: 409, body: { error: 'PROVIDER_CREATION_UNAVAILABLE' } }

  const { data: providerId, error: linkError } = await admin.rpc('provision_admin_created_provider', {
    p_profile_id: data.user.id,
    p_email: normalizedEmail,
    p_display_name: normalizedName,
    p_provider_type: providerType,
  })
  if (linkError || !providerId) {
    await admin.auth.admin.deleteUser(data.user.id)
    return { status: 500, body: { error: 'PROVIDER_CREATION_UNAVAILABLE' } }
  }
  return { status: 201, body: { provider_id: providerId, account_status: 'active', setup_state: 'setup_required' } }
}
