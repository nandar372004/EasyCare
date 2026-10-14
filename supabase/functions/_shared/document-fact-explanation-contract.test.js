import { describe, expect, it } from 'vitest'
import {
  CONFIRMED_REVIEW_MESSAGE_MY,
  createDocumentFactExplanationContract,
  createTemplateDocumentFactExplanationAdapter,
  validateDocumentFactExplanation,
} from './document-fact-explanation-contract.js'

const fact = overrides => ({
  id: '76000000-0000-4000-8000-000000000030', extraction_id: '76000000-0000-4000-8000-000000000021',
  clinical_document_id: '76000000-0000-4000-8000-000000000020', patient_id: '76000000-0000-4000-8000-000000000001',
  fact_type: 'lab_result', name: 'HbA1c', value_text: '6.4%', value_numeric: null, unit: null,
  reference_range_text: null, abnormal_flag: null, source_excerpt: 'HbA1c = 6.4%', source_page: 2,
  source_section: 'Laboratory results', confidence: 0.82, confidence_band: 'medium', review_status: 'needs_review',
  ...overrides,
})

describe('plain-language fact explanation contract', () => {
  it.each([
    ['lab_result', 'HbA1c', '6.4%', null],
    ['medication_candidate', 'Amlodipine', '5 mg', null],
    ['vital_candidate', 'Blood pressure', '120/80 mmHg', null],
    ['condition_candidate', 'asthma', null, null],
    ['allergy_candidate', 'peanuts', null, null],
    ['procedure_candidate', 'chest imaging', 'No acute findings', null],
    ['follow_up_candidate', 'clinic visit', 'in two weeks', null],
    ['other', 'record note', null, null],
  ])('creates safe source-aware %s language', async (factType, name, value, referenceRange) => {
    const candidate = fact({ fact_type: factType, name, value_text: value, source_excerpt: `${name}${value ? ` ${value}` : ''}`, reference_range_text: referenceRange })
    const explanation = await createTemplateDocumentFactExplanationAdapter().explain(candidate)
    expect(validateDocumentFactExplanation(explanation, candidate)).toBe(true)
    expect(explanation.plain_language_explanation).toContain(name)
    expect(explanation.uncertainty_note).toBeTruthy()
  })

  it('describes a condition mention without converting it into a diagnosis', async () => {
    const candidate = fact({ fact_type: 'condition_candidate', name: 'asthma', source_excerpt: 'History of asthma is noted.' })
    const explanation = await createTemplateDocumentFactExplanationAdapter().explain(candidate)
    expect(explanation.plain_language_explanation).toMatch(/not a diagnosis confirmed/i)
    expect(explanation.plain_language_explanation).not.toMatch(/you have asthma/i)
  })

  it('mentions only an explicitly supplied reference range or abnormal flag', async () => {
    const adapter = createTemplateDocumentFactExplanationAdapter()
    const noRange = await adapter.explain(fact())
    expect(noRange.plain_language_explanation).not.toMatch(/abnormal|high|low|normal|reference range/i)
    expect(validateDocumentFactExplanation({ ...noRange, plain_language_explanation: 'This value is abnormally high.' }, fact())).toBe(false)
    const withRange = fact({ reference_range_text: '4.0–5.6%', source_excerpt: 'HbA1c 6.4%; range 4.0–5.6%' })
    const explicit = await adapter.explain(withRange)
    expect(explicit.plain_language_explanation).toContain('4.0–5.6%')
    expect(explicit.uncertainty_note).toContain('does not determine')
  })

  it('preserves review-aware language and suppresses rejected facts', async () => {
    const adapter = createTemplateDocumentFactExplanationAdapter()
    expect((await adapter.explain(fact())).review_message).toBe('AI extracted this from your document. Please review it.')
    const confirmed = fact({ review_status: 'confirmed' })
    expect((await adapter.explain(confirmed)).review_message).toBe('This item was patient-reviewed and confirmed. This is not clinician confirmation.')
    expect(CONFIRMED_REVIEW_MESSAGE_MY).toBe('လူနာမှ ပြန်လည်စစ်ဆေးပြီးဖြစ်သည်။ ၎င်းသည် ဆရာဝန်မှ အတည်ပြုခြင်း မဟုတ်ပါ။')
    expect(validateDocumentFactExplanation(await adapter.explain(fact({ review_status: 'rejected' })), fact({ review_status: 'rejected' }))).toBe(false)
  })

  it('ties the displayed contract to fact, extraction, document, locator, confidence, and review state', async () => {
    const candidate = fact()
    const fields = await createTemplateDocumentFactExplanationAdapter().explain(candidate)
    expect(createDocumentFactExplanationContract(fields, candidate).source_reference).toEqual({
      fact_id: candidate.id, extraction_id: candidate.extraction_id, source_document_id: candidate.clinical_document_id,
      source_page: 2, source_section: 'Laboratory results', source_excerpt: candidate.source_excerpt,
      confidence: 0.82, confidence_band: 'medium', review_state: 'needs_review',
      information_origin: 'Source-derived explanation of an AI-extracted candidate; not clinician-confirmed.',
    })
  })

  it('rejects diagnosis, treatment, dose-change, and emergency claims from an injected adapter', async () => {
    const candidate = fact()
    for (const phrase of ['You have diabetes.', 'You should stop your medication.', 'Change your dose now.', 'This is a medical emergency.']) {
      const output = await createTemplateDocumentFactExplanationAdapter().explain(candidate)
      expect(validateDocumentFactExplanation({ ...output, plain_language_explanation: phrase }, candidate)).toBe(false)
    }
  })
})
