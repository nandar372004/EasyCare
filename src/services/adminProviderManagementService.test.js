import { describe, expect, it, vi } from 'vitest'
import { createAdminProviderManagementService } from './adminProviderManagementService.js'
import { createProviderSetupService } from './providerSetupService.js'

describe('admin provider management service', () => {
  it('lists providers through the guarded server function', async () => {
    const client = { functions: { invoke: vi.fn().mockResolvedValue({ data: { providers: [{ id: 'p1' }] }, error: null }) } }
    await expect(createAdminProviderManagementService(client).list()).resolves.toEqual([{ id: 'p1' }])
    expect(client.functions.invoke).toHaveBeenCalledWith('admin-provider-management', { body: { action: 'list' } })
  })

  it('creates a provider account with the initial password sent only to the secure function', async () => {
    const client = { functions: { invoke: vi.fn().mockResolvedValue({ data: { provider_id: 'p1' }, error: null }) } }
    const service = createAdminProviderManagementService(client)
    await service.create({ email: 'nurse@example.test', displayName: 'Nurse One', providerType: 'nurse_aide', initialPassword: 'SecureStart123' })
    expect(client.functions.invoke).toHaveBeenCalledWith('admin-provider-management', {
      body: { action: 'create', email: 'nurse@example.test', display_name: 'Nurse One', provider_type: 'nurse_aide', initial_password: 'SecureStart123' },
    })
  })

  it('returns a safe duplicate-or-creation message', async () => {
    const client = { functions: { invoke: vi.fn().mockResolvedValue({ data: { error: 'PROVIDER_CREATION_UNAVAILABLE' }, error: null }) } }
    await expect(createAdminProviderManagementService(client).create({})).rejects.toThrow(/may already use this email/)
  })

  it('changes the initial password through the authenticated provider setup function', async () => {
    const client = { functions: { invoke: vi.fn().mockResolvedValue({ data: { setup_state: 'profile_incomplete' }, error: null }) } }
    await createProviderSetupService(client).changeInitialPassword('NewSecurePass123')
    expect(client.functions.invoke).toHaveBeenCalledWith('provider-initial-password', { body: { new_password: 'NewSecurePass123' } })
  })
})
