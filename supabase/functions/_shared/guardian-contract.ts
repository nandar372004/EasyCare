import { z } from 'npm:zod@4.0.17'

export const GUARDIAN_MAX_INPUT_LENGTH = 1200
export const GUARDIAN_MAX_CONVERSATION_MESSAGES = 6
export const GUARDIAN_MAX_CONVERSATION_CHARS = 2400
export const GUARDIAN_DISCLAIMER_KEY = 'guardian.general_not_diagnosis'

const contextSchema = z.object({
  ageGroup: z.enum(['child', 'adult', 'elderly']).default('adult'),
  pregnant: z.boolean().default(false),
}).default({ ageGroup: 'adult', pregnant: false })

const conversationItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(500),
}).strict()

export const guardianGatewayInputSchema = z.object({
  message: z.string().trim().min(2).max(GUARDIAN_MAX_INPUT_LENGTH),
  language: z.enum(['en', 'my']),
  patientContext: contextSchema,
  conversation: z.array(conversationItemSchema).max(GUARDIAN_MAX_CONVERSATION_MESSAGES).default([]),
}).strict().superRefine((value, context) => {
  const total = value.conversation.reduce((sum, item) => sum + item.content.length, 0)
  if (total > GUARDIAN_MAX_CONVERSATION_CHARS) {
    context.addIssue({ code: 'custom', path: ['conversation'], message: 'Conversation is too large.' })
  }
})

export const guardianResponseSchema = z.object({
  riskLevel: z.enum(['routine', 'soon', 'urgent', 'emergency']),
  summary: z.string().min(1).max(500),
  guidance: z.array(z.string().min(1).max(500)).min(1).max(6),
  recommendedSpecialty: z.string().min(1).max(120).nullable(),
  redFlags: z.array(z.string().min(1).max(120)).max(12),
  disclaimerKey: z.literal(GUARDIAN_DISCLAIMER_KEY),
  actions: z.array(z.enum(['book_appointment', 'call_emergency', 'seek_urgent_care'])).min(1).max(3),
  sourceMode: z.enum(['deterministic', 'model', 'fallback']),
  requiresHumanReview: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.riskLevel === 'emergency' && !value.actions.includes('call_emergency')) {
    context.addIssue({ code: 'custom', path: ['actions'], message: 'Emergency response requires call_emergency.' })
  }
})

const emergencyPhrases: Array<[string, string[]]> = [
  ['chest_pain', ['chest pain', 'pressure in my chest', 'ရင်ဘတ်အောင့်', 'ရင်ဘတ်နာ']],
  ['difficulty_breathing', ['difficulty breathing', 'cannot breathe', "can't breathe", 'shortness of breath', 'အသက်ရှူမဝ', 'အသက်ရှူခက်']],
  ['stroke_signs', ['face drooping', 'slurred speech', 'speech is slurred', 'one side weak', 'stroke', 'မျက်နှာရွဲ့', 'စကားမပီ', 'ကိုယ်တစ်ခြမ်းအားနည်း']],
  ['severe_bleeding', ['severe bleeding', 'bleeding will not stop', 'သွေးထွက်များ', 'သွေးမတိတ်']],
  ['loss_of_consciousness', ['unconscious', 'loss of consciousness', 'not waking up', 'သတိလစ်', 'သတိမရ']],
  ['severe_allergic_reaction', ['severe allergic reaction', 'throat swelling', 'tongue swelling', 'anaphylaxis', 'လည်ချောင်းဖောင်း', 'လျှာဖောင်း']],
  ['self_harm', ['suicide', 'kill myself', 'hurt myself', 'self harm', 'ကိုယ့်ကိုယ်ကို သတ်', 'ကိုယ့်ကိုယ်ကို နာကျင်']],
]

const medicationTerms = ['dose', 'dosage', 'increase my medicine', 'reduce my medicine', 'stop taking', 'how many tablets', 'ဆေးပမာဏ', 'ဆေးဘယ်လောက်', 'ဆေးတိုး', 'ဆေးလျှော့']
const diagnosisTerms = ['diagnose me', 'what disease', 'do i have', 'tell me my diagnosis', 'ဘာရောဂါ', 'ရောဂါရှာပေး']
const injectionTerms = ['ignore previous', 'ignore all instructions', 'system prompt', 'developer message', 'act as a doctor', 'role-play as a doctor', 'pretend you are a doctor', 'reveal your rules']
const urgentTerms = ['severe pain', 'unbearable pain', 'persistent vomiting', 'cannot keep fluids down', 'အလွန်နာကျင်', 'အန်တာမရပ်']
const soonTerms = ['fever', 'high temperature', 'ဖျား', 'ကိုယ်ပူ']

