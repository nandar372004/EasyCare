import { describe, expect, it, vi } from 'vitest'
import { removeMedicalDocument, uploadMedicalDocument } from '../../supabase/functions/_shared/medical-document-operations.js'

const row = { id:'doc-1', storage_path:'patient/doc/file.pdf', mime_type:'application/pdf' }

describe('medical document storage and metadata coordination', () => {
  it('removes the uploaded object when metadata recording fails', async () => {
    const calls = []
    const result = await uploadMedicalDocument({ path:row.storage_path, bytes:new Uint8Array([1]), mimeType:row.mime_type, metadata:{} }, {
      uploadStorage: async () => calls.push('upload'),
      recordMetadata: async () => { throw new Error('failed') },
      removeStorage: async () => calls.push('remove'),
      storageExists: async () => false,
    })
    expect(result).toEqual({ ok:false, error:'METADATA_CREATE_FAILED' })
    expect(calls).toEqual(['upload','remove'])
  })

  it('reports cleanup failure rather than hiding a possible orphan object', async () => {
    const result = await uploadMedicalDocument({ path:row.storage_path, bytes:new Uint8Array([1]), mimeType:row.mime_type, metadata:{} }, {
      uploadStorage: async () => {}, recordMetadata: async () => { throw new Error('failed') },
      removeStorage: async () => { throw new Error('failed') }, storageExists: async () => true,
    })
    expect(result).toEqual({ ok:false, error:'STORAGE_CLEANUP_FAILED' })
  })

  it('records metadata only after a successful private upload', async () => {
    const order = []
    const result = await uploadMedicalDocument({ path:row.storage_path, bytes:new Uint8Array([1]), mimeType:row.mime_type, metadata:{} }, {
      uploadStorage: async () => order.push('storage'),
      recordMetadata: async () => { order.push('metadata'); return row.id },
    })
    expect(result).toEqual({ ok:true, id:row.id })
    expect(order).toEqual(['storage','metadata'])
  })

  it('does not remove metadata when Storage deletion fails and the object remains', async () => {
    const setRemoved = vi.fn()
    const result = await removeMedicalDocument(row, {
      download: async () => new Uint8Array([1]), removeStorage: async () => { throw new Error('no') },
      storageExists: async () => true, setRemoved, status: async () => 'active',
      restoreStorage: async () => {}, restoreActive: async () => {},
    })
    expect(result).toEqual({ ok:false, error:'STORAGE_DELETE_FAILED' })
    expect(setRemoved).not.toHaveBeenCalled()
  })

  it('restores the object when metadata removal fails after Storage deletion', async () => {
    const restoreStorage = vi.fn()
    const result = await removeMedicalDocument(row, {
      download: async () => new Uint8Array([1]), removeStorage: async () => {}, storageExists: async () => false,
      setRemoved: async () => { throw new Error('rpc unavailable') }, status: async () => 'active',
      restoreStorage, restoreActive: async () => {},
    })
    expect(result).toEqual({ ok:false, error:'METADATA_REMOVE_FAILED' })
    expect(restoreStorage).toHaveBeenCalledWith(row.storage_path, expect.any(Uint8Array), row.mime_type)
  })

  it('restores the object and reports a safe dependency error when the metadata update hits a foreign key', async () => {
    const restoreStorage = vi.fn()
    const result = await removeMedicalDocument(row, {
      download: async () => new Uint8Array([1]), removeStorage: async () => {}, storageExists: async () => false,
      setRemoved: async () => { throw Object.assign(new Error('foreign key'), { code: '23503' }) }, status: async () => 'active',
      restoreStorage, restoreActive: async () => {},
    })
    expect(result).toEqual({ ok: false, error: 'DATABASE_DEPENDENCY_BLOCKED' })
    expect(restoreStorage).toHaveBeenCalledWith(row.storage_path, expect.any(Uint8Array), row.mime_type)
  })

  it('reports compensation failure if the source file cannot be restored', async () => {
    const result = await removeMedicalDocument(row, {
      download: async () => new Uint8Array([1]), removeStorage: async () => {}, storageExists: async () => false,
      setRemoved: async () => { throw new Error('failed') }, status: async () => 'active',
      restoreStorage: async () => { throw new Error('failed') }, restoreActive: async () => {},
    })
    expect(result).toEqual({ ok:false, error:'REMOVAL_COMPENSATION_FAILED' })
  })

  it('only returns success after both removed metadata and missing object are confirmed', async () => {
    const result = await removeMedicalDocument(row, {
      download: async () => new Uint8Array([1]), removeStorage: async () => {}, storageExists: async () => false,
      setRemoved: async () => {}, status: async () => 'removed', restoreStorage: async () => {}, restoreActive: async () => {},
    })
    expect(result).toEqual({ ok:true })
  })
})
