import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_EXTRACTION_JSON_SCHEMA, EXTRACTED_FACT_TYPES,
  DOCUMENT_EXTRACTION_CONFIDENCE_BANDS, getDocumentExtractionConfidenceBand,
  validateDocumentExtractionOutput,
} from './documentExtractionContract.js'

const documentId = '76000000-0000-4000-8000-000000000020'
const sourceText = 'Lab Results: HbA1c 6.1 percent. Medication: Drug X 5 mg tablet once daily. oxygen saturation 97%. Patient denies taking Drug X. Imaging notes no acute findings. Follow-up in two weeks.'

function fact(overrides = {}) {
  return {
    factType: 'lab_result', name: 'HbA1c', valueText: null, valueNumeric: 6.1,
    unit: 'percent', referenceRangeText: null, observedAt: null, observedAtTime: null,
    abnormalFlag: null, strengthText: null, formText: null, frequencyText: null,
    instructionText: null, recommendedAt: null, sourceContext: null,
    sourceLocator: { page: 1, section: 'Lab Results', excerpt: 'HbA1c 6.1 percent' },
    confidence: 0.9, reviewRequired: true, explanation: 'A value copied from the document.',
    ...overrides,
  }
}

function output(candidateFacts = [fact()], overrides = {}) {
  return {
    sourceDocumentId: documentId, documentType: 'lab_report',
    summary: 'The source contains a laboratory result.', candidateFacts, reviewRequired: true,
    ...overrides,
  }
}

describe('structured candidate health-fact contract', () => {
  it('provides controlled minimum fact types and a strict schema', () => {
    expect(EXTRACTED_FACT_TYPES).toEqual(expect.arrayContaining([
      'lab_result', 'medication_candidate', 'vital_candidate', 'condition_candidate',
      'procedure_candidate', 'follow_up_candidate', 'other',
    ]))
    expect(DOCUMENT_EXTRACTION_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(DOCUMENT_EXTRACTION_JSON_SCHEMA.properties.reviewRequired.const).toBe(true)
    expect(DOCUMENT_EXTRACTION_JSON_SCHEMA.properties.candidateFacts.items.additionalProperties).toBe(false)
  })

  it.each([[0.85, 'high'], [1, 'high'], [0.60, 'medium'], [0.84, 'medium'], [0, 'low'], [0.59, 'low']])
    ('maps confidence %s to the %s band without implying certainty', (confidence, expected) => {
      expect(getDocumentExtractionConfidenceBand(confidence)).toBe(expected)
    })

  it('rejects invalid confidence scores and requires review for low-confidence output', () => {
    expect(DOCUMENT_EXTRACTION_CONFIDENCE_BANDS).toEqual({ high: 0.85, medium: 0.60 })
    expect(getDocumentExtractionConfidenceBand(-0.1)).toBeNull()
    expect(getDocumentExtractionConfidenceBand(1.1)).toBeNull()
    expect(validateDocumentExtractionOutput(output([fact({ confidence: 0.1, reviewRequired: false })])).success).toBe(false)
    expect(validateDocumentExtractionOutput(output([fact({ confidence: 0.1 })])).success).toBe(true)
  })

  it('accepts structured supported facts when excerpts are present in the source', () => {
    const candidates = [
      fact(),
      fact({ factType: 'medication_candidate', name: 'Drug X', valueNumeric: null, unit: null,
        strengthText: '5 mg', formText: 'tablet', frequencyText: 'once daily',
        sourceLocator: { page: 1, section: 'Medication', excerpt: 'Drug X 5 mg tablet once daily' } }),
      fact({ factType: 'vital_candidate', name: 'oxygen saturation', valueNumeric: 97, unit: '%',
        sourceLocator: { page: 1, section: 'Vitals', excerpt: 'oxygen saturation 97%' } }),
      fact({ factType: 'condition_candidate', name: 'Drug X use', valueText: 'denied', valueNumeric: null,
        sourceLocator: { page: 1, section: 'History', excerpt: 'Patient denies taking Drug X' } }),
      fact({ factType: 'procedure_candidate', name: 'Imaging finding', valueText: 'no acute findings', valueNumeric: null,
        sourceLocator: { page: 1, section: 'Imaging', excerpt: 'Imaging notes no acute findings' } }),
      fact({ factType: 'follow_up_candidate', name: 'Follow-up', valueText: 'in two weeks', valueNumeric: null,
        instructionText: 'Follow-up in two weeks',
        sourceLocator: { page: 1, section: 'Plan', excerpt: 'Follow-up in two weeks' } }),
    ]
    expect(validateDocumentExtractionOutput(output(candidates), {
      expectedSourceDocumentId: documentId, allowedDocumentTypes: ['lab_report'], sourceText,
    }).success).toBe(true)
  })

  it('preserves negation and uncertainty as candidate text instead of promoting it', () => {
    const candidate = fact({ factType: 'condition_candidate', name: 'Drug X use', valueText: 'patient denies',
      valueNumeric: null, explanation: 'The document records a denial; this is not a confirmed condition.',
      sourceLocator: { page: 1, section: 'History', excerpt: 'Patient denies taking Drug X' } })
    const result = validateDocumentExtractionOutput(output([candidate]), { sourceText })
    expect(result.success).toBe(true)
    expect(result.data.candidateFacts[0].reviewRequired).toBe(true)
    expect(result.data.candidateFacts[0]).not.toHaveProperty('confirmed')
    expect(result.data.candidateFacts[0]).not.toHaveProperty('diagnosis')
  })

  it('rejects missing lab/vital values rather than inventing values', () => {
    expect(validateDocumentExtractionOutput(output([fact({ valueText: null, valueNumeric: null })])).success).toBe(false)
    expect(validateDocumentExtractionOutput(output([fact({ factType: 'vital_candidate', valueText: null, valueNumeric: null })])).success).toBe(false)
  })

  it('rejects excerpts not grounded in supplied source text', () => {
    expect(validateDocumentExtractionOutput(output([fact({ sourceLocator: { page: 2, section: 'Results', excerpt: 'invented result 99' } })]), { sourceText }).success).toBe(false)
  })

  it.each([
    ['self-confirmation', output([fact({ reviewRequired: false })])],
    ['unsupported fact type', output([fact({ factType: 'diagnosis' })])],
    ['extra output field', { ...output(), diagnoses: ['not allowed'] }],
    ['source identity substitution', output([fact()], { sourceDocumentId: '76000000-0000-4000-8000-000000000021' })],
    ['invalid confidence', output([fact({ confidence: 1.2 })])],
    ['malformed locator', output([fact({ sourceLocator: { page: null, section: null, excerpt: '' } })])],
    ['unsupported date', output([fact({ observedAt: '2026-99-99' })])],
  ])('rejects %s', (_name, payload) => {
    expect(validateDocumentExtractionOutput(payload, { expectedSourceDocumentId: documentId, sourceText }).success).toBe(false)
  })
})
