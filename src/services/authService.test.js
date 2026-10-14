import { describe, expect, it, vi } from 'vitest'
import {
  GENERIC_AUTH_ERROR, loadAuthorizedAdmin, loadAuthorizedPatient, loadAuthorizedProfileRole,
  PROVIDER_ACCESS_ERROR, resolveAuthenticatedIdentity, signInAdminWithEmail, signInPatient,
  signInProvider, signInWithEmail, signOutPatient,
} from './authService.js'

const defaultPatient = { id: 'patient-1', auth_user_id: 'user-1', full_name: 'Synthetic Patient', status: 'active' }
const defaultSetup = { profile_role: 'provider', provider_id: 'provider-1', provider_type: 'doctor', display_name: 'Dr Example', account_status: 'active', setup_state: 'setup_required' }

function queryResult(data, error = null) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  }
  return chain
}

function clientFor({ authError = null, role = 'patient', patient = defaultPatient, providerSetup = defaultSetup, admin = false, roleError = null } = {}) {
  const profileQuery = queryResult(role ? { role } : null, roleError)
  const patientQuery = queryResult(patient)
  const queries = { profiles: profileQuery, patients: patientQuery }
  const client = {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({
        data: authError ? null : { session: { access_token: 'synthetic-token', user: { id: 'user-1' } }, user: { id: 'user-1' } },
        error: authError,
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(table => queries[table]),
    queries,
    rpc: vi.fn(name => Promise.resolve({
      data: name === 'is_main_admin' ? admin : name === 'get_my_provider_setup_identity' ? providerSetup ? [providerSetup] : [] : [],
      error: null,
    })),
  }
  return client
}

describe('role-first authentication identity resolution', () => {
  it('resolves the authenticated profile role before any identity-specific lookup', async () => {
    const client = clientFor()
    expect(await loadAuthorizedProfileRole('user-1', client)).toBe('patient')
    expect(client.from).toHaveBeenCalledWith('profiles')
    expect(client.queries.profiles.maybeSingle).toHaveBeenCalledOnce()
  })

  it('authenticates a Doctor by email without querying patients and returns setup_required identity', async () => {
    const client = clientFor({ role: 'provider', patient: null, providerSetup: defaultSetup })
    const identity = await signInWithEmail({ email: ' DR.Example@EasyCare.Test ', password: 'InitialPass123' }, client)
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'dr.example@easycare.test', password: 'InitialPass123' })
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(['profiles'])
    expect(client.rpc).toHaveBeenCalledWith('get_my_provider_setup_identity')
    expect(identity).toMatchObject({ role: 'provider', patient: null, provider: null, providerSetup: { id: 'provider-1', type: 'doctor', setupState: 'setup_required' } })
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('routes a ready Doctor provider identity without looking for a patient row', async () => {
    const client = clientFor({ role: 'provider', patient: null, providerSetup: { ...defaultSetup, setup_state: 'ready' } })
    const identity = await signInProvider({ email: 'doctor@example.test', password: 'Secret123' }, client)
    expect(identity.provider).toMatchObject({ id: 'provider-1', type: 'doctor' })
    expect(identity.providerSetup.setupState).toBe('ready')
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(['profiles'])
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('resolves Admin by profile role and server authorization without querying patient identity', async () => {
    const client = clientFor({ role: 'admin', patient: null, providerSetup: null, admin: true })
    const identity = await signInWithEmail({ email: ' Admin@Example.Test ', password: 'Synthetic123' }, client)
    expect(identity).toMatchObject({ role: 'admin', admin: true, patient: null, provider: null })
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(['profiles'])
    expect(client.rpc).toHaveBeenCalledWith('is_main_admin')
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('keeps the Admin-only email wrapper from admitting a provider', async () => {
    const client = clientFor({ role: 'provider', patient: null })
    await expect(signInAdminWithEmail({ email: 'doctor@example.test', password: 'InitialPass123' }, client)).rejects.toThrow(GENERIC_AUTH_ERROR)
    expect(client.rpc).toHaveBeenCalledWith('get_my_provider_setup_identity')
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('keeps patient phone/password login on the patient-only identity path', async () => {
    const client = clientFor({ providerSetup: null })
    const result = await signInPatient({ phoneNumber: '09 123-456-789', password: 'Synthetic123' }, client)
    const credentials = client.auth.signInWithPassword.mock.calls[0][0]
    expect(credentials.email).toMatch(/^[a-f0-9]{64}@phone-auth\.medibridge\.invalid$/)
    expect(credentials.email).not.toContain('09123456789')
    expect(result).toMatchObject({ role: 'patient', patient: { auth_user_id: 'user-1' }, provider: null, admin: false })
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(['profiles', 'patients'])
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('does not treat a provider as a phone-login identity or query patients for that role', async () => {
    const client = clientFor({ role: 'provider', patient: null })
    await expect(signInPatient({ phoneNumber: '09123456789', password: 'InitialPass123' }, client)).rejects.toThrow(GENERIC_AUTH_ERROR)
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(['profiles'])
    expect(client.rpc).not.toHaveBeenCalled()
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('handles zero patient rows safely through maybeSingle', async () => {
    const client = clientFor({ role: 'patient', patient: null })
    expect(await loadAuthorizedPatient('user-1', client)).toBeNull()
    expect(client.queries.patients.maybeSingle).toHaveBeenCalledOnce()
  })

  it('never queries patients for Admin or Provider identity resolution', async () => {
    const provider = clientFor({ role: 'provider', patient: null })
    await resolveAuthenticatedIdentity('user-1', provider)
    expect(provider.from.mock.calls.map(([table]) => table)).toEqual(['profiles'])
    const admin = clientFor({ role: 'admin', patient: null, admin: true })
    await resolveAuthenticatedIdentity('user-1', admin)
    expect(admin.from.mock.calls.map(([table]) => table)).toEqual(['profiles'])
  })

  it('uses generic errors for invalid credentials without clearing a session', async () => {
    const client = clientFor({ authError: new Error('specific auth detail') })
    await expect(signInWithEmail({ email: 'doctor@example.test', password: 'Wrong123' }, client)).rejects.toThrow(GENERIC_AUTH_ERROR)
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('preserves a valid auth session when profile role lookup fails', async () => {
    const client = clientFor({ role: null, roleError: new Error('profile lookup unavailable') })
    await expect(signInWithEmail({ email: 'doctor@example.test', password: 'InitialPass123' }, client)).rejects.toThrow(GENERIC_AUTH_ERROR)
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('does not sign out when provider setup identity is absent', async () => {
    const client = clientFor({ role: 'provider', patient: null, providerSetup: null })
    await expect(signInProvider({ email: 'person@example.test', password: 'Synthetic123' }, client)).rejects.toThrow(PROVIDER_ACCESS_ERROR)
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(['profiles'])
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('logs out explicitly through Supabase local session scope', async () => {
    const client = clientFor()
    await signOutPatient(client)
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
})
