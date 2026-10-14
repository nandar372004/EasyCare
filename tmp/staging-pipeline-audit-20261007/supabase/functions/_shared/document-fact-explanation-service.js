import {
  BILINGUAL_FACT_EXPLANATION_PAIRS,
  createDocumentFactExplanationContract,
  createTemplateDocumentFactExplanationAdapter,
  createEnglishOnlyFactExplanation,
  validateDocumentFactExplanation,
  CONFIRMED_REVIEW_MESSAGE_MY,
} from './document-fact-explanation-contract.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fail = code => { throw new Error(code) }

function attachReviewState(generated, fact) {
  if (!generated || typeof generated !== 'object' || !Object.hasOwn(generated, 'simple_title_en')) return generated
  const needsReview = fact.review_status === 'needs_review'
  const reviewMessageEn = needsReview
    ? 'AI extracted this from your document. Please review it.'
    : 'Patient reviewed. This is not clinician confirmation.'
  const reviewMessageMy = needsReview
    ? 'ဒီအချက်အလက်ကို AI က သင့် document ထဲကနေ ထုတ်ယူထားတာပါ။ ကျေးဇူးပြုပြီး ပြန်လည်စစ်ဆေးပါ။'
    : CONFIRMED_REVIEW_MESSAGE_MY
  const bilingual = { ...generated, review_message_en: reviewMessageEn, review_message_my: reviewMessageMy, translation_status: 'complete' }
  if (validateDocumentFactExplanation(bilingual, fact)) return bilingual
  const englishOnly = { ...bilingual, translation_status: 'english_only' }
  for (const [, myanmarKey] of BILINGUAL_FACT_EXPLANATION_PAIRS) englishOnly[myanmarKey] = null
  return validateDocumentFactExplanation(englishOnly, fact) ? englishOnly : bilingual
}

/** Server boundary. Reads with the caller's RLS client and persists only through the service-only RPC. */
export function createDocumentFactExplanationService({ userClient, serviceClient, explanationAdapter = createTemplateDocumentFactExplanationAdapter() } = {}) {
  return {
    async explainMyFact(factId) {
      if (!UUID_PATTERN.test(factId ?? '') || !userClient?.auth?.getUser || !serviceClient?.rpc
        || typeof explanationAdapter?.explain !== 'function') fail('EXPLANATION_UNAVAILABLE')
      const { data: auth, error: authError } = await userClient.auth.getUser()
      const callerId = auth?.user?.id
      if (authError || !UUID_PATTERN.test(callerId ?? '')) fail('UNAUTHORIZED')

      const { data: fact, error: factError } = await userClient.from('document_extracted_facts')
        .select('id,extraction_id,clinical_document_id,patient_id,fact_type,name,value_text,value_numeric,unit,reference_range_text,abnormal_flag,source_page,source_section,source_excerpt,confidence,confidence_band,review_status')
        .eq('id', factId).maybeSingle()
      if (factError || !fact || fact.review_status === 'rejected') fail('FACT_UNAVAILABLE')
      const { data: document, error: documentError } = await userClient.from('clinical_documents')
        .select('id,status,source,title,document_date')
        .eq('id', fact.clinical_document_id).maybeSingle()
      if (documentError || !document || document.id !== fact.clinical_document_id
        || document.status !== 'active' || document.source !== 'patient_upload') fail('FACT_UNAVAILABLE')
      const { data: run, error: runError } = await userClient.from('document_extractions')
        .select('id,clinical_document_id,patient_id,requested_by_profile_id,model_provider,model_name,model_version')
        .eq('id', fact.extraction_id).maybeSingle()
      if (runError || !run || run.id !== fact.extraction_id || run.clinical_document_id !== document.id
        || run.patient_id !== fact.patient_id || run.requested_by_profile_id !== callerId) fail('FACT_UNAVAILABLE')

      let generated
      try { generated = await explanationAdapter.explain({ ...fact, document, extraction: run }) }
      catch { generated = createEnglishOnlyFactExplanation(fact) }
      generated = attachReviewState(generated, fact)
      if (!validateDocumentFactExplanation(generated, fact)) {
        const english = generated && Object.hasOwn(generated, 'simple_title_en') ? {
          simple_title: generated.simple_title_en, short_summary: generated.short_summary_en,
          plain_language_explanation: generated.plain_language_explanation_en,
          why_it_may_matter: generated.why_it_may_matter_en,
          review_message: generated.review_message_en, uncertainty_note: generated.uncertainty_note_en,
        } : null
        if (!english || !validateDocumentFactExplanation(english, fact)) fail('INVALID_FACT_EXPLANATION')
        generated = attachReviewState(createEnglishOnlyFactExplanation(fact), fact)
      }
      if (!validateDocumentFactExplanation(generated, fact)) fail('INVALID_FACT_EXPLANATION')
      const { data: saved, error: saveError } = await serviceClient.rpc('save_my_document_fact_explanation', {
        p_fact_id: fact.id,
        p_owner_profile_id: callerId,
        p_explanation_fields: generated,
      })
      if (saveError || !saved || saved.fact_id !== fact.id || !saved.explanation
        || saved.explanation.source_reference?.fact_id !== fact.id
        || saved.explanation.source_reference?.extraction_id !== fact.extraction_id
        || saved.explanation.source_reference?.source_document_id !== fact.clinical_document_id
        || saved.explanation.source_reference?.review_state !== fact.review_status) fail('EXPLANATION_UNAVAILABLE')
      return createDocumentFactExplanationContract(generated, fact)
    },
  }
}
