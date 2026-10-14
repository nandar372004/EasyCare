import { describe, expect, it, vi } from 'vitest'
import { changeProviderInitialPassword } from './provider-password-change.js'

function clients({ row = { profile_role: 'provider', provider_id: 'provider-1', provider_type: 'doctor', account_status: 'active', setup_state: 'setup_required' }, passwordError = null, stateError = null } = {}) {
  return {
    userClient: { rpc: vi.fn().mockResolvedValue({ data: row ? [row] : [], error: null }) },
    admin: {
      auth: { admin: { updateUserById: vi.fn().mockResolvedValue({ error: passwordError }) } },
      rpc: vi.fn().mockResolvedValue({ data: stateError ? null : 'profile_incomplete', error: stateError }),
    },
  }
}

describe('provider initial password change', () => {
  it('changes the authenticated provider password and advances setup without returning it', async () => {
    const { userClient, admin } = clients()
    const result = await changeProviderInitialPassword({ userClient, admin, userId: 'auth-provider', newPassword: 'NewSecurePass123' })
    expect(result).toEqual({ status: 200, body: { setup_state: 'profile_incomplete' } })
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledWith('auth-provider', { password: 'NewSecurePass123' })
    expect(admin.rpc).toHaveBeenCalledWith('complete_provider_initial_password_change', { p_profile_id: 'auth-provider' })
    expect(JSON.stringify(result)).not.toContain('NewSecurePass123')
  })

  it('rejects patients, unsupported categories, and providers outside initial setup', async () => {
    for (const row of [null, { profile_role: 'patient' }, { profile_role: 'provider', provider_id: 'p', provider_type: 'caregiver', account_status: 'active', setup_state: 'setup_required' }, { profile_role: 'provider', provider_id: 'p', provider_type: 'doctor', account_status: 'active', setup_state: 'ready' }]) {
      const { userClient, admin } = clients({ row })
      await expect(changeProviderInitialPassword({ userClient, admin, userId: 'auth-user', newPassword: 'NewSecurePass123' }))
        .resolves.toMatchObject({ status: 403 })
      expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled()
    }
  })

  it('rejects weak passwords without storing or forwarding them', async () => {
    const { userClient, admin } = clients()
    await expect(changeProviderInitialPassword({ userClient, admin, userId: 'auth-provider', newPassword: 'weak' }))
      .resolves.toMatchObject({ status: 400, body: { error: 'INVALID_PASSWORD' } })
    expect(userClient.rpc).not.toHaveBeenCalled()
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('does not advance setup when Supabase Auth rejects the password', async () => {
    const { userClient, admin } = clients({ passwordError: new Error('invalid password') })
    await expect(changeProviderInitialPassword({ userClient, admin, userId: 'auth-provider', newPassword: 'NewSecurePass123' }))
      .resolves.toMatchObject({ status: 400, body: { error: 'PASSWORD_UPDATE_FAILED' } })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('reports failed state transition without revealing account or password details', async () => {
    const { userClient, admin } = clients({ stateError: new Error('db detail') })
    await expect(changeProviderInitialPassword({ userClient, admin, userId: 'auth-provider', newPassword: 'NewSecurePass123' }))
      .resolves.toMatchObject({ status: 500, body: { error: 'PROVIDER_SETUP_UNAVAILABLE' } })
  })
})
