import { describe, expect, it, vi } from 'vitest'
import { GENERIC_AUTH_ERROR, loadAuthorizedProvider, signInProvider } from './authService.js'

function makeClient({ authError = null, setup = [{ profile_role: 'provider', provider_id: 'provider-1', provider_type: 'doctor', display_name: 'Dr Example', account_status: 'active', setup_state: 'ready' }] } = {}) {
  return {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue(authError ? { data: null, error: authError } : { data: { session: { user: { id: 'user-1' } }, user: { id: 'user-1' } }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'provider' }, error: null }) }) }) })),
    rpc: vi.fn().mockResolvedValue({ data: setup, error: null }),
  }
}

describe('provider authentication service', () => {
  it('uses provider email credentials then resolves role and setup identity from authenticated sources', async () => {
    const client = makeClient()
    const result = await signInProvider({ email: 'DR.Example@EasyCare.Test', password: 'Secret123' }, client)
    expect(result.provider).toEqual({ id: 'provider-1', type: 'doctor', displayName: 'Dr Example' })
    expect(result.providerSetup.setupState).toBe('ready')
    expect(client.from).toHaveBeenCalledWith('profiles')
    expect(client.rpc).toHaveBeenCalledWith('get_my_provider_setup_identity')
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'dr.example@easycare.test', password: 'Secret123' })
  })

  it('accepts an Admin-created setup-required provider login without clearing its session', async () => {
    const client = makeClient({ setup: [{ profile_role: 'provider', provider_id: 'p1', provider_type: 'special_nurse', account_status: 'active', setup_state: 'setup_required', display_name: 'Provider' }] })
    const result = await signInProvider({ email: 'first@example.test', password: 'Secret123' }, client)
    expect(result.provider).toBeNull()
    expect(result.providerSetup).toMatchObject({ id: 'p1', type: 'special_nurse', setupState: 'setup_required' })
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('uses a generic credential error and does not resolve provider identity', async () => {
    const client = makeClient({ authError: new Error('auth detail') })
    await expect(signInProvider({ email: 'provider@example.test', password: 'Secret123' }, client)).rejects.toThrow(GENERIC_AUTH_ERROR)
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('fails closed on malformed setup identity RPC payloads', async () => {
    const client = makeClient({ setup: [{ profile_role: 'provider', provider_id: 'provider-1', provider_type: 'support', account_status: 'active', setup_state: 'ready' }] })
    expect(await loadAuthorizedProvider(client)).toBeNull()
  })

  it('does not accept phone-number sign-in for the new account flow', async () => {
    const client = makeClient()
    await expect(signInProvider({ email: '', password: 'Secret123' }, client)).rejects.toThrow(GENERIC_AUTH_ERROR)
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled()
  })
})
