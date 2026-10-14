import { supabase } from '../lib/supabase.js'
import { BILINGUAL_FACT_EXPLANATION_FIELDS, validateDocumentFactExplanation } from '../../supabase/functions/_shared/document-fact-explanation-contract.js'

const FACT_COLUMNS = 'id,extraction_id,clinical_document_id,patient_id,fact_type,name,value_text,value_numeric,unit,reference_range_text,observed_at,observed_at_time,strength_text,form_text,frequency_text,instruction_text,source_context,abnormal_flag,source_page,source_section,source_excerpt,confidence,confidence_band,review_status,reviewed_at,created_at,plain_language_explanation'
const unavailable = () => new Error('Health intelligence is temporarily unavailable.')

function matchesStoredProvenance(explanation, fact) {
  const ref = explanation?.source_reference
  return ref?.fact_id === fact.id && ref?.extraction_id === fact.extraction_id
    && ref?.source_document_id === fact.clinical_document_id
    && ref?.source_page === (fact.source_page ?? null)
    && ref?.source_section === (fact.source_section ?? null)
    && ref?.source_excerpt === fact.source_excerpt
    && Number(ref?.confidence) === Number(fact.confidence)
    && ref?.confidence_band === fact.confidence_band && ref?.review_state === fact.review_status
}

function cardType(factType) {
  return ({
    lab_result: 'recent_result', medication_candidate: 'medication_mention',
    follow_up_candidate: 'follow_up', vital_candidate: 'vital',
  })[factType] || 'document_insight'
}

export function relatedTabForFactType(factType) {
  if (factType === 'lab_result') return '/lab-results'
  if (factType === 'medication_candidate') return '/medications'
  if (factType === 'follow_up_candidate') return '/appointments'
  if (factType === 'vital_candidate' || factType === 'condition_candidate' || factType === 'allergy_candidate'
    || factType === 'procedure_candidate') return '/health-records'
  return '/medical-documents'
}

function priority(item) {
  if (item.attention_level === 'source_flagged') return 4
  if (item.attention_level === 'follow_up') return 3
  if (item.review_status === 'confirmed') return 2
  return 1
}

function isSyntheticTestFact(fact) {
  const explanation = fact?.plain_language_explanation ?? {}
  return explanation.simple_title_en?.startsWith('Synthetic test:')
    || explanation.simple_title?.startsWith('Synthetic test:')
    || explanation.short_summary_en?.startsWith('Synthetic test fixture only.')
    || explanation.plain_language_explanation_en?.startsWith('Synthetic software test content, not a real patient result.')
    || explanation.uncertainty_note_en?.startsWith('Synthetic software test content, not a real patient result.')
}

