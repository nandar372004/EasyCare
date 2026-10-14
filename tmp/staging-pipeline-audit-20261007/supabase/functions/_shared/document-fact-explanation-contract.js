export const DOCUMENT_FACT_EXPLANATION_FIELDS = Object.freeze([
  'simple_title', 'short_summary', 'plain_language_explanation',
  'why_it_may_matter', 'review_message', 'uncertainty_note',
])
export const BILINGUAL_FACT_EXPLANATION_PAIRS = Object.freeze([
  ['simple_title_en', 'simple_title_my', 120],
  ['short_summary_en', 'short_summary_my', 240],
  ['plain_language_explanation_en', 'plain_language_explanation_my', 1000],
  ['why_it_may_matter_en', 'why_it_may_matter_my', 400],
  ['review_message_en', 'review_message_my', 200],
  ['uncertainty_note_en', 'uncertainty_note_my', 400],
])
export const BILINGUAL_FACT_EXPLANATION_FIELDS = Object.freeze([
  ...BILINGUAL_FACT_EXPLANATION_PAIRS.flatMap(([english, myanmar]) => [english, myanmar]),
  'source_assertion', 'translation_status',
])
export const CONFIRMED_REVIEW_MESSAGE_MY = 'လူနာမှ ပြန်လည်စစ်ဆေးပြီးဖြစ်သည်။ ၎င်းသည် ဆရာဝန်မှ အတည်ပြုခြင်း မဟုတ်ပါ။'

const FACT_TYPES = new Set([
  'lab_result', 'medication_candidate', 'condition_candidate', 'allergy_candidate',
  'vital_candidate', 'procedure_candidate', 'follow_up_candidate', 'other',
])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hasExactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const safeText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
const hasMyanmarScript = value => typeof value === 'string' && /[\u1000-\u109f]/u.test(value)
const unsafeLanguage = /\b(?:you have\b|diagnosed with|this confirms you have|you should\b|start treatment|stop treatment|take (?:more|less)|change your (?:dose|medication)|increase your dose|decrease your dose|medical emergency|you are in danger|will (?:cause|develop|recover)|definitely|proves that)\b/i
const unsafeMyanmar = /(?:သင့်မှာ.{0,24}(?:ရောဂါရှိ|ဖြစ်နေပါ)|သင်(?:သည်)? .{0,24}ရောဂါရှိပါ|သေချာပေါက်.{0,24}ဖြစ်)/u
const sourceNegation = /\b(?:no evidence|no sign|no indication|negative for|not detected|not present|not seen|without|denies|absence of)\b|(?:မရှိ|မတွေ့ရှိ|မတွေ့ရ|မတွေ့|မပါ|မဟုတ်)/iu
const sourceUncertainty = /\b(?:possible|possibly|probable|probably|may|might|could|suggests?|cannot exclude|uncertain)\b|(?:ဖြစ်နိုင်|ဖြစ်ကောင်း|သံသယရှိ|မသေချာ)/iu
const assertionTypes = new Set(['affirmed', 'negated', 'uncertain', 'negated_uncertain', 'not_stated'])

export function inferSourceAssertion(sourceExcerpt) {
  const negated = sourceNegation.test(sourceExcerpt ?? '')
  const uncertain = sourceUncertainty.test(sourceExcerpt ?? '')
  if (negated && uncertain) return 'negated_uncertain'
  if (negated) return 'negated'
  if (uncertain) return 'uncertain'
  return 'affirmed'
}

function hasAssertionWording(text, assertion, language) {
  const negated = language === 'my' ? /(?:မရှိ|မတွေ့ရှိ|မတွေ့ရ|မတွေ့|မပါ|မဟုတ်)/u : /\b(?:no evidence|no sign|no indication|negative for|not detected|not present|not seen|without|denies|absence of)\b/i
  const uncertain = language === 'my' ? /(?:ဖြစ်နိုင်|ဖြစ်ကောင်း|သံသယရှိ|မသေချာ)/u : /\b(?:possible|possibly|probable|probably|may|might|could|suggests?|cannot exclude|uncertain)\b/i
  return (assertion === 'negated' || assertion === 'negated_uncertain' ? negated.test(text) : true)
    && (assertion === 'uncertain' || assertion === 'negated_uncertain' ? uncertain.test(text) : true)
}

