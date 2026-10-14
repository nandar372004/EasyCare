import { describe, expect, it, vi } from 'vitest'
import { createProviderSetupService, normalizeProviderSetupIdentity } from './providerSetupService.js'

const row = { profile_role: 'provider', provider_id: 'provider-id', provider_type: 'doctor', account_status: 'invited', setup_state: 'setup_required' }

describe('provider setup identity', () => {
  it('accepts only linked provider roles with supported provider types and lifecycle states', () => {
    expect(normalizeProviderSetupIdentity(row)).toMatchObject({ id: 'provider-id', type: 'doctor', setupState: 'setup_required' })
    expect(normalizeProviderSetupIdentity({ ...row, profile_role: 'patient' })).toBeNull()
    expect(normalizeProviderSetupIdentity({ ...row, provider_type: 'admin' })).toBeNull()
    expect(normalizeProviderSetupIdentity({ ...row, provider_type: 'caregiver' })).toBeNull()
    expect(normalizeProviderSetupIdentity({ ...row, account_status: 'disabled' })).toBeNull()
  })

  it('calls only the authenticated setup RPCs and exposes generic failures', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'sensitive database detail' } })
    const service = createProviderSetupService({ rpc })
    await expect(service.begin()).rejects.toThrow(/start provider setup/i)
    await expect(service.complete({ displayName: 'Provider', phone: '0900000000' })).rejects.toThrow(/save provider setup/i)
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['begin_my_provider_setup', 'complete_my_provider_setup'])
  })

  it('changes the initial password through the authenticated server function', async () => {
    const client = {
      functions: { invoke: vi.fn().mockResolvedValue({ data: { setup_state: 'profile_incomplete' }, error: null }) },
    }
    const service = createProviderSetupService(client)
    await expect(service.changeInitialPassword('NewSecurePass123')).resolves.toEqual({ setup_state: 'profile_incomplete' })
    expect(client.functions.invoke).toHaveBeenCalledWith('provider-initial-password', { body: { new_password: 'NewSecurePass123' } })
  })
})
