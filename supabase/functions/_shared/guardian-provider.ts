export type GuardianModelRequest = {
  systemPrompt: string
  userContent: string
  modelName: string
  signal: AbortSignal
}

export interface GuardianModelAdapter {
  generate(request: GuardianModelRequest): Promise<unknown>
}

type ProviderConfig = {
  apiKey: string
  modelName: string
  endpoint: string
  fetchImpl?: typeof fetch
}

export const guardianProviderResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    riskLevel: { type: 'string', enum: ['routine', 'soon', 'urgent', 'emergency'] },
    summary: { type: 'string' },
    guidance: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6 },
    recommendedSpecialty: { type: ['string', 'null'] },
    redFlags: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    disclaimerKey: { type: 'string', enum: ['guardian.general_not_diagnosis'] },
    actions: {
      type: 'array',
      items: { type: 'string', enum: ['book_appointment', 'call_emergency', 'seek_urgent_care'] },
      minItems: 1,
      maxItems: 3,
    },
    sourceMode: { type: 'string', enum: ['model'] },
    requiresHumanReview: { type: 'boolean' },
  },
  required: [
    'riskLevel', 'summary', 'guidance', 'recommendedSpecialty', 'redFlags',
    'disclaimerKey', 'actions', 'sourceMode', 'requiresHumanReview',
  ],
} as const

// This adapter uses a narrow OpenAI-compatible JSON interface. The gateway
// depends only on GuardianModelAdapter, so another approved provider can be
// substituted without changing authorization or safety policy code.
export function createOpenAICompatibleAdapter(config: ProviderConfig): GuardianModelAdapter {
  const fetchImpl = config.fetchImpl ?? fetch
  return {
    async generate({ systemPrompt, userContent, signal }) {
      const response = await fetchImpl(config.endpoint, {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.modelName,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'guardian_response',
              strict: true,
              schema: guardianProviderResponseSchema,
            },
          },
          max_tokens: 700,
          temperature: 0,
        }),
      })
      if (!response.ok) throw new Error('PROVIDER_FAILURE')
      const payload = await response.json()
      const content = payload?.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new Error('INVALID_PROVIDER_RESPONSE')
      try { return JSON.parse(content) } catch { throw new Error('INVALID_JSON') }
    },
  }
}