function hasLegacyFields(value) {
  return hasExactKeys(value, DOCUMENT_FACT_EXPLANATION_FIELDS)
}

function validateEnglishExplanation(value, fact) {
  if (!hasLegacyFields(value)
    || DOCUMENT_FACT_EXPLANATION_FIELDS.filter(key => key !== 'review_message')
      .some(key => unsafeLanguage.test(value[key]))) return false
  if (!value.plain_language_explanation.toLocaleLowerCase('en').includes(fact.name.toLocaleLowerCase('en'))) return false
  if (fact.fact_type === 'lab_result' && fact.abnormal_flag === null && !fact.reference_range_text
    && /\b(?:high|low|abnormal|normal|elevated|reduced|above|below)\b/i.test(value.plain_language_explanation)) return false
  if (fact.review_status === 'needs_review' && !/AI extracted this from your document\. Please review it\./i.test(value.review_message)) return false
  if (fact.review_status === 'confirmed' && !/patient-reviewed and confirmed/i.test(value.review_message)) return false
  return true
}

function validateBilingualExplanation(value, fact) {
  if (!hasExactKeys(value, BILINGUAL_FACT_EXPLANATION_FIELDS)
    || !assertionTypes.has(value.source_assertion)
    || !['complete', 'english_only'].includes(value.translation_status)) return false
  const english = {}
  for (const [key, , max] of BILINGUAL_FACT_EXPLANATION_PAIRS) {
    if (!safeText(value[key], max)) return false
    english[key.replace(/_en$/, '')] = value[key]
  }
  if (!validateEnglishExplanation(english, fact)) return false
  const expectedAssertion = inferSourceAssertion(fact.source_excerpt)
  if (value.source_assertion !== expectedAssertion) return false
  if (fact.fact_type === 'condition_candidate'
    && !/(?:mentions|report states|report says|document states)/i.test(value.plain_language_explanation_en)) return false
  const myanmarValues = BILINGUAL_FACT_EXPLANATION_PAIRS.map(([, key]) => value[key])
  if (value.translation_status === 'english_only') {
    if (myanmarValues.some(item => item !== null)) return false
  } else if (myanmarValues.some((item, index) => !safeText(item, BILINGUAL_FACT_EXPLANATION_PAIRS[index][2]) || !hasMyanmarScript(item))) return false
  if (value.translation_status === 'complete') {
    const myExplanation = value.plain_language_explanation_my
    if (!hasAssertionWording(value.plain_language_explanation_en, value.source_assertion, 'en')
      || !hasAssertionWording(myExplanation, value.source_assertion, 'my')
      || unsafeMyanmar.test(myExplanation)) return false
    if (fact.fact_type === 'condition_candidate'
      && !/(?:ဖော်ပြ|ရေးသား|မှတ်တမ်းတင်)/u.test(myExplanation)) return false
    if (fact.fact_type === 'lab_result' && fact.abnormal_flag === null && !fact.reference_range_text
      && /(?:မြင့်|နိမ့်|ပုံမှန်|မူမမှန်|အလွန်များ|အလွန်နည်း)/u.test(myExplanation)) return false
  }
  if (fact.review_status === 'needs_review'
    && (value.review_message_en !== 'AI extracted this from your document. Please review it.'
      || (value.translation_status === 'complete' && value.review_message_my !== 'ဒီအချက်အလက်ကို AI က သင့် document ထဲကနေ ထုတ်ယူထားတာပါ။ ကျေးဇူးပြုပြီး ပြန်လည်စစ်ဆေးပါ။'))) return false
  if (fact.review_status === 'confirmed'
    && (value.review_message_en !== 'Patient reviewed. This is not clinician confirmation.'
      || (value.translation_status === 'complete' && value.review_message_my !== CONFIRMED_REVIEW_MESSAGE_MY))) return false
  if (value.translation_status === 'complete' && fact.fact_type === 'lab_result'
    && fact.abnormal_flag === null && !fact.reference_range_text
    && (!/does not provide.*(?:range|abnormal)|does not interpret/i.test(value.uncertainty_note_en)
      || !/(?:မဖော်ပြ|မပါရှိ).*(?:အဓိပ္ပာယ်ဖွင့်ဆိုခြင်းမပြု|မကောက်ချက်ချ)/u.test(value.uncertainty_note_my))) return false
  return true
}

