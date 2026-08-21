import { describe, expect, it, vi } from 'vitest'
import { GENERIC_AUTH_ERROR, loadAuthorizedPatient, signInPatient, signOutPatient } from './authService.js'

function queryResult(data, error = null) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue({ data, error }),
  }
  return chain
}

function clientFor({ authError = null, profile = { id: 'patient-1', auth_user_id: 'user-1', full_name: 'Synthetic Patient', status: 'active' } } = {}) {
  const query = queryResult(profile)
  return {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({
        data: authError ? null : { session: { access_token: 'synthetic-token', user: { id: 'user-1' } }, user: { id: 'user-1' } },
        error: authError,
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => query),
    query,
  }
}

describe('patient authentication service', () => {
  it('signs in with the derived internal email and returns an authorized patient role', async () => {
    const client = clientFor()
    const result = await signInPatient({ phoneNumber: '09 123-456-789', password: 'Synthetic123' }, client)
    const credentials = client.auth.signInWithPassword.mock.calls[0][0]
    expect(credentials.email).toMatch(/^[a-f0-9]{64}@phone-auth\.medibridge\.invalid$/)
    expect(credentials.email).not.toContain('09123456789')
    expect(credentials.password).toBe('Synthetic123')
    expect(result.patient.auth_user_id).toBe('user-1')
    expect(result).not.toHaveProperty('profile')
  })

  it('uses a generic error for invalid credentials', async () => {
    const client = clientFor({ authError: new Error('specific provider error') })
    await expect(signInPatient({ phoneNumber: '09123456789', password: 'Wrong123' }, client)).rejects.toThrow(GENERIC_AUTH_ERROR)
  })

  it('rejects an inactive patient and clears the local session', async () => {
    const client = clientFor({ profile: { id: 'patient-1', auth_user_id: 'user-1', status: 'inactive' } })
    await expect(signInPatient({ phoneNumber: '09123456789', password: 'Synthetic123' }, client)).rejects.toThrow(GENERIC_AUTH_ERROR)
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('looks up only the authenticated patient', async () => {
    const client = clientFor()
    await loadAuthorizedPatient('user-1', client)
    expect(client.from).toHaveBeenCalledWith('patients')
    expect(client.query.eq).toHaveBeenCalledWith('auth_user_id', 'user-1')
  })

  it('logs out through the Supabase local session scope', async () => {
    const client = clientFor()
    await signOutPatient(client)
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
})
