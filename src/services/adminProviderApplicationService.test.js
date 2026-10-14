import { describe, expect, it, vi } from 'vitest'
import { createAdminProviderApplicationService } from './adminProviderApplicationService.js'

function makeClient(rpcImpl = async () => ({ data: [], error: null })) {
  const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://private.invalid/signed?ttl=60' }, error: null })
  return {
    rpc: vi.fn(rpcImpl),
    storage: { from: vi.fn(() => ({ createSignedUrl })) },
    createSignedUrl,
  }
}

describe('admin provider application service', () => {
  it('normalizes the SQL status column for the review queue', async () => {
    const client = makeClient(async () => ({ data: [{ application_id: 'app-1', application_status: 'submitted' }], error: null }))
    await expect(createAdminProviderApplicationService(client).list('submitted')).resolves.toEqual([
      { application_id: 'app-1', application_status: 'submitted', status: 'submitted' },
    ])
  })

  it('uses auth-bound admin RPCs and never submits a reviewer identity', async () => {
    const client = makeClient(async name => ({ data: name === 'is_main_admin', error: null }))
    const service = createAdminProviderApplicationService(client)
    expect(await service.isAdmin()).toBe(true)
    await service.list('submitted')
    await service.load('application-1')
    await service.startReview('application-1')
    await service.approve('application-1')
    await service.reject('application-2', 'Please provide a current license.')
    expect(client.rpc).toHaveBeenCalledWith('is_main_admin', undefined)
    expect(client.rpc).toHaveBeenCalledWith('admin_list_provider_applications', { p_status: 'submitted' })
    expect(client.rpc).toHaveBeenCalledWith('admin_get_provider_application', { p_application_id: 'application-1' })
    expect(client.rpc).toHaveBeenCalledWith('admin_start_provider_application_review', { p_application_id: 'application-1' })
    expect(client.rpc).toHaveBeenCalledWith('admin_approve_provider_application', { p_application_id: 'application-1' })
    expect(client.rpc).toHaveBeenCalledWith('admin_reject_provider_application', { p_application_id: 'application-2', p_safe_reason: 'Please provide a current license.' })
    for (const [, args] of client.rpc.mock.calls) expect(Object.keys(args || {}).some(key => /reviewer|verified_by|actor/i.test(key))).toBe(false)
  })

  it('only creates a short-lived signed URL for a document returned by the admin detail RPC', async () => {
    const client = makeClient(async name => ({
      data: name === 'admin_get_provider_application'
        ? { documents: [{ storage_path: 'owner/application/license.pdf' }] }
        : [],
      error: null,
    }))
    const service = createAdminProviderApplicationService(client)
    await expect(service.createCredentialUrl('application-1', 'other/application/license.pdf')).rejects.toThrow(/Unable/)
    expect(client.createSignedUrl).not.toHaveBeenCalled()
    await expect(service.createCredentialUrl('application-1', 'owner/application/license.pdf')).resolves.toBe('https://private.invalid/signed?ttl=60')
    expect(client.storage.from).toHaveBeenCalledWith('provider-credential-evidence')
    expect(client.createSignedUrl).toHaveBeenCalledWith('owner/application/license.pdf', 60)
  })

  it('fails closed when the admin authorization RPC is unavailable', async () => {
    const client = makeClient(async () => ({ data: true, error: new Error('permission denied') }))
    expect(await createAdminProviderApplicationService(client).isAdmin()).toBe(false)
  })
})