export function validateDocumentFactExplanation(value, fact) {
  if (!fact || !UUID_PATTERN.test(fact.id ?? '') || !UUID_PATTERN.test(fact.extraction_id ?? '')
    || !UUID_PATTERN.test(fact.clinical_document_id ?? '') || !UUID_PATTERN.test(fact.patient_id ?? '')
    || !FACT_TYPES.has(fact.fact_type) || !safeText(fact.name, 200)
    || !safeText(fact.source_excerpt, 1_600) || fact.review_status === 'rejected'
    || !['needs_review', 'confirmed'].includes(fact.review_status)
    || typeof Number(fact.confidence) !== 'number' || !Number.isFinite(Number(fact.confidence))
    || Number(fact.confidence) < 0 || Number(fact.confidence) > 1
    || !['high', 'medium', 'low'].includes(fact.confidence_band)) return false
  if (hasLegacyFields(value)) return validateEnglishExplanation(value, fact)
  return validateBilingualExplanation(value, fact)
}

const displayValue = fact => [fact.value_text, fact.value_numeric, fact.unit].filter(value => value !== null && value !== undefined && value !== '').join(' ')
const reviewMessage = status => status === 'confirmed'
  ? 'This item was patient-reviewed and confirmed. This is not clinician confirmation.'
  : 'AI extracted this from your document. Please review it.'

/** Deterministic, source-aware default. An adapter can be injected in tests or future server deployments. */
export function createTemplateDocumentFactExplanationAdapter() {
  return {
    async explain(fact) {
      const value = displayValue(fact)
      const explicitRange = fact.reference_range_text
        ? ` The report lists the reference range as ${fact.reference_range_text}.`
        : ''
      const explicitFlag = fact.abnormal_flag === true
        ? ' The source explicitly marks this result as abnormal.'
        : fact.abnormal_flag === false ? ' The source does not mark this result as abnormal.' : ''
      const defaultUncertainty = fact.abnormal_flag === null && !fact.reference_range_text
        ? 'The source does not provide an abnormal flag or reference range, so this explanation does not interpret the value.'
        : 'This explanation describes what the source says; it does not determine what the result means for you.'
      const title = {
        lab_result: `Lab result: ${fact.name}`,
        medication_candidate: `Medication mention: ${fact.name}`,
        vital_candidate: `Vital reading: ${fact.name}`,
        condition_candidate: `Condition mention: ${fact.name}`,
        allergy_candidate: `Allergy mention: ${fact.name}`,
        procedure_candidate: `Procedure or imaging: ${fact.name}`,
        follow_up_candidate: `Follow-up note: ${fact.name}`,
        other: `Document note: ${fact.name}`,
      }[fact.fact_type]
      const text = {
        lab_result: `${fact.name}${value ? ` is recorded as ${value}` : ' is mentioned in the report'}.${explicitRange}${explicitFlag}`,
        medication_candidate: `The document mentions ${fact.name}${value ? ` (${value})` : ''}. This mention does not confirm that it was prescribed or should be taken.`,
        vital_candidate: `The document records ${fact.name}${value ? ` as ${value}` : ''}. This is a transcription of the source, not an interpretation.`,
        condition_candidate: `The document mentions ${fact.name}. This source mention is not a diagnosis confirmed here.`,
        allergy_candidate: `The document mentions ${fact.name} in relation to allergies. This report does not independently verify the allergy.`,
        procedure_candidate: `The document mentions ${fact.name}${value ? `: ${value}` : ''}. This summary does not add an interpretation to the source.`,
        follow_up_candidate: `The document includes a follow-up note about ${fact.name}${value ? `: ${value}` : ''}.`,
        other: `The document includes a note about ${fact.name}${value ? `: ${value}` : ''}.`,
      }[fact.fact_type]
      return {
        simple_title: title,
        short_summary: text.length > 240 ? `${text.slice(0, 237).trimEnd()}...` : text,
        plain_language_explanation: text,
        why_it_may_matter: 'This may be useful to review with your healthcare professional alongside the original document.',
        review_message: reviewMessage(fact.review_status),
        uncertainty_note: defaultUncertainty,
      }
    },
  }
}

