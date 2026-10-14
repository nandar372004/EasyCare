import { describe, expect, it, vi } from 'vitest'
import { removeDraftProviderCredential } from '../../supabase/functions/_shared/provider-application-document-removal.ts'

function dependencies(overrides = {}) {
  const state = { object: true, row: true }
  const fileRow = {
    id: 'document-1', application_id: 'application-1', applicant_profile_id: 'owner-1',
    storage_path: 'owner-1/application-1/proof.pdf', mime_type: 'application/pdf', file_name: 'proof.pdf',
  }
  const calls = []
  const deps = {
    authenticate: vi.fn(async () => ({ id: 'owner-1' })),
    getProfile: vi.fn(async () => ({ role: 'patient', status: 'active' })),
    getApplication: vi.fn(async () => ({ id: 'application-1', applicant_profile_id: 'owner-1', status: 'draft' })),
    getDocument: vi.fn(async () => fileRow),
    isPrivateBucket: vi.fn(async () => true),
    download: vi.fn(async () => new Uint8Array([1, 2, 3])),
    removeStorage: vi.fn(async () => { calls.push('storage.remove'); state.object = false }),
    storageExists: vi.fn(async () => state.object),
    deleteMetadata: vi.fn(async () => { calls.push('metadata.delete'); state.row = false }),
    documentExists: vi.fn(async () => state.row),
    restoreStorage: vi.fn(async () => { state.object = true }),
    restoreMetadata: vi.fn(async () => { state.row = true }),
    state,
    calls,
    fileRow,
  }
  Object.assign(deps, overrides)
  return deps
}

const request = { authorization: 'Bearer test', applicationId: 'application-1', documentId: 'document-1' }

describe('provider application draft credential removal coordination', () => {
  it('removes the owner draft object and metadata and verifies neither remains', async () => {
    const deps = dependencies()
    await expect(removeDraftProviderCredential(request, deps)).resolves.toEqual({ status: 200, body: { ok: true } })
    expect(deps.calls).toEqual(['storage.remove', 'metadata.delete'])
    expect(deps.state).toEqual({ object: false, row: false })
  })

  it.each(['other applicant', 'inactive account', 'admin account'])('does not mutate for an ineligible caller: %s', async scenario => {
    const deps = dependencies({
      getProfile: vi.fn(async () => scenario === 'inactive account' ? { role: 'patient', status: 'suspended' }
        : scenario === 'admin account' ? { role: 'main_admin', status: 'active' } : { role: 'patient', status: 'active' }),
      getApplication: vi.fn(async () => scenario === 'other applicant' ? null : ({ id: 'application-1', applicant_profile_id: 'owner-1', status: 'draft' })),
    })
    if (scenario === 'other applicant') deps.authenticate.mockResolvedValue({ id: 'other-user' })
    const result = await removeDraftProviderCredential(request, deps)
    expect(result.status).toBe(scenario === 'other applicant' ? 404 : 403)
    expect(deps.removeStorage).not.toHaveBeenCalled()
    expect(deps.deleteMetadata).not.toHaveBeenCalled()
  })

  it('does not remove a document from another application owned by the same user', async () => {
    const deps = dependencies({
      getDocument: vi.fn(async () => ({ ...dependencies().fileRow, application_id: 'different-application' })),
    })
    const result = await removeDraftProviderCredential(request, deps)
    expect(result.status).toBe(404)
    expect(deps.removeStorage).not.toHaveBeenCalled()
    expect(deps.deleteMetadata).not.toHaveBeenCalled()
  })

  it.each(['submitted', 'under_review', 'verified', 'rejected'])('rejects %s applications before deleting either layer', async status => {
    const deps = dependencies({ getApplication: vi.fn(async () => ({ id: 'application-1', applicant_profile_id: 'owner-1', status })) })
    const result = await removeDraftProviderCredential(request, deps)
    expect(result.status).toBe(409)
    expect(deps.removeStorage).not.toHaveBeenCalled()
    expect(deps.deleteMetadata).not.toHaveBeenCalled()
  })

  it('preserves metadata when Storage removal fails and the object remains', async () => {
    const deps = dependencies({ removeStorage: vi.fn(async () => { throw new Error('storage error') }) })
    const result = await removeDraftProviderCredential(request, deps)
    expect(result).toMatchObject({ status: 503, body: { error: 'STORAGE_DELETE_FAILED' } })
    expect(deps.state).toEqual({ object: true, row: true })
    expect(deps.deleteMetadata).not.toHaveBeenCalled()
  })

  it('restores the file if metadata deletion fails after Storage removal', async () => {
    const deps = dependencies({
      deleteMetadata: vi.fn(async () => { throw new Error('database error') }),
    })
    const result = await removeDraftProviderCredential(request, deps)
    expect(result).toMatchObject({ status: 503, body: { error: 'REMOVAL_FAILED_RESTORED' } })
    expect(deps.restoreStorage).toHaveBeenCalledWith(deps.fileRow.storage_path, new Uint8Array([1, 2, 3]), 'application/pdf')
    expect(deps.state).toEqual({ object: true, row: true })
  })

  it('refuses to operate if the credential bucket is public', async () => {
    const deps = dependencies({ isPrivateBucket: vi.fn(async () => false) })
    expect(await removeDraftProviderCredential(request, deps)).toMatchObject({ status: 503, body: { error: 'PRIVATE_STORAGE_UNAVAILABLE' } })
    expect(deps.removeStorage).not.toHaveBeenCalled()
    expect(deps.deleteMetadata).not.toHaveBeenCalled()
  })
})
