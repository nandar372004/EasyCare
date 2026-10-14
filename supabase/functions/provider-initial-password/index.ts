import { createClient } from 'npm:@supabase/supabase-js@2.109.0'
import { changeProviderInitialPassword } from '../_shared/provider-password-change.js'

Deno.serve(async request => {
  const origin = request.headers.get('origin') ?? ''
  const allowedOrigins = (Deno.env.get('PROVIDER_APPLICATION_ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map(value => value.trim()).filter(Boolean)
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

  try {
    const options = { auth: { persistSession: false, autoRefreshToken: false } }
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const userClient = createClient(url, anonKey, { ...options, global: { headers: { Authorization: authorization } } })
    const admin = createClient(url, serviceKey, options)
    const token = authorization.slice('Bearer '.length)
    const { data, error } = await userClient.auth.getUser(token)
    if (error || !data?.user) return reply({ error: 'UNAUTHORIZED' }, 401)
    let body: Record<string, unknown>
    try { body = await request.json() } catch { return reply({ error: 'INVALID_REQUEST' }, 400) }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => key !== 'new_password')) return reply({ error: 'INVALID_REQUEST' }, 400)
    const result = await changeProviderInitialPassword({ userClient, admin, userId: data.user.id, newPassword: body.new_password })
    return reply(result.body, result.status)
  } catch {
    return reply({ error: 'PROVIDER_SETUP_UNAVAILABLE' }, 500)
  }
})
