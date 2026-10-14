import { describe, expect, it, vi } from 'vitest'
import { createDocumentHealthIntelligenceService } from './documentHealthIntelligenceService.js'

const ids = ['76000000-0000-4000-8000-000000000030', '76000000-0000-4000-8000-000000000031', '76000000-0000-4000-8000-000000000032']
const extractionIds = ['76000000-0000-4000-8000-000000000021', '76000000-0000-4000-8000-000000000022', '76000000-0000-4000-8000-000000000023']
const docIds = ['76000000-0000-4000-8000-000000000020', '76000000-0000-4000-8000-000000000024', '76000000-0000-4000-8000-000000000025']
const patientId = '76000000-0000-4000-8000-000000000001'

function row(index, overrides = {}) {
  const fact = {
    id: ids[index], extraction_id: extractionIds[index], clinical_document_id: docIds[index], patient_id: patientId,
    fact_type: 'lab_result', name: `Test ${index}`, value_text: `${index + 1}`, value_numeric: null, unit: null,
    abnormal_flag: null, source_page: index + 1, source_section: 'Results', source_excerpt: `Test ${index} ${index + 1}`,
    confidence: 0.88, confidence_band: 'high', review_status: 'needs_review', reviewed_at: null,
    created_at: `2026-10-0${index + 1}T10:00:00Z`,
    ...overrides,
  }
  fact.plain_language_explanation = {
    simple_title: `Lab result: ${fact.name}`, short_summary: `${fact.name} is recorded as ${fact.value_text}.`,
    plain_language_explanation: `${fact.name} is recorded as ${fact.value_text}.`,
    why_it_may_matter: 'This may be useful to review with your healthcare professional alongside the original document.',
    review_message: fact.review_status === 'confirmed' ? 'This item was patient-reviewed and confirmed. This is not clinician confirmation.' : 'AI extracted this from your document. Please review it.',
    uncertainty_note: 'This explanation describes what the source says; it does not determine what the result means for you.',
    source_reference: {
      fact_id: fact.id, extraction_id: fact.extraction_id, source_document_id: fact.clinical_document_id,
      source_page: fact.source_page, source_section: fact.source_section, source_excerpt: fact.source_excerpt,
      confidence: fact.confidence, confidence_band: fact.confidence_band, review_state: fact.review_status,
    },
  }
  return fact
}

function fixture({ facts = [row(0)], documents, runs = [], factError = null } = {}) {
  const docs = documents || facts.map((fact, index) => ({ id: fact.clinical_document_id, title: `Report ${index}`, document_type: 'lab_report', document_date: '2026-10-01', status: 'active', source: 'patient_upload' }))
  const payloads = { document_extracted_facts: { data: facts, error: factError }, clinical_documents: { data: docs, error: null }, document_extractions: { data: runs, error: null } }
  const calls = []
  const client = { from: vi.fn(table => {
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), in: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(() => query) }
    query.range = vi.fn((from,to) => { query.window=[from,to]; return query })
    query.then = (resolve, reject) => {
      let payload=payloads[table]
      if(query.window) {
        let data=payload.data
        if(table==='document_extracted_facts') data=data.filter(fact=>fact.review_status==='needs_review')
        payload={...payload,data:data.map(row=>({...row,patient_id:patientId})).slice(query.window[0],query.window[1]+1)}
      }
      if(table==='clinical_documents') payload={...payload,data:payload.data.map(row=>({...row,patient_id:patientId}))}
      return Promise.resolve(payload).then(resolve,reject)
    }
    calls.push({ table, query })
    return query
  }) }
  return { client, calls, service: createDocumentHealthIntelligenceService(client) }
}

