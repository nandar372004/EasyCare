import { describe, expect, it, vi } from 'vitest'
import { ADMIN_PROVIDER_TYPES, authorizeAdminProviderManagement, createAdminProvider, createAdminProviderManagementHandler } from './admin-provider-management.js'

function mockAdmin({ createError = null, linkError = null } = {}) {
  return {
    auth: { admin: {
      createUser: vi.fn().mockResolvedValue(createError ? { data: null, error: createError } : { data: { user: { id: 'auth-1' } }, error: null }),
      deleteUser: vi.fn().mockResolvedValue({ error: null }),
    } },
    rpc: vi.fn().mockResolvedValue(linkError ? { data: null, error: linkError } : { data: 'provider-1', error: null }),
  }
}

describe('admin provider management server flow', () => {
  it('supports only the four provider categories in the admin creation flow', () => {
    expect(ADMIN_PROVIDER_TYPES).toEqual(['doctor', 'nurse_aide', 'skilled_nurse_aide', 'special_nurse'])
  })

  it.each([false, true])('denies non-admin callers before provisioning (admin result %s)', async isAdmin => {
    const userClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'caller' } }, error: null }) },
      rpc: vi.fn().mockResolvedValue({ data: isAdmin, error: null }),
    }
    const result = await authorizeAdminProviderManagement(userClient, 'user-token')
    expect(result.allowed).toBe(isAdmin)
    if (!isAdmin) expect(result.status).toBe(403)
  })

  it.each(ADMIN_PROVIDER_TYPES)('creates a %s Auth account with its password only on the secure server', async providerType => {
    const admin = mockAdmin()
    const result = await createAdminProvider(admin, {
      email: ' Nurse@Example.test ', displayName: ' Nurse One ', providerType, initialPassword: 'SecureStart123',
    })
    expect(result).toEqual({ status: 201, body: { provider_id: 'provider-1', account_status: 'active', setup_state: 'setup_required' } })
    expect(admin.auth.admin.createUser).toHaveBeenCalledWith({
      email: 'nurse@example.test', password: 'SecureStart123', email_confirm: true, user_metadata: { full_name: 'Nurse One' },
    })
    expect(admin.rpc).toHaveBeenCalledWith('provision_admin_created_provider', {
      p_profile_id: 'auth-1', p_email: 'nurse@example.test', p_display_name: 'Nurse One', p_provider_type: providerType,
    })
    expect(JSON.stringify(result)).not.toContain('SecureStart123')
  })

  it('rejects unsupported provider types before creating Auth users', async () => {
    const admin = mockAdmin()
    await expect(createAdminProvider(admin, { email: 'person@example.test', displayName: 'Person', providerType: 'caregiver', initialPassword: 'SecureStart123' }))
      .resolves.toMatchObject({ status: 400, body: { error: 'UNSUPPORTED_PROVIDER_TYPE' } })
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled()
  })

  it('rejects invalid initial passwords before creating Auth users', async () => {
    const admin = mockAdmin()
    await expect(createAdminProvider(admin, { email: 'person@example.test', displayName: 'Person', providerType: 'doctor', initialPassword: 'weak' }))
      .resolves.toMatchObject({ status: 400, body: { error: 'INVALID_INITIAL_PASSWORD' } })
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled()
  })

  it('safely rejects a duplicate email without leaking account existence', async () => {
    const admin = mockAdmin({ createError: new Error('User already registered') })
    await expect(createAdminProvider(admin, { email: 'person@example.test', displayName: 'Person', providerType: 'doctor', initialPassword: 'SecureStart123' }))
      .resolves.toMatchObject({ status: 409, body: { error: 'PROVIDER_CREATION_UNAVAILABLE' } })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('deletes an unlinked Auth user if profile/provider linking fails', async () => {
    const admin = mockAdmin({ linkError: new Error('link failed') })
    await expect(createAdminProvider(admin, { email: 'person@example.test', displayName: 'Person', providerType: 'doctor', initialPassword: 'SecureStart123' }))
      .resolves.toMatchObject({ status: 500, body: { error: 'PROVIDER_CREATION_UNAVAILABLE' } })
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith('auth-1')
  })
})

describe('admin provider management HTTP and CORS boundary', () => {
  function createHandler({ isAdmin = false, getUserError = null } = {}) {
    const userClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: getUserError ? null : { id: 'caller' } }, error: getUserError }) },
      rpc: vi.fn().mockResolvedValue({ data: isAdmin, error: null }),
    }
    const admin = mockAdmin()
    const createClient = vi.fn().mockReturnValueOnce(userClient).mockReturnValueOnce(admin)
    const env = { get: name => ({
      PROVIDER_APPLICATION_ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173',
      SUPABASE_URL: 'https://staging.example.test', SUPABASE_ANON_KEY: 'public-key', SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
    })[name] }
    return { handler: createAdminProviderManagementHandler({ createClient, env }), createClient, userClient, admin }
  }

  it('answers local development preflight with required CORS headers without creating an account', async () => {
    const { handler, createClient } = createHandler()
    const response = await handler(new Request('https://function.example.test', {
      method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, apikey, content-type, x-client-info' },
    }))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization')
    expect(response.headers.get('access-control-allow-headers')).toContain('apikey')
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('denies an unapproved preflight origin', async () => {
    const { handler, createClient } = createHandler()
    const response = await handler(new Request('https://function.example.test', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }))
    expect(response.status).toBe(403)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('denies an unauthenticated POST before client creation', async () => {
    const { handler, createClient } = createHandler()
    const response = await handler(new Request('https://function.example.test', { method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create' }) }))
    expect(response.status).toBe(401)
    expect(createClient).not.toHaveBeenCalled()
  })

  it.each(['patient', 'provider'])('denies authenticated %s POST callers', async () => {
    const { handler, createClient, userClient, admin } = createHandler({ isAdmin: false })
    const response = await handler(new Request('https://function.example.test', { method: 'POST', headers: { origin: 'http://localhost:5173', authorization: 'Bearer valid-test-token', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create' }) }))
    expect(response.status).toBe(403)
    expect(userClient.auth.getUser).toHaveBeenCalledWith('valid-test-token')
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled()
    expect(createClient).toHaveBeenCalledTimes(2)
  })

  it('allows an authenticated admin POST to reach provider type validation without creating an account', async () => {
    const { handler, admin } = createHandler({ isAdmin: true })
    const response = await handler(new Request('https://function.example.test', { method: 'POST', headers: { origin: 'http://localhost:5173', authorization: 'Bearer valid-admin-token', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create', email: 'test@example.test', display_name: 'Test', provider_type: 'caregiver', initial_password: 'SecureStart123' }) }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'UNSUPPORTED_PROVIDER_TYPE' })
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled()
  })
})
