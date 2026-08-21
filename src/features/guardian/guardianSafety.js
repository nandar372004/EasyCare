import { z } from 'zod'

export const GUARDIAN_MAX_INPUT_LENGTH = 1200
export const GUARDIAN_DISCLAIMER_KEY = 'guardian.general_not_diagnosis'

export const guardianInputSchema = z.object({
  message: z.string().trim().min(2).max(GUARDIAN_MAX_INPUT_LENGTH),
  language: z.enum(['en', 'my']),
  patientContext: z.object({
    ageGroup: z.enum(['child', 'adult', 'elderly']).default('adult'),
    pregnant: z.boolean().default(false),
  }).default({ ageGroup: 'adult', pregnant: false }),
}).strict()

export const guardianResponseSchema = z.object({
  riskLevel: z.enum(['routine', 'soon', 'urgent', 'emergency']),
  summary: z.string().min(1).max(500),
  guidance: z.array(z.string().min(1).max(500)).min(1).max(6),
  recommendedSpecialty: z.string().min(1).max(120).nullable(),
  redFlags: z.array(z.string().min(1).max(120)).max(12),
  disclaimerKey: z.string().min(1).max(120),
  actions: z.array(z.enum(['book_appointment', 'call_emergency', 'seek_urgent_care'])).min(1),
  sourceMode: z.enum(['deterministic', 'model', 'fallback']),
  requiresHumanReview: z.boolean(),
}).strict().superRefine((response, context) => {
  if (response.riskLevel === 'emergency' && !response.actions.includes('call_emergency')) {
    context.addIssue({ code: 'custom', path: ['actions'], message: 'Emergency responses require call_emergency.' })
  }
})

const phrases = {
  emergency: [
    ['chest_pain', ['chest pain', 'pressure in my chest', 'ရင်ဘတ်အောင့်', 'ရင်ဘတ်နာ']],
    ['difficulty_breathing', ['difficulty breathing', 'cannot breathe', "can't breathe", 'shortness of breath', 'အသက်ရှူမဝ', 'အသက်ရှူခက်']],
    ['stroke_signs', ['face drooping', 'slurred speech', 'speech is slurred', 'one side weak', 'stroke', 'မျက်နှာရွဲ့', 'စကားမပီ', 'ကိုယ်တစ်ခြမ်းအားနည်း']],
    ['severe_bleeding', ['severe bleeding', 'bleeding will not stop', 'သွေးထွက်များ', 'သွေးမတိတ်']],
    ['loss_of_consciousness', ['unconscious', 'loss of consciousness', 'not waking up', 'သတိလစ်', 'သတိမရ']],
    ['severe_allergic_reaction', ['severe allergic reaction', 'throat swelling', 'tongue swelling', 'anaphylaxis', 'လည်ချောင်းဖောင်း', 'လျှာဖောင်း']],
    ['self_harm', ['suicide', 'kill myself', 'hurt myself', 'self harm', 'ကိုယ့်ကိုယ်ကို သတ်', 'ကိုယ့်ကိုယ်ကို နာကျင်']],
  ],
  urgent: [
    ['severe_pain', ['severe pain', 'unbearable pain', 'အလွန်နာကျင်']],
    ['persistent_vomiting', ['persistent vomiting', 'cannot keep fluids down', 'အန်တာမရပ်']],
  ],
  soon: [
    ['fever', ['fever', 'high temperature', 'ဖျား', 'ကိုယ်ပူ']],
  ],
  routine: [
    ['mild_headache', ['mild headache', 'slight headache', 'ခေါင်းနည်းနည်းကိုက်']],
    ['tiredness', ['tired', 'fatigue', 'မောပန်း', 'ပင်ပန်း']],
  ],
}

const medicationTerms = ['dose', 'dosage', 'increase my medicine', 'reduce my medicine', 'stop taking', 'how many tablets', 'ဆေးပမာဏ', 'ဆေးဘယ်လောက်', 'ဆေးတိုး', 'ဆေးလျှော့']
const diagnosisTerms = ['diagnose me', 'what disease', 'do i have', 'tell me my diagnosis', 'ဘာရောဂါ', 'ရောဂါရှာပေး']
const injectionTerms = ['ignore previous', 'ignore all instructions', 'system prompt', 'developer message', 'act as a doctor', 'role-play as a doctor', 'pretend you are a doctor', 'reveal your rules']

function matchCategory(message, category) {
  return phrases[category].filter(([, terms]) => terms.some((term) => message.includes(term))).map(([flag]) => flag)
}

function containsAny(message, terms) {
  return terms.some((term) => message.includes(term))
}

function containsUnsafeClinicalClaim(result) {
  const text = `${result.summary} ${result.guidance.join(' ')}`.toLowerCase()
  return /\b(you have|diagnosed with|i diagnose|take \d+|double (the|your) dose|stop (taking|your medication)|increase (the|your) dose|decrease (the|your) dose)\b/.test(text)
}

function response(values) {
  return guardianResponseSchema.parse({ disclaimerKey: GUARDIAN_DISCLAIMER_KEY, ...values })
}

export function createSafeFallback(reason = 'The assistant could not safely evaluate this request.') {
  return response({
    riskLevel: 'soon',
    summary: reason,
    guidance: ['Arrange a clinician review. If severe or emergency warning signs are present, call emergency services now.'],
    recommendedSpecialty: 'General Medicine',
    redFlags: [],
    actions: ['book_appointment', 'call_emergency'],
    sourceMode: 'fallback',
    requiresHumanReview: true,
  })
}

