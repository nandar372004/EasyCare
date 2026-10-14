import { describe, expect, it, vi } from 'vitest'
import { createProviderApplicationService, PROVIDER_APPLICATION_BUCKET } from './providerApplicationService.js'

function client(rpcImpl = async () => ({ data: 'application-id', error: null })) {
  const upload = vi.fn().mockResolvedValue({ data: { path: 'stored' }, error: null })
  const remove = vi.fn().mockResolvedValue({ data: [], error: null })
  const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://private.invalid/signed' }, error: null })
  const rpc = vi.fn(rpcImpl)
  const invoke = vi.fn().mockResolvedValue({ data: { ok: true }, error: null })
  return { rpc, functions: { invoke }, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) }, storage: { from: vi.fn(bucket => ({ upload, remove, createSignedUrl, bucket })) }, upload, remove, createSignedUrl, invoke }
}

describe('provider application service security boundary', () => {
  it('uses only auth-bound application RPCs without applicant/provider identity arguments', async () => {
    const api = client()
    const service = createProviderApplicationService(api)
    await service.load()
    await service.saveDraft(null, { requested_provider_type: 'doctor' })
    await service.saveDraft('application-id', { requested_provider_type: 'doctor' })
    await service.submit('application-id')
    expect(api.rpc).toHaveBeenCalledWith('get_my_provider_application', undefined)
    expect(api.rpc).toHaveBeenCalledWith('save_provider_application_draft', { p_application_id: null, p_fields: { requested_provider_type: 'doctor' } })
    expect(api.rpc).toHaveBeenCalledWith('submit_provider_application', { p_application_id: 'application-id' })
    for (const [, args] of api.rpc.mock.calls) expect(Object.keys(args || {}).some(key => /applicant|profile|user|provider|verifier/i.test(key))).toBe(false)
  })

  it('uploads only approved credential types to private storage and records owner-scoped metadata', async () => {
    const api = client(async name => ({ data: name === 'record_provider_application_document' ? 'document-uuid' : 'application-id', error: null }))
    const service = createProviderApplicationService(api, () => '11111111-2222-4333-8444-555555555555')
    const file = new File(['credential'], 'Medical License.pdf', { type: 'application/pdf' })
    const result = await service.uploadCredential('application-id', file, 'professional_license')
    expect(api.storage.from).toHaveBeenCalledWith(PROVIDER_APPLICATION_BUCKET)
    expect(api.upload).toHaveBeenCalledWith(expect.stringMatching(/^user-1\/application-id\/11111111-2222-4333-8444-555555555555-Medical_License\.pdf$/), file, { contentType: 'application/pdf', upsert: false })
    expect(api.rpc).toHaveBeenCalledWith('record_provider_application_document', expect.objectContaining({ p_application_id: 'application-id', p_document_type: 'professional_license', p_mime_type: 'application/pdf', p_file_size: file.size }))
    expect(result.id).toBe('document-uuid')
  })

  it.each([
    ['text/plain','credential.txt',4],['application/pdf','credential.exe',4],['image/jpeg','credential.jpg',10 * 1024 * 1024 + 1],['image/png','empty.png',0],
  ])('rejects unsafe or oversized credential upload %s %s', async (type, name, size) => {
    const api = client()
    const service = createProviderApplicationService(api)
    const file = new File([new Uint8Array(size)], name, { type })
    await expect(service.uploadCredential('application-id', file, 'other')).rejects.toThrow(/Upload|extension|10 MB/)
    expect(api.upload).not.toHaveBeenCalled()
  })

  it('cleans up a private object if recording its metadata fails', async () => {
    const api = client(async () => ({ data: null, error: new Error('database detail') }))
    const service = createProviderApplicationService(api, () => '11111111-2222-4333-8444-555555555555')
    await expect(service.uploadCredential('application-id', new File(['x'], 'proof.png', { type: 'image/png' }), 'other')).rejects.toThrow('Unable to complete your provider application. Please try again.')
    expect(api.remove).toHaveBeenCalledWith(['user-1/application-id/11111111-2222-4333-8444-555555555555-proof.png'])
  })

  it('creates only short-lived signed download links for the current owner folder', async () => {
    const api = client()
    const service = createProviderApplicationService(api)
    await expect(service.createDownloadUrl('other-user/application-id/doc.pdf')).rejects.toThrow(/Unable to complete/)
    expect(await service.createDownloadUrl('user-1/application-id/doc.pdf')).toBe('https://private.invalid/signed')
    expect(api.createSignedUrl).toHaveBeenCalledWith('user-1/application-id/doc.pdf', 60)
  })

  it('requests credential removal by application and document only, without browser identity arguments', async () => {
    const api = client()
    const service = createProviderApplicationService(api)
    await expect(service.removeCredential('application-id', 'document-id')).resolves.toBe(true)
    expect(api.invoke).toHaveBeenCalledWith('remove-provider-application-document', {
      body: { application_id: 'application-id', document_id: 'document-id' },
    })
    expect(api.rpc).not.toHaveBeenCalled()
  })

  it('does not treat a partial Edge Function result as successful removal', async () => {
    const api = client()
    api.functions.invoke.mockResolvedValue({ data: { ok: false, error: 'REMOVAL_COMPENSATION_FAILED' }, error: null })
    const service = createProviderApplicationService(api)
    await expect(service.removeCredential('application-id', 'document-id')).rejects.toThrow('REMOVAL_COMPENSATION_FAILED')
  })
})