export function createEnglishOnlyFactExplanation(fact) {
  const sourceAssertion = inferSourceAssertion(fact.source_excerpt)
  const value = [fact.value_text, fact.value_numeric, fact.unit]
    .filter(item => item !== null && item !== undefined && item !== '').join(' ')
  const plain = sourceAssertion === 'negated'
    ? `The source uses negative wording about ${fact.name}. Review the exact source excerpt; this is not a diagnosis.`
    : sourceAssertion === 'uncertain'
      ? `The source describes ${fact.name} as possible or uncertain, not as a confirmed diagnosis.`
      : sourceAssertion === 'negated_uncertain'
        ? `The source includes both negative and uncertain wording about ${fact.name}. Review the exact source excerpt.`
        : fact.fact_type === 'lab_result'
          ? `${fact.name} is recorded in the source${value ? ` as ${value}` : ''}. This is a transcription, not an interpretation.`
          : `The source mentions ${fact.name}. This is a document mention, not a diagnosis or treatment instruction.`
  const uncertainty = fact.fact_type === 'lab_result' && fact.abnormal_flag === null && !fact.reference_range_text
    ? 'The source does not provide an abnormal flag or reference range, so this explanation does not interpret the value.'
    : 'This explanation describes source wording only and does not determine what the fact means for you.'
  const needsReview = fact.review_status === 'needs_review'
  return {
    simple_title_en: `${fact.fact_type === 'lab_result' ? 'Lab result' : 'Document mention'}: ${fact.name}`.slice(0, 120),
    simple_title_my: null,
    short_summary_en: plain.slice(0, 240), short_summary_my: null,
    plain_language_explanation_en: plain.slice(0, 1000), plain_language_explanation_my: null,
    why_it_may_matter_en: 'Review this candidate with your healthcare professional alongside the original document.',
    why_it_may_matter_my: null,
    review_message_en: needsReview ? 'AI extracted this from your document. Please review it.' : 'Patient reviewed. This is not clinician confirmation.',
    review_message_my: null,
    uncertainty_note_en: uncertainty,
    uncertainty_note_my: null,
    source_assertion: sourceAssertion,
    translation_status: 'english_only',
  }
}

export function createDocumentFactExplanationContract(fields, fact) {
  if (!validateDocumentFactExplanation(fields, fact)) throw new Error('INVALID_FACT_EXPLANATION')
  return {
    ...fields,
    source_reference: {
      fact_id: fact.id,
      extraction_id: fact.extraction_id,
      source_document_id: fact.clinical_document_id,
      source_page: fact.source_page ?? null,
      source_section: fact.source_section ?? null,
      source_excerpt: fact.source_excerpt,
      confidence: Number(fact.confidence),
      confidence_band: fact.confidence_band,
      review_state: fact.review_status,
      information_origin: 'Source-derived explanation of an AI-extracted candidate; not clinician-confirmed.',
    },
  }
}
