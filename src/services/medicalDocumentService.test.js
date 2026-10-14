import { describe, expect, it, vi } from 'vitest'
import { createMedicalDocumentService } from './medicalDocumentService.js'

function clientWith({ rows = [], listError = null, invokeResult = { data: { ok: true, id: 'doc-1' }, error: null }, signedUrl = 'https://signed.example/doc?token=x' } = {}) {
  const query = {
    select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => Promise.resolve({ data: rows, error: listError })),
    maybeSingle: vi.fn(() => Promise.resolve({ data: rows[0] ?? null, error: listError })),
  }
  const storageBucket = { createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl }, error: null }) }
  return {
    from: vi.fn(() => query),
    functions: { invoke: vi.fn().mockResolvedValue(invokeResult) },
    storage: { from: vi.fn(() => storageBucket) },
    query, storageBucket,
  }
}

function pdfFile(name = 'discharge.pdf', size = 10) {
  const bytes = new Uint8Array(size)
  bytes.set(new TextEncoder().encode('%PDF-'))
  return new File([bytes], name, { type: 'application/pdf' })
}

describe('medical document service', () => {
  it('lists only active patient-upload source documents for the selected patient', async () => {
    const rows = [{ id: 'doc-1', source: 'patient_upload' }]
    const client = clientWith({ rows })
    await expect(createMedicalDocumentService(client).list('patient-1')).resolves.toEqual(rows)
    expect(client.from).toHaveBeenCalledWith('clinical_documents')
    expect(client.query.eq).toHaveBeenCalledWith('patient_id', 'patient-1')
    expect(client.query.eq).toHaveBeenCalledWith('source', 'patient_upload')
    expect(client.query.eq).toHaveBeenCalledWith('status', 'active')
  })

  it('lists the signed-in patient uploads without accepting or sending any patient id', async () => {
    const rows = [{ id: 'doc-1', uploaded_by_profile_id: 'profile-1', source: 'patient_upload', status: 'active' }]
    const client = clientWith({ rows })
    await expect(createMedicalDocumentService(client).listMine('profile-1')).resolves.toEqual(rows)
    expect(client.query.eq).toHaveBeenCalledWith('uploaded_by_profile_id', 'profile-1')
    expect(client.query.eq).not.toHaveBeenCalledWith('patient_id', expect.anything())
  })

  it('validates and invokes the authenticated Edge upload with only document fields and the file', async () => {
    const client = clientWith()
    const service = createMedicalDocumentService(client)
    const file = pdfFile()
    await expect(service.upload({ file, documentType: 'discharge_summary', title: 'Hospital discharge', documentDate: '2026-08-12' }))
      .resolves.toMatchObject({ ok: true })
    const body = client.functions.invoke.mock.calls[0][1].body
    expect(client.functions.invoke.mock.calls[0][0]).toBe('medical-document-intake')
    expect(body.get('action')).toBe('upload')
    expect(body.get('document_type')).toBe('discharge_summary')
    expect(body.get('document_date')).toBe('2026-08-12')
    expect(body.get('file').name).toBe('discharge.pdf')
    expect(body.has('patient_id')).toBe(false)
    expect(body.has('uploaded_by_profile_id')).toBe(false)
  })

  it('rejects mismatched formats and oversized files before sending a request', async () => {
    const client = clientWith()
    const service = createMedicalDocumentService(client)
    await expect(service.upload({ file: new File(['x'], 'record.pdf', { type: 'image/png' }), documentType: 'other' })).rejects.toThrow(/file type matches/)
    await expect(service.upload({ file: pdfFile('large.pdf', 10 * 1024 * 1024 + 1), documentType: 'other' })).rejects.toThrow(/10 MB/)
    expect(client.functions.invoke).not.toHaveBeenCalled()
  })

  it('generates a short-lived signed URL only after a visible metadata row is found', async () => {
    const client = clientWith({ rows: [{ id: 'doc-1', storage_bucket: 'medical-documents', storage_path: 'private/path', original_filename: 'source.pdf' }] })
    const service = createMedicalDocumentService(client)
    await expect(service.createSignedUrl({ id: 'doc-1' }, 'patient-1', { download: true })).resolves.toBe('https://signed.example/doc?token=x')
    expect(client.storageBucket.createSignedUrl).toHaveBeenCalledWith('private/path', 60, { download: 'source.pdf' })
  })

  it('creates an inline signed view without taking a patient ID from the page', async () => {
    const client = clientWith({ rows: [{ id: 'doc-1', storage_bucket: 'medical-documents', storage_path: 'private/path', original_filename: 'source.pdf' }] })
    const service = createMedicalDocumentService(client)
    await expect(service.createSignedUrl({ id: 'doc-1' })).resolves.toBe('https://signed.example/doc?token=x')
    expect(client.query.eq).toHaveBeenCalledWith('id', 'doc-1')
    expect(client.query.eq).not.toHaveBeenCalledWith('patient_id', expect.anything())
    expect(client.storageBucket.createSignedUrl).toHaveBeenCalledWith('private/path', 60, undefined)
  })

  it('routes removal through the authenticated Edge endpoint', async () => {
    const client = clientWith()
    await expect(createMedicalDocumentService(client).remove('doc-1')).resolves.toMatchObject({ ok: true })
    expect(client.functions.invoke).toHaveBeenCalledWith('medical-document-intake', { body: { action: 'remove', document_id: 'doc-1' }, timeout: 60_000 })
  })

  it('surfaces a safe structured owner authorization error from removal', async () => {
    const client = clientWith({ invokeResult: { data: { error: 'FORBIDDEN' }, error: null } })
    await expect(createMedicalDocumentService(client).remove('doc-1'))
      .rejects.toMatchObject({ code: 'FORBIDDEN', message: 'This account is not authorized to remove this document.' })
    expect(client.functions.invoke).toHaveBeenCalledWith('medical-document-intake', expect.objectContaining({
      body: { action: 'remove', document_id: 'doc-1' },
    }))
  })

  it.each([
    ['UNAUTHORIZED', 'UNAUTHORIZED'],
    ['DOCUMENT_UNAVAILABLE', 'DOCUMENT_UNAVAILABLE'],
    ['STORAGE_DELETE_FAILED', 'STORAGE_DELETE_FAILED'],
    ['DATABASE_DEPENDENCY_BLOCKED', 'DATABASE_DEPENDENCY_BLOCKED'],
  ])('maps the endpoint %s code to a safe distinguishable client error', async (serverCode, expectedCode) => {
    const client = clientWith({ invokeResult: { data: { error: serverCode }, error: null } })
    await expect(createMedicalDocumentService(client).remove('doc-1'))
      .rejects.toMatchObject({ code: expectedCode })
  })

  it('distinguishes an unavailable endpoint version from a network/function failure', async () => {
    const staleEndpoint = clientWith({ invokeResult: {
      data: null,
      error: { context: { status: 404, clone: () => ({ json: async () => ({ message: 'not found' }) }) } },
    } })
    await expect(createMedicalDocumentService(staleEndpoint).remove('doc-1'))
      .rejects.toMatchObject({ code: 'ENDPOINT_VERSION_MISMATCH' })

    const networkFailure = clientWith()
    networkFailure.functions.invoke.mockRejectedValue(new Error('internal fetch diagnostics'))
    await expect(createMedicalDocumentService(networkFailure).remove('doc-1'))
      .rejects.toMatchObject({ code: 'NETWORK_FUNCTION_ERROR', message: expect.not.stringContaining('internal fetch') })
  })
})
