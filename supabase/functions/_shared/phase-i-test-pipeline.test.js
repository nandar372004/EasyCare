// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createPhaseITestAdapters, createPhaseITestPipeline,
  PHASE_I_TEST_FIXTURE_MARKER, PHASE_I_TEST_SOURCE_EXCERPT,
} from './phase-i-test-pipeline.js'

const documentId = '76000000-0000-4000-8000-000000000020'
const extractionId = '76000000-0000-4000-8000-000000000021'
const patientId = '76000000-0000-4000-8000-000000000001'
const factId = '76000000-0000-4000-8000-000000000030'
const pdf = new Uint8Array(readFileSync(join(process.cwd(), 'public/test-fixtures/easycare-phase-i-synthetic-lab-report.pdf')))

function fixtureClients(sourceDocumentId = documentId, sourceExtractionId = extractionId, sourceFactId = factId) {
  let run = { id: sourceExtractionId, clinical_document_id: sourceDocumentId, patient_id: patientId,
    requested_by_profile_id: patientId, extraction_status: 'pending' }
  let fact
  const document = { id: sourceDocumentId, patient_id: patientId, source: 'patient_upload', status: 'active',
    uploaded_by_profile_id: patientId, storage_bucket: 'medical-documents', storage_path: `${patientId}/${sourceDocumentId}.pdf`,
    mime_type: 'application/pdf', file_size: pdf.byteLength, title: 'Synthetic Lab Report', document_date: null }
  const userClient = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: patientId } }, error: null })) },
    rpc: vi.fn(async (_name, params) => ({ data: params.p_clinical_document_id === sourceDocumentId ? sourceExtractionId : null, error: null })),
    storage: { from: vi.fn(() => ({ download: vi.fn(async () => ({ data: new Blob([pdf]), error: null })) })) },
    from: vi.fn(table => {
      const query = { filters: {}, select() { return this }, eq(key, value) { this.filters[key] = value; return this },
        not() { return this }, order() { return this }, limit() { return this },
        result() {
          if (table === 'clinical_documents') return document
          if (table === 'document_extractions') return run
          if (table === 'document_extracted_facts') {
            if (query.filters.id) return fact?.id === query.filters.id ? fact : null
            return fact ? [fact] : []
          }
          return null
        },
        async maybeSingle() { const data = this.result(); return { data: Array.isArray(data) ? data[0] ?? null : data, error: null } },
        then(resolve, reject) { return Promise.resolve({ data: this.result(), error: null }).then(resolve, reject) },
      }
      return query
    }),
  }
  const serviceClient = { rpc: vi.fn(async (name, params) => {
    if (name === 'record_document_classification_candidate') {
      run = { ...run, extraction_status: 'needs_review', document_type: params.p_document_type,
        classified_at: '2026-10-07T00:00:00Z' }
      return { data: sourceExtractionId, error: null }
    }
    if (name === 'record_document_extracted_facts') {
      const candidate = params.p_candidate_facts[0]
      fact = { id: sourceFactId, extraction_id: sourceExtractionId, clinical_document_id: sourceDocumentId, patient_id: patientId,
        fact_type: candidate.factType, name: candidate.name, value_text: candidate.valueText,
        value_numeric: candidate.valueNumeric, unit: candidate.unit, reference_range_text: candidate.referenceRangeText,
        observed_at: candidate.observedAt, observed_at_time: candidate.observedAtTime,
        abnormal_flag: candidate.abnormalFlag, source_page: candidate.sourceLocator.page,
        source_section: candidate.sourceLocator.section, source_excerpt: candidate.sourceLocator.excerpt,
        confidence: candidate.confidence, confidence_band: 'high', review_status: 'needs_review' }
      return { data: 1, error: null }
    }
    if (name === 'save_my_document_fact_explanation') return { data: {
      fact_id: sourceFactId, explanation: { ...params.p_explanation_fields, source_reference: {
        fact_id: sourceFactId, extraction_id: sourceExtractionId, source_document_id: sourceDocumentId,
        source_page: 1, source_section: 'LAB REPORT', source_excerpt: PHASE_I_TEST_SOURCE_EXCERPT,
        confidence: 0.91, confidence_band: 'high', review_state: 'needs_review',
      } },
    }, error: null }
    throw new Error(`Unexpected persistence operation: ${name}`)
  }) }
  return { userClient, serviceClient, document, get fact() { return fact } }
}