describe('dashboard health-intelligence service', () => {
  it('counts unexplained candidates beyond the display limit and preserves extraction signals with existing facts',async()=>{
    const facts=Array.from({length:501},(_,i)=>({...row(0),id:`fact-${i}`,plain_language_explanation:null}))
    const f=fixture({facts,runs:[{id:'run',clinical_document_id:docIds[0],extraction_status:'processing'},{id:'failed',clinical_document_id:docIds[0],extraction_status:'failed'}]})
    const result=await f.service.getOverviewForPatient(patientId)
    expect(result.pending_review_count).toBe(501)
    expect(result.pending_review_items).toHaveLength(501)
    expect(result.items).toEqual([])
    expect(result.extraction_pending).toBe(true)
    expect(result.extraction_failed).toBe(true)
    expect(result.document_review_status).toBe('not_defined')
  })
  it('counts invalid explanations and excludes removed sources and their pending runs',async()=>{
    const invalid=row(0); invalid.plain_language_explanation={invalid:true}
    const removed=row(1)
    const f=fixture({facts:[invalid,removed],documents:[{id:docIds[0],status:'active',source:'patient_upload'},{id:docIds[1],status:'removed',source:'patient_upload'}],runs:[{id:'run',clinical_document_id:docIds[1],extraction_status:'pending'}]})
    const result=await f.service.getOverviewForPatient(patientId)
    expect(result.pending_review_count).toBe(1)
    expect(result.pending_review_items[0].fact_id).toBe(ids[0])
    expect(result.extraction_pending).toBe(false)
  })
  it('does not hide a pending extraction when explained facts already display',async()=>{
    const result=await fixture({runs:[{id:'pending',clinical_document_id:docIds[0],extraction_status:'pending'}]}).service.getOverviewForPatient(patientId)
    expect(result.items).toHaveLength(1)
    expect(result.pending_review_count).toBe(1)
    expect(result.extraction_pending).toBe(true)
  })
  it('filters by the requested patient and exposes only reviewed candidate summaries with source links', async () => {
    const f = fixture()
    const result = await f.service.getForPatient(patientId)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      fact_id: ids[0], card_type: 'recent_result', review_status: 'needs_review',
      source_document_id: docIds[0], source_page: 1,
      name: 'Test 0', value_text: '1',
      related_tab_destination: `/lab-results?factId=${ids[0]}&sourceDocumentId=${docIds[0]}`,
    })
    expect(result.items[0].review_message).toContain('Please review')
    expect(f.calls[0].query.eq).toHaveBeenCalledWith('patient_id', patientId)
    expect(f.calls[0].query.in).toHaveBeenCalledWith('review_status', ['needs_review', 'confirmed'])
    expect(f.client.from).toHaveBeenCalledTimes(2)
    expect(result.items[0]).not.toHaveProperty('explanation')
    expect(result.items[0]).not.toHaveProperty('model_provider')
  })

  it('does not surface rejected facts and reports pending extraction without fabricating items', async () => {
    const rejected = fixture({ facts: [] , runs: [{ id: extractionIds[0], clinical_document_id: docIds[0], extraction_status: 'pending' }] })
    const result = await rejected.service.getForPatient(patientId)
    expect(result).toMatchObject({ status: 'ready', items: [], extraction_pending: true })
    expect(rejected.calls[0].query.in).toHaveBeenCalledWith('review_status', ['needs_review', 'confirmed'])
  })

  it('hides deterministic synthetic test candidates while retaining real candidate facts', async () => {
    const synthetic = row(1)
    synthetic.plain_language_explanation.simple_title = 'Synthetic test: Lab result: Test 1'
    synthetic.plain_language_explanation.short_summary = 'Synthetic test fixture only. This is not a patient result.'
    synthetic.plain_language_explanation.plain_language_explanation = 'Synthetic software test content, not a real patient result.'
    const result = await fixture({ facts: [synthetic, row(0)] }).service.getForPatient(patientId)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].fact_id).toBe(ids[0])
    expect(result.items[0].name).toBe('Test 0')
  })

  it('exposes validated English and Myanmar explanation fields together', async () => {
    const bilingual = row(0)
    bilingual.plain_language_explanation = {
      simple_title_en: 'Lab result: Test 0', simple_title_my: 'ဓာတ်ခွဲရလဒ် Test 0',
      short_summary_en: 'Test 0 is recorded in the source.', short_summary_my: 'အရင်းအမြစ်တွင် Test 0 ကို မှတ်တမ်းတင်ထားသည်။',
      plain_language_explanation_en: 'Test 0 is recorded in the source as a transcription, not an interpretation.',
      plain_language_explanation_my: 'Test 0 ကို အဓိပ္ပာယ်ဖွင့်ဆိုခြင်းမဟုတ်ဘဲ ကူးယူဖော်ပြထားသည်။',
      why_it_may_matter_en: 'Review this candidate with your healthcare professional.',
      why_it_may_matter_my: 'ဤအချက်ကို ကျန်းမာရေးပညာရှင်နှင့် ပြန်လည်စစ်ဆေးပါ။',
      review_message_en: 'AI extracted this from your document. Please review it.',
      review_message_my: 'ဒီအချက်အလက်ကို AI က သင့် document ထဲကနေ ထုတ်ယူထားတာပါ။ ကျေးဇူးပြုပြီး ပြန်လည်စစ်ဆေးပါ။',
      uncertainty_note_en: 'The source does not provide a reference range, so this explanation does not interpret the value.',
      uncertainty_note_my: 'အရင်းအမြစ်တွင် ရည်ညွှန်းအတိုင်းအတာကို မဖော်ပြထားသဖြင့် တန်ဖိုးကို အဓိပ္ပာယ်ဖွင့်ဆိုခြင်းမပြုပါ။',
      source_assertion: 'affirmed', translation_status: 'complete',
      source_reference: {
        fact_id: bilingual.id, extraction_id: bilingual.extraction_id,
        source_document_id: bilingual.clinical_document_id, source_page: bilingual.source_page,
        source_section: bilingual.source_section, source_excerpt: bilingual.source_excerpt,
        confidence: bilingual.confidence, confidence_band: bilingual.confidence_band,
        review_state: bilingual.review_status,
      },
    }
    const result = await fixture({ facts: [bilingual] }).service.getForPatient(patientId)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      simple_title_en: 'Lab result: Test 0', simple_title_my: 'ဓာတ်ခွဲရလဒ် Test 0',
      translation_status: 'complete',
    })
  })

  it('reports failed extraction separately from a truly empty account', async () => {
    const failed = fixture({ facts: [], runs: [{ id: extractionIds[0], clinical_document_id: docIds[0], extraction_status: 'failed' }] })
    await expect(failed.service.getForPatient(patientId)).resolves.toMatchObject({
      status: 'ready', items: [], extraction_pending: false, extraction_failed: true,
    })
  })

  it('orders explicit source flags and follow-up facts first, then recent reviewed items, and limits the output', async () => {
    const flagged = row(0, { abnormal_flag: true, created_at: '2026-09-01T00:00:00Z' })
    const followUp = row(1, { fact_type: 'follow_up_candidate', created_at: '2026-09-02T00:00:00Z' })
    followUp.plain_language_explanation.source_reference = { ...followUp.plain_language_explanation.source_reference, source_page: 2 }
    const confirmed = row(2, { review_status: 'confirmed', reviewed_at: '2026-10-06T00:00:00Z' })
    confirmed.plain_language_explanation.review_message = 'This item was patient-reviewed and confirmed. This is not clinician confirmation.'
    confirmed.plain_language_explanation.source_reference.review_state = 'confirmed'
    const f = fixture({ facts: [confirmed, followUp, flagged] })
    const result = await f.service.getForPatient(patientId, { limit: 2 })
    expect(result.items.map(item => item.fact_id)).toEqual([ids[0], ids[1]])
    expect(result.items[0].attention_level).toBe('source_flagged')
    expect(result.items[1].card_type).toBe('follow_up')
    expect(result.total_count).toBe(3)
  })

  it('hides source rows whose document is unavailable or whose explanation provenance mismatches', async () => {
    const mismatched = row(0)
    mismatched.plain_language_explanation.source_reference.source_document_id = docIds[1]
    const f = fixture({ facts: [mismatched], documents: [] })
    const result = await f.service.getForPatient(patientId)
    expect(result).toMatchObject({ status: 'unavailable', items: [], source_unavailable: true })
  })

  it('converts data API errors to a retryable service error', async () => {
    const f = fixture({ factError: { code: '42501' } })
    await expect(f.service.getForPatient(patientId)).rejects.toThrow(/temporarily unavailable/i)
  })
})

it('routes candidate types to their existing related pages', async () => {
  const { relatedTabForFactType } = await import('./documentHealthIntelligenceService.js')
  expect(relatedTabForFactType('lab_result')).toBe('/lab-results')
  expect(relatedTabForFactType('medication_candidate')).toBe('/medications')
  expect(relatedTabForFactType('condition_candidate')).toBe('/health-records')
  expect(relatedTabForFactType('allergy_candidate')).toBe('/health-records')
  expect(relatedTabForFactType('vital_candidate')).toBe('/health-records')
  expect(relatedTabForFactType('procedure_candidate')).toBe('/health-records')
  expect(relatedTabForFactType('follow_up_candidate')).toBe('/appointments')
  expect(relatedTabForFactType('other')).toBe('/medical-documents')
})
