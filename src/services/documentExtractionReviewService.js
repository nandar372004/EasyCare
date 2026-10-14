import { supabase } from '../lib/supabase.js'
import { getDocumentExtractionConfidenceBand } from '../../supabase/functions/_shared/document-extraction-contract.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FACT_COLUMNS = [
  'id', 'extraction_id', 'clinical_document_id', 'patient_id', 'fact_type', 'name',
  'value_text', 'value_numeric', 'unit', 'reference_range_text', 'observed_at', 'observed_at_time',
  'abnormal_flag', 'strength_text', 'form_text', 'frequency_text', 'instruction_text',
  'recommended_at', 'source_context', 'source_page', 'source_section', 'source_excerpt',
  'confidence', 'confidence_band', 'review_status', 'reviewed_by_profile_id', 'reviewed_at',
  'review_note', 'explanation', 'plain_language_explanation', 'created_at',
].join(',')

const unavailable = () => new Error('Candidate fact review is unavailable. Please try again later.')

export function createDocumentExtractionReviewService(client = supabase) {
  return {
    async listMyCandidateFacts({ limit = 50, status = 'needs_review' } = {}) {
      if (!client || !Number.isInteger(limit) || limit < 1 || limit > 100
        || !['needs_review', 'confirmed', 'rejected', 'reviewed'].includes(status)) throw unavailable()
      const { data, error } = await client.from('document_extracted_facts')
        .select(FACT_COLUMNS).eq('review_status', status)
        .order('created_at', { ascending: false }).limit(limit)
      if (error || !Array.isArray(data)) throw unavailable()
      return data.map(fact => ({ ...fact, confidence_band: fact.confidence_band ?? getDocumentExtractionConfidenceBand(Number(fact.confidence)) }))
    },

    async getMyFactProvenance(factId) {
      if (!client || !UUID_PATTERN.test(factId ?? '')) throw unavailable()
      const { data: fact, error } = await client.from('document_extracted_facts')
        .select('id,extraction_id,clinical_document_id,patient_id,source_page,source_section,source_excerpt,observed_at,observed_at_time,source_context')
        .eq('id', factId).maybeSingle()
      if (error || !fact) throw unavailable()
      const { data: document, error: documentError } = await client.from('clinical_documents')
        .select('id,title,document_type,document_date,status')
        .eq('id', fact.clinical_document_id).maybeSingle()
      if (documentError || !document) throw unavailable()
      const { data: run, error: runError } = await client.from('document_extractions')
        .select('id,document_type,model_provider,model_name,model_version,prompt_version,schema_version,created_at')
        .eq('id', fact.extraction_id).maybeSingle()
      if (runError || !run) throw unavailable()
      return { ...fact, document, extraction: run }
    },

    async reviewMyFact({ factId, decision, note = null } = {}) {
      if (!client || !UUID_PATTERN.test(factId ?? '') || !['confirmed', 'rejected'].includes(decision)
        || (note !== null && (typeof note !== 'string' || !note.trim() || note.trim().length > 1000))) throw unavailable()
      const { data, error } = await client.rpc('review_my_document_extracted_fact', {
        p_fact_id: factId,
        p_decision: decision,
        p_note: note?.trim() ?? null,
      })
      if (error || !data || data.fact_id !== factId || data.review_status !== decision
        || typeof data.reviewed_at !== 'string') throw unavailable()
      return data
    },
  }
}

export const documentExtractionReviewService = createDocumentExtractionReviewService()
