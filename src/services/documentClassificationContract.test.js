import { describe, expect, it } from 'vitest'
import { MEDICAL_DOCUMENT_TYPES } from '../../supabase/functions/_shared/medical-document-contract.js'
import {
  DOCUMENT_CLASSIFICATION_TYPES, DOCUMENT_CLASSIFICATION_JSON_SCHEMA,
  DOCUMENT_CLASSIFICATION_REVIEW_THRESHOLD, validateDocumentClassificationOutput,
  DOCUMENT_EXTRACTION_OUTPUT_CONTRACTS,
} from './documentExtractionContract.js'

const documentId = '76000000-0000-4000-8000-000000000020'
const candidate = overrides => ({
  document_type: 'lab_report', confidence: 0.93, review_required: true,
  source_document_id: documentId, ...overrides,
})

describe('classification candidate output contract', () => {
  it('reuses every Phase H type and includes referral and progress note without changing upload categories', () => {
    expect(DOCUMENT_CLASSIFICATION_TYPES).toEqual(expect.arrayContaining(MEDICAL_DOCUMENT_TYPES))
    expect(DOCUMENT_CLASSIFICATION_TYPES).toContain('referral')
    expect(DOCUMENT_CLASSIFICATION_TYPES).toContain('progress_note')
    expect(new Set(DOCUMENT_CLASSIFICATION_TYPES).size).toBe(DOCUMENT_CLASSIFICATION_TYPES.length)
    expect(MEDICAL_DOCUMENT_TYPES).not.toContain('referral')
    expect(DOCUMENT_EXTRACTION_OUTPUT_CONTRACTS.classification).toBe(DOCUMENT_CLASSIFICATION_JSON_SCHEMA)
  })

  it.each(DOCUMENT_CLASSIFICATION_TYPES)('accepts %s only as a source-bound candidate requiring review', type => {
    const result = validateDocumentClassificationOutput(candidate({ document_type: type }), documentId)
    expect(result).toEqual({ success: true, data: candidate({ document_type: type }) })
  })

  it.each([0, 0.1, DOCUMENT_CLASSIFICATION_REVIEW_THRESHOLD - 0.001, 0.8, 1])('requires review at confidence %s', confidence => {
    expect(validateDocumentClassificationOutput(candidate({ confidence })).data.review_required).toBe(true)
    expect(validateDocumentClassificationOutput(candidate({ confidence, review_required: false })).success).toBe(false)
  })

  it('accepts ambiguous other with low confidence and mandatory review', () => {
    expect(validateDocumentClassificationOutput(candidate({ document_type: 'other', confidence: 0.2 })).success).toBe(true)
  })

  it.each([
    null, [], 'lab_report', {},
    candidate({ document_type: 'diagnosis' }), candidate({ confidence: -0.01 }),
    candidate({ confidence: 1.01 }), candidate({ confidence: NaN }),
    candidate({ confidence: Infinity }), candidate({ confidence: '0.9' }),
    candidate({ review_required: false }), candidate({ source_document_id: 'not-a-document' }),
    candidate({ diagnoses: ['unrequested fact'] }), candidate({ candidateFacts: [] }),
    { document_type: 'lab_report', confidence: 0.9, source_document_id: documentId },
  ])('rejects malformed or clinical payload %#', payload => {
    expect(validateDocumentClassificationOutput(payload, documentId).success).toBe(false)
  })

  it('rejects a model that substitutes another source reference', () => {
    expect(validateDocumentClassificationOutput(candidate(), '76000000-0000-4000-8000-000000000021').success).toBe(false)
  })
})
