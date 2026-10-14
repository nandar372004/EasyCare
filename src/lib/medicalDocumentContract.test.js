import { describe, expect, it } from 'vitest'
import { validateMedicalDocument } from '../../supabase/functions/_shared/medical-document-contract.js'

function bytesFor(type) {
  if (type === 'application/pdf') return new TextEncoder().encode('%PDF-1.7')
  if (type === 'image/jpeg') return new Uint8Array([0xff, 0xd8, 0xff, 0x00])
  return new Uint8Array([137,80,78,71,13,10,26,10])
}

describe('medical document upload contract', () => {
  it.each([
    ['summary.pdf', 'application/pdf'], ['scan.jpg', 'image/jpeg'], ['scan.jpeg', 'image/jpeg'], ['scan.png', 'image/png'],
  ])('accepts supported extension and MIME pair %s', (filename, mimeType) => {
    expect(validateMedicalDocument({ filename, mimeType, size: 100, bytes: bytesFor(mimeType), documentType: 'other' })).toBeNull()
  })
  it('rejects unsupported type, extension mismatch, oversize, path-like names, and false file signatures', () => {
    expect(validateMedicalDocument({ filename:'record.doc', mimeType:'application/msword', size:10, bytes:new Uint8Array([1]), documentType:'other' })).toBe('UNSUPPORTED_FILE_TYPE')
    expect(validateMedicalDocument({ filename:'record.pdf', mimeType:'image/jpeg', size:10, bytes:bytesFor('image/jpeg'), documentType:'other' })).toBe('UNSUPPORTED_FILE_TYPE')
    expect(validateMedicalDocument({ filename:'record.pdf', mimeType:'application/pdf', size:10*1024*1024+1, bytes:bytesFor('application/pdf'), documentType:'other' })).toBe('FILE_SIZE_INVALID')
    expect(validateMedicalDocument({ filename:'../record.pdf', mimeType:'application/pdf', size:10, bytes:bytesFor('application/pdf'), documentType:'other' })).toBe('INVALID_FILENAME')
    expect(validateMedicalDocument({ filename:'record.pdf', mimeType:'application/pdf', size:10, bytes:new Uint8Array([1]), documentType:'other' })).toBe('FILE_CONTENT_INVALID')
  })
  it('accepts only the supported document taxonomy', () => {
    expect(validateMedicalDocument({ filename:'record.pdf', mimeType:'application/pdf', size:10, bytes:bytesFor('application/pdf'), documentType:'diagnosis' })).toBe('UNSUPPORTED_DOCUMENT_TYPE')
  })
})
