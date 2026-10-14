// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ensureClinicalDocumentsBucket } from '../../supabase/scripts/setup_clinical_documents_storage.mjs'

describe('clinical document bucket provisioning', () => {
  const client = result => ({storage: {getBucket: vi.fn().mockResolvedValue(result), createBucket: vi.fn().mockResolvedValue({error:null})}})
  it('creates a private bucket through Storage API', async () => {
    const c = client({error:{statusCode:'404'}})
    await ensureClinicalDocumentsBucket(c)
    expect(c.storage.createBucket).toHaveBeenCalledWith('clinical-documents',{public:false})
  })
  it('accepts an existing private bucket without changing it', async () => {
    const c = client({data:{public:false}})
    await ensureClinicalDocumentsBucket(c)
    expect(c.storage.createBucket).not.toHaveBeenCalled()
  })
  it('refuses an existing public bucket', async () => {
    await expect(ensureClinicalDocumentsBucket(client({data:{public:true}}))).rejects.toThrow('must be private')
  })
  it('propagates inspection errors without trying creation', async () => {
    const c = client({error:{statusCode:403}})
    await expect(ensureClinicalDocumentsBucket(c)).rejects.toEqual({statusCode:403})
    expect(c.storage.createBucket).not.toHaveBeenCalled()
  })
  it('propagates creation failure', async () => {
    const c = client({error:{statusCode:404}})
    c.storage.createBucket.mockResolvedValue({error:new Error('failed')})
    await expect(ensureClinicalDocumentsBucket(c)).rejects.toThrow('failed')
  })
})
