import { createDocumentHealthPipeline } from './document-health-pipeline.js'
import { createEnglishOnlyFactExplanation } from './document-fact-explanation-contract.js'

export const PHASE_I_TEST_FIXTURE_MARKER = 'EASYCARE_PHASE_I_SYNTHETIC_LAB_REPORT_V1'
export const PHASE_I_TEST_SOURCE_EXCERPT = 'HbA1c result: 6.4 %'
export const PHASE_I_TEST_SOURCE_TEXT = [
  'SYNTHETIC TEST FIXTURE - NOT A REAL PATIENT RESULT',
  PHASE_I_TEST_FIXTURE_MARKER,
  'LAB REPORT',
  PHASE_I_TEST_SOURCE_EXCERPT,
  'This sample is for software workflow testing only.',
].join('\n')

const pdfContains = (bytes, value) => new TextDecoder('latin1').decode(bytes).includes(value)
export const isPhaseITestPdf = bytes => pdfContains(bytes, PHASE_I_TEST_FIXTURE_MARKER)
  && pdfContains(bytes, PHASE_I_TEST_SOURCE_EXCERPT)

export function createPhaseITestAdapters() {
  const metadata = Object.freeze({ provider: 'EasyCare deterministic test fixture', name: 'synthetic-lab-report', version: '1.0.0' })
  return {
    sourceTextExtractor: {
      async extract({ bytes, mimeType }) {
        if (mimeType !== 'application/pdf' || !isPhaseITestPdf(bytes)) {
          throw new Error('TEST_FIXTURE_REQUIRED')
        }
        return PHASE_I_TEST_SOURCE_TEXT
      },
    },
    modelAdapter: {
      metadata,
      async classify({ bytes, mimeType, source_document_id }) {
        if (mimeType !== 'application/pdf' || !isPhaseITestPdf(bytes)) throw new Error('TEST_FIXTURE_REQUIRED')
        return { document_type: 'lab_report', confidence: 0.99, review_required: true, source_document_id }
      },
      async extract({ sourceText, source_document_id, documentType }) {
        if (documentType !== 'lab_report' || !sourceText.includes(PHASE_I_TEST_SOURCE_EXCERPT)) {
          throw new Error('TEST_FIXTURE_REQUIRED')
        }
        return {
          sourceDocumentId: source_document_id,
          documentType: 'lab_report',
          summary: 'Synthetic lab report uploaded for Phase I workflow testing.',
          reviewRequired: true,
          candidateFacts: [{
            factType: 'lab_result', name: 'HbA1c', valueText: null, valueNumeric: 6.4, unit: '%',
            referenceRangeText: null, observedAt: null, observedAtTime: null, abnormalFlag: null,
            strengthText: null, formText: null, frequencyText: null, instructionText: null,
            recommendedAt: null, sourceContext: 'Laboratory result in a synthetic test report.',
            sourceLocator: { page: 1, section: 'LAB REPORT', excerpt: PHASE_I_TEST_SOURCE_EXCERPT },
            confidence: 0.91, reviewRequired: true,
            explanation: 'Synthetic source transcription; review it against the uploaded report.',
          }],
        }
      },
    },
  }
}

/** Orchestrates the actual Phase I server services; the adapters are deterministic and test-only. */
export function createPhaseITestPipeline({ userClient, serviceClient, sourceTextExtractor, modelAdapter }) {
  const syntheticExplanationAdapter = {
    async explain(fact) {
      const result = createEnglishOnlyFactExplanation(fact)
      return {
        ...result,
        simple_title_en: `Synthetic test: ${result.simple_title_en}`.slice(0, 120),
        short_summary_en: `Synthetic test fixture only. ${result.short_summary_en}`.slice(0, 240),
        plain_language_explanation_en: `Synthetic software test content, not a real patient result. ${result.plain_language_explanation_en}`.slice(0, 1000),
        uncertainty_note_en: `Synthetic software test content, not a real patient result. ${result.uncertainty_note_en}`.slice(0, 400),
      }
    },
  }
  const pipeline = createDocumentHealthPipeline({ userClient, serviceClient, sourceTextExtractor, modelAdapter, explanationAdapter: syntheticExplanationAdapter })
  return { async processDocument(documentId) { return { ...await pipeline.processDocument(documentId), synthetic_test_fixture: true } } }
}