export function createDocumentHealthIntelligenceService(client = supabase) {
  const service = {
    async getOverviewForPatient(patientId) {
      if (!client || typeof patientId !== 'string' || !patientId) throw unavailable()
      const scan = async (table, columns, configure) => {
        const rows = []
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await configure(client.from(table).select(columns).eq('patient_id', patientId))
            .order('id').range(offset, offset + 499)
          if (error || !Array.isArray(data)) throw unavailable()
          rows.push(...data.filter(row => row.patient_id === patientId))
          if (data.length < 500) return rows
        }
      }
      const [display, facts, runs] = await Promise.all([
        service.getForPatient(patientId),
        scan('document_extracted_facts','id,patient_id,clinical_document_id,created_at',q=>q.eq('review_status','needs_review')),
        scan('document_extractions','id,patient_id,clinical_document_id,extraction_status',q=>q.in('extraction_status',['pending','processing','failed'])),
      ])
      const ids = [...new Set([...facts,...runs].map(row=>row.clinical_document_id))]
      const activeIds = new Set()
      for (let offset=0; offset<ids.length; offset+=500) {
        const {data,error}=await client.from('clinical_documents').select('id,patient_id,status,source')
          .eq('patient_id',patientId).eq('status','active').eq('source','patient_upload').in('id',ids.slice(offset,offset+500))
        if(error || !Array.isArray(data)) throw unavailable()
        for(const row of data) if(row.patient_id===patientId && row.status==='active' && row.source==='patient_upload') activeIds.add(row.id)
      }
      const pendingFacts=[...new Map(facts.filter(row=>activeIds.has(row.clinical_document_id)).map(row=>[row.id,row])).values()]
      const activeRuns=runs.filter(row=>activeIds.has(row.clinical_document_id))
      return { ...display, pending_review_count:pendingFacts.length,
        pending_review_items:pendingFacts.map(row=>({fact_id:row.id,source_document_id:row.clinical_document_id,review_created_at:row.created_at,review_status:'needs_review'})),
        extraction_pending:Boolean(display.explanation_pending) || activeRuns.some(row=>['pending','processing'].includes(row.extraction_status)),
        extraction_failed:activeRuns.some(row=>row.extraction_status==='failed'), document_review_status:'not_defined' }
    },
    async getForPatient(patientId, { limit = 50, factTypes } = {}) {
      if (!client || typeof patientId !== 'string' || !patientId || !Number.isInteger(limit) || limit < 1 || limit > 50
        || (factTypes !== undefined && (!Array.isArray(factTypes) || !factTypes.length || factTypes.some(type => typeof type !== 'string')))) throw unavailable()
      let factQuery = client.from('document_extracted_facts')
        .select(FACT_COLUMNS).eq('patient_id', patientId).in('review_status', ['needs_review', 'confirmed'])
      if (factTypes) factQuery = factQuery.in('fact_type', factTypes)
      const { data: facts, error: factError } = await factQuery
        .order('created_at', { ascending: false }).limit(50)
      if (factError || !Array.isArray(facts)) throw unavailable()
      const activeFacts = facts.filter(fact => fact.review_status !== 'rejected' && !isSyntheticTestFact(fact))
      if (!activeFacts.length) {
        const { data: runs, error: runError } = await client.from('document_extractions')
          .select('id,clinical_document_id,extraction_status').eq('patient_id', patientId)
          .in('extraction_status', ['pending', 'processing', 'failed']).limit(10)
        if (runError || !Array.isArray(runs)) throw unavailable()
        return {
          status: 'ready', items: [], total_count: 0,
          extraction_pending: runs.some(run => ['pending', 'processing'].includes(run.extraction_status)),
          extraction_failed: runs.some(run => run.extraction_status === 'failed'),
        }
      }

      const documentIds = [...new Set(activeFacts.map(fact => fact.clinical_document_id))]
      const { data: documents, error: documentError } = await client.from('clinical_documents')
        .select('id,title,document_type,document_date,status,source')
        .in('id', documentIds).eq('status', 'active').eq('source', 'patient_upload')
      if (documentError || !Array.isArray(documents)) throw unavailable()
      const documentById = new Map(documents.filter(document=>document.status==='active' && document.source==='patient_upload').map(document => [document.id, document]))
      const items = []
      let hasPendingExplanation = false
      let hasUnavailableSource = false
      for (const fact of activeFacts) {
        const document = documentById.get(fact.clinical_document_id)
        if (!document) { hasUnavailableSource = true; continue }
        const explanation = fact.plain_language_explanation
        if (!explanation) { hasPendingExplanation = true; continue }
        const bilingual = Object.hasOwn(explanation, 'simple_title_en')
        const contract = bilingual ? Object.fromEntries(BILINGUAL_FACT_EXPLANATION_FIELDS.map(key => [key, explanation[key]])) : {
          simple_title: explanation.simple_title, short_summary: explanation.short_summary,
          plain_language_explanation: explanation.plain_language_explanation,
          why_it_may_matter: explanation.why_it_may_matter, review_message: explanation.review_message,
          uncertainty_note: explanation.uncertainty_note,
        }
        if (Object.values(contract).some(value=>typeof value!=='string') || !validateDocumentFactExplanation(contract, fact) || !matchesStoredProvenance(explanation, fact)) continue
        const titleEn = bilingual ? explanation.simple_title_en : explanation.simple_title
        const titleMy = bilingual ? explanation.simple_title_my : null
        const summaryEn = bilingual ? explanation.short_summary_en : explanation.short_summary
        const summaryMy = bilingual ? explanation.short_summary_my : null
        const plainEn = bilingual ? explanation.plain_language_explanation_en : explanation.plain_language_explanation
        const plainMy = bilingual ? explanation.plain_language_explanation_my : null
        const whyEn = bilingual ? explanation.why_it_may_matter_en : explanation.why_it_may_matter
        const whyMy = bilingual ? explanation.why_it_may_matter_my : null
        const reviewEn = bilingual ? explanation.review_message_en : explanation.review_message
        const reviewMy = bilingual ? explanation.review_message_my : null
        const uncertaintyEn = bilingual ? explanation.uncertainty_note_en : explanation.uncertainty_note
        const uncertaintyMy = bilingual ? explanation.uncertainty_note_my : null
        items.push({
          fact_id: fact.id, fact_type: fact.fact_type, card_type: cardType(fact.fact_type), name: fact.name,
          value_text: fact.value_text, value_numeric: fact.value_numeric, unit: fact.unit,
          reference_range_text: fact.reference_range_text, observed_at: fact.observed_at,
          observed_at_time: fact.observed_at_time, strength_text: fact.strength_text,
          form_text: fact.form_text, frequency_text: fact.frequency_text,
          instruction_text: fact.instruction_text, source_context: fact.source_context,
          simple_title: titleEn, simple_title_en: titleEn, simple_title_my: titleMy,
          short_summary: summaryEn, short_summary_en: summaryEn, short_summary_my: summaryMy,
          plain_language_explanation: plainEn, plain_language_explanation_en: plainEn, plain_language_explanation_my: plainMy,
          why_it_may_matter: whyEn, why_it_may_matter_en: whyEn, why_it_may_matter_my: whyMy,
          review_message: reviewEn, review_message_en: reviewEn, review_message_my: reviewMy,
          uncertainty_note: uncertaintyEn, uncertainty_note_en: uncertaintyEn, uncertainty_note_my: uncertaintyMy,
          translation_status: bilingual ? explanation.translation_status : 'english_only',
          source_date: document.document_date || fact.created_at,
          review_created_at: fact.created_at,
          confidence_band: fact.confidence_band, review_status: fact.review_status,
          source_document_id: document.id, source_document_title: document.title || 'Medical document',
          source_page: fact.source_page ?? null, source_section: fact.source_section ?? null,
          attention_level: fact.abnormal_flag === true ? 'source_flagged'
            : fact.fact_type === 'follow_up_candidate' ? 'follow_up'
              : fact.review_status === 'needs_review' ? 'review_needed' : 'reviewed',
          related_tab_destination: `${relatedTabForFactType(fact.fact_type)}?factId=${encodeURIComponent(fact.id)}&sourceDocumentId=${encodeURIComponent(document.id)}`,
          source_reference: explanation.source_reference,
          sort_date: fact.review_status === 'confirmed' && fact.reviewed_at ? fact.reviewed_at : fact.created_at,
        })
      }
      items.sort((a, b) => priority(b) - priority(a) || (Date.parse(b.sort_date) || 0) - (Date.parse(a.sort_date) || 0))
      const totalCount = items.length
      return {
        status: items.length === 0 && hasUnavailableSource ? 'unavailable' : 'ready',
        items: items.slice(0, limit).map(({ sort_date, ...item }) => item),
        total_count: totalCount, extraction_pending: hasPendingExplanation, explanation_pending: hasPendingExplanation, source_unavailable: hasUnavailableSource,
      }
    },
  }
  return service
}

export const documentHealthIntelligenceService = createDocumentHealthIntelligenceService()
