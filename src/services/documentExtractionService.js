import { supabase } from '../lib/supabase.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EXTRACTION_COLUMNS = [
  'id', 'clinical_document_id', 'patient_id', 'requested_by_profile_id',
  'extraction_status', 'document_type', 'summary', 'model_provider',
  'model_name', 'model_version', 'prompt_version', 'schema_version',
  'started_at', 'completed_at', 'failure_reason', 'created_at', 'updated_at',
].join(',')

function unavailable() {
  return new Error('Document extraction is unavailable. Please try again later.')
}

export function createDocumentExtractionService(client = supabase) {
  return {
    async requestForDocument(clinicalDocumentId) {
      if (!client || !UUID_PATTERN.test(clinicalDocumentId ?? '')) throw unavailable()
      const { data, error } = await client.rpc('request_my_document_extraction', {
        p_clinical_document_id: clinicalDocumentId,
      })
      if (error || typeof data !== 'string' || !UUID_PATTERN.test(data)) throw unavailable()
      return { id: data, extractionStatus: 'pending' }
    },

    async get(extractionId) {
      if (!client || !UUID_PATTERN.test(extractionId ?? '')) throw unavailable()
      const { data, error } = await client.from('document_extractions')
        .select(EXTRACTION_COLUMNS).eq('id', extractionId).maybeSingle()
      if (error) throw unavailable()
      return data
    },
  }
}

export const documentExtractionService = createDocumentExtractionService()