function hasAny(value: string, terms: string[]) { return terms.some((term) => value.includes(term)) }
function makeResponse(value: Record<string, unknown>) {
  return guardianResponseSchema.parse({ disclaimerKey: GUARDIAN_DISCLAIMER_KEY, ...value })
}

export function createGuardianFallback(reason = 'The assistant could not safely evaluate this request.') {
  return makeResponse({
    riskLevel: 'soon', summary: reason,
    guidance: ['Arrange a clinician review. If emergency warning signs are present, call emergency services now.'],
    recommendedSpecialty: 'General Medicine', redFlags: [],
    actions: ['book_appointment', 'call_emergency'], sourceMode: 'fallback', requiresHumanReview: true,
  })
}

export function deterministicGuardianScreen(input: z.infer<typeof guardianGatewayInputSchema>) {
  const normalized = input.message.toLocaleLowerCase(input.language === 'my' ? 'my' : 'en')
  const emergencyFlags = emergencyPhrases.filter(([, terms]) => hasAny(normalized, terms)).map(([flag]) => flag)
  if (emergencyFlags.length) return makeResponse({
    riskLevel: 'emergency', summary: 'Emergency warning signs were identified. This is not a diagnosis.',
    guidance: ['Call local emergency services now.', 'Do not wait for a routine appointment.', 'If safe, ask someone nearby to stay with you.'],
    recommendedSpecialty: null, redFlags: emergencyFlags, actions: ['call_emergency'],
    sourceMode: 'deterministic', requiresHumanReview: true,
  })
  if (hasAny(normalized, medicationTerms)) return makeResponse({
    riskLevel: 'soon', summary: 'Medication doses cannot be prescribed or changed by the AI Guardian.',
    guidance: ['Continue only as already directed unless a qualified clinician advises otherwise.', 'Contact a clinician or pharmacist for medication advice.'],
    recommendedSpecialty: 'General Medicine', redFlags: ['medication_dose_request'], actions: ['book_appointment'],
    sourceMode: 'deterministic', requiresHumanReview: true,
  })
  if (hasAny(normalized, diagnosisTerms) || hasAny(normalized, injectionTerms)) return makeResponse({
    riskLevel: 'soon', summary: 'The AI Guardian cannot diagnose, adopt a clinician role, or override safety rules.',
    guidance: ['A qualified clinician can assess symptoms.', 'Use the booking action for professional assessment.'],
    recommendedSpecialty: 'General Medicine', redFlags: [hasAny(normalized, injectionTerms) ? 'instruction_override_attempt' : 'diagnosis_request'],
    actions: ['book_appointment'], sourceMode: 'deterministic', requiresHumanReview: true,
  })
  const vulnerable = input.patientContext.pregnant || input.patientContext.ageGroup !== 'adult'
  if (hasAny(normalized, urgentTerms) || (vulnerable && hasAny(normalized, soonTerms))) return makeResponse({
    riskLevel: 'urgent', summary: 'Prompt clinical assessment is recommended. This is not a diagnosis.',
    guidance: ['Seek urgent clinical care.', 'Call emergency services if emergency warning signs appear.'],
    recommendedSpecialty: 'General Medicine', redFlags: vulnerable ? ['vulnerable_patient_context'] : ['urgent_symptom'],
    actions: ['seek_urgent_care', 'call_emergency'], sourceMode: 'deterministic', requiresHumanReview: true,
  })
  if (hasAny(normalized, soonTerms)) return makeResponse({
    riskLevel: 'soon', summary: 'A clinician review should be arranged soon. This is not a diagnosis.',
    guidance: ['Book a clinician for assessment.', 'Seek urgent care if symptoms worsen.'],
    recommendedSpecialty: 'General Medicine', redFlags: ['fever'], actions: ['book_appointment'],
    sourceMode: 'deterministic', requiresHumanReview: false,
  })
  return null
}

export function redactGuardianText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(?:\+?95|0)\s*9(?:[\s-]*\d){7,9}/g, '[phone]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,36}\b/gi, '[identifier]')
    .trim()
}

export function hasUnsafeClinicalOutput(output: z.infer<typeof guardianResponseSchema>) {
  const text = `${output.summary} ${output.guidance.join(' ')}`.toLowerCase()
  return /\b(you have|diagnosed with|i diagnose|the diagnosis is|your condition is|this is definitely|certainly have|confirmed case|suffering from|i prescribe|you should take|take \d+|\d+\s*(mg|tablet|tablets|capsule|capsules)|start (taking|this medication)|double (the|your) dose|stop (taking|your medication)|increase (the|your) dose|decrease (the|your) dose)\b/.test(text)
}