export function screenGuardianInput(input) {
  const parsed = guardianInputSchema.safeParse(input)
  if (!parsed.success) return createSafeFallback('The information provided could not be safely assessed.')

  const { message, patientContext } = parsed.data
  const normalized = message.toLocaleLowerCase(parsed.data.language === 'my' ? 'my' : 'en')
  const emergencyFlags = matchCategory(normalized, 'emergency')
  if (emergencyFlags.length) {
    return response({
      riskLevel: 'emergency',
      summary: 'Emergency warning signs were identified. This is not a diagnosis.',
      guidance: ['Call local emergency services now.', 'Do not wait for a routine appointment.', 'If safe, ask someone nearby to stay with you.'],
      recommendedSpecialty: null,
      redFlags: emergencyFlags,
      actions: ['call_emergency'],
      sourceMode: 'deterministic',
      requiresHumanReview: true,
    })
  }

  if (containsAny(normalized, medicationTerms)) {
    return response({
      riskLevel: 'soon',
      summary: 'Medication doses cannot be prescribed or changed by the AI Guardian.',
      guidance: ['Keep taking medicine only as already directed unless a qualified clinician advises otherwise.', 'Contact a clinician or pharmacist for medication-specific advice.'],
      recommendedSpecialty: 'General Medicine',
      redFlags: ['medication_dose_request'],
      actions: ['book_appointment'],
      sourceMode: 'deterministic',
      requiresHumanReview: true,
    })
  }

  if (containsAny(normalized, diagnosisTerms) || containsAny(normalized, injectionTerms)) {
    return response({
      riskLevel: 'soon',
      summary: 'The AI Guardian cannot diagnose, adopt a clinician role, or override its safety rules.',
      guidance: ['A qualified clinician can assess symptoms and provide a diagnosis.', 'Use the booking action for professional assessment.'],
      recommendedSpecialty: 'General Medicine',
      redFlags: containsAny(normalized, injectionTerms) ? ['instruction_override_attempt'] : ['diagnosis_request'],
      actions: ['book_appointment'],
      sourceMode: 'deterministic',
      requiresHumanReview: true,
    })
  }

  const urgentFlags = matchCategory(normalized, 'urgent')
  const soonFlags = matchCategory(normalized, 'soon')
  const routineFlags = matchCategory(normalized, 'routine')
  const isVulnerable = patientContext.pregnant || patientContext.ageGroup !== 'adult'

  if (urgentFlags.length || (isVulnerable && soonFlags.length)) {
    return response({
      riskLevel: 'urgent',
      summary: 'Prompt in-person clinical assessment is recommended. This is not a diagnosis.',
      guidance: ['Seek urgent clinical care.', 'Call emergency services if symptoms become severe or an emergency warning sign appears.'],
      recommendedSpecialty: 'General Medicine',
      redFlags: [...urgentFlags, ...soonFlags, ...(isVulnerable ? ['vulnerable_patient_context'] : [])],
      actions: ['seek_urgent_care', 'call_emergency'],
      sourceMode: 'deterministic',
      requiresHumanReview: true,
    })
  }

  if (soonFlags.length || (isVulnerable && routineFlags.length)) {
    return response({
      riskLevel: 'soon',
      summary: 'A clinician review should be arranged soon. This is not a diagnosis.',
      guidance: ['Book a clinician for assessment.', 'Seek urgent care if symptoms worsen.'],
      recommendedSpecialty: 'General Medicine',
      redFlags: [...soonFlags, ...(isVulnerable ? ['vulnerable_patient_context'] : [])],
      actions: ['book_appointment'],
      sourceMode: 'deterministic',
      requiresHumanReview: isVulnerable,
    })
  }

  if (routineFlags.length) {
    return response({
      riskLevel: 'routine',
      summary: 'No configured urgent warning sign was identified. This is not a diagnosis.',
      guidance: ['Rest, stay hydrated when appropriate, and note changes in symptoms.', 'Book a clinician if symptoms persist or concern you.'],
      recommendedSpecialty: 'General Medicine',
      redFlags: [],
      actions: ['book_appointment'],
      sourceMode: 'deterministic',
      requiresHumanReview: false,
    })
  }

  return createSafeFallback('The information is unclear or outside the deterministic safety rules.')
}

export function resolveGuardianResponse(input, modelResult) {
  const safetyResult = screenGuardianInput(input)
  if (safetyResult.riskLevel === 'emergency') return safetyResult
  if (modelResult === undefined) return safetyResult
  if (modelResult === null) return createSafeFallback('The assistant timed out and no generated response was used.')
  const parsedModel = guardianResponseSchema.safeParse(modelResult)
  if (!parsedModel.success) return createSafeFallback('The assistant response was invalid and was not shown.')
  if (containsUnsafeClinicalClaim(parsedModel.data)) return createSafeFallback('The assistant response crossed a clinical safety boundary and was not shown.')
  const riskRank = { routine: 0, soon: 1, urgent: 2, emergency: 3 }
  if (riskRank[parsedModel.data.riskLevel] < riskRank[safetyResult.riskLevel]) return safetyResult
  return parsedModel.data
}