describe('Phase I development test pipeline', () => {
  it('accepts only the supplied synthetic PDF and keeps its source excerpt in the upload', async () => {
    const adapters = createPhaseITestAdapters()
    expect(await adapters.sourceTextExtractor.extract({ bytes: pdf, mimeType: 'application/pdf' }))
      .toContain(PHASE_I_TEST_SOURCE_EXCERPT)
    expect(new TextDecoder('latin1').decode(pdf)).toContain(PHASE_I_TEST_FIXTURE_MARKER)
    await expect(adapters.sourceTextExtractor.extract({ bytes: new TextEncoder().encode('%PDF-other'), mimeType: 'application/pdf' }))
      .rejects.toThrow('TEST_FIXTURE_REQUIRED')
    await expect(adapters.modelAdapter.classify({ bytes: new Uint8Array(), mimeType: 'application/pdf', source_document_id: documentId }))
      .rejects.toThrow('TEST_FIXTURE_REQUIRED')
  })

  it('runs classification, extraction, explanation, and review-required persistence through the Phase I services', async () => {
    const clients = fixtureClients()
    const adapters = createPhaseITestAdapters()
    const pipeline = createPhaseITestPipeline({ ...clients, ...adapters })
    const result = await pipeline.processDocument(documentId)

    expect(result).toMatchObject({ source_document_id: documentId, extraction_id: extractionId,
      document_type: 'lab_report', candidate_count: 1, review_status: 'needs_review',
      explanation_count: 1, synthetic_test_fixture: true })
    expect(clients.fact).toMatchObject({ fact_type: 'lab_result', name: 'HbA1c', value_numeric: 6.4,
      unit: '%', source_page: 1, source_excerpt: PHASE_I_TEST_SOURCE_EXCERPT,
      confidence: 0.91, confidence_band: 'high', review_status: 'needs_review' })
    expect(clients.serviceClient.rpc.mock.calls.map(([name]) => name)).toEqual([
      'record_document_classification_candidate', 'record_document_extracted_facts',
      'save_my_document_fact_explanation',
    ])
    expect(clients.userClient.from.mock.calls.map(([table]) => table)).not.toContain('patient_conditions')
    expect(clients.userClient.from.mock.calls.map(([table]) => table)).not.toContain('patient_medications')
    expect(clients.userClient.from.mock.calls.map(([table]) => table)).not.toContain('prescriptions')
    expect(clients.serviceClient.rpc.mock.calls.some(([name]) => /diagnos|medication|prescription|care_plan/i.test(name))).toBe(false)
  })

  it('processes two different clicked Lab Report IDs through their own Phase I service boundaries', async () => {
    const reportA = '76000000-0000-4000-8000-000000000040'
    const reportB = '76000000-0000-4000-8000-000000000041'
    const clientsA = fixtureClients(reportA, '76000000-0000-4000-8000-000000000042', '76000000-0000-4000-8000-000000000043')
    const clientsB = fixtureClients(reportB, '76000000-0000-4000-8000-000000000044', '76000000-0000-4000-8000-000000000045')
    const adapters = createPhaseITestAdapters()
    const resultA = await createPhaseITestPipeline({ ...clientsA, ...adapters }).processDocument(reportA)
    const resultB = await createPhaseITestPipeline({ ...clientsB, ...adapters }).processDocument(reportB)

    expect(resultA.source_document_id).toBe(reportA)
    expect(resultB.source_document_id).toBe(reportB)
    expect(clientsA.fact.clinical_document_id).toBe(reportA)
    expect(clientsB.fact.clinical_document_id).toBe(reportB)
    expect(clientsA.userClient.rpc).toHaveBeenCalledWith('request_my_document_extraction', { p_clinical_document_id: reportA })
    expect(clientsB.userClient.rpc).toHaveBeenCalledWith('request_my_document_extraction', { p_clinical_document_id: reportB })
  })
})
