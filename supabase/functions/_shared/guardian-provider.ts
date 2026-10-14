export type GuardianModelRequest = {
  systemPrompt: string
  userContent: string
  modelName: string
  signal: AbortSignal
}

export interface GuardianModelAdapter {
  generate(request: GuardianModelRequest): Promise<unknown>
  diagnostics?: () => GuardianProviderDiagnostics
}

export type GuardianProviderDiagnostics = {
  providerHost: string | null
  modelName: string
  httpStatus: number | null
  providerErrorCode: string | null
  providerErrorMessage: string | null
  responseBodyValidJson: boolean | null
  networkErrorType: string | null
  timeout: boolean
}

export class GuardianProviderError extends Error {
  constructor(message: string, readonly diagnostics: GuardianProviderDiagnostics) {
    super(message)
    this.name = 'GuardianProviderError'
  }
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

function safeModelName(value: string) {
  return /^[A-Za-z0-9._:/-]{1,120}$/.test(value) ? value : 'unrecognized'
}

function providerHost(endpoint: string) {
  try { return new URL(endpoint).hostname.slice(0, 253) || null } catch { return null }
}

function safeErrorCode(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const code = String(value)
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : null
}

function canonicalProviderMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.toLowerCase()
  if (/api.?key|auth|credential|permission|unauthorized|forbidden/.test(text)) return 'Provider rejected the configured credentials.'
  if (/model|endpoint|not found|does not exist/.test(text)) return 'Configured model or endpoint was not found.'
  if (/quota|rate.?limit|billing|capacity/.test(text)) return 'Provider quota or rate limit was reached.'
  if (/format|schema|invalid request|unsupported|parameter/.test(text)) return 'Provider rejected the request format.'
  if (/overload|temporar|unavailable|internal server|try again/.test(text)) return 'Provider reports temporary unavailability.'
  return null
}

function getProviderError(payload: unknown) {
  const error = (payload as { error?: unknown } | null)?.error
  if (typeof error === 'string') return { code: null, message: canonicalProviderMessage(error) }
  if (!error || typeof error !== 'object') return { code: null, message: null }
  const record = error as Record<string, unknown>
  return {
    code: safeErrorCode(record.code ?? record.type),
    message: canonicalProviderMessage(record.message),
  }
}

// This adapter uses a narrow OpenAI-compatible JSON interface. The gateway
// depends only on GuardianModelAdapter, so another approved provider can be
// substituted without changing authorization or safety policy code.
export function createOpenAICompatibleAdapter(config: ProviderConfig): GuardianModelAdapter {
  const fetchImpl = config.fetchImpl ?? fetch
  const baseDiagnostics = { providerHost: providerHost(config.endpoint), modelName: safeModelName(config.modelName) }
  let lastDiagnostics: GuardianProviderDiagnostics = {
    ...baseDiagnostics, httpStatus: null, providerErrorCode: null, providerErrorMessage: null,
    responseBodyValidJson: null, networkErrorType: null, timeout: false,
  }
  const failure = (overrides: Partial<GuardianProviderDiagnostics>, message: string) =>
    new GuardianProviderError(message, lastDiagnostics = {
      ...baseDiagnostics, httpStatus: null, providerErrorCode: null, providerErrorMessage: null,
      responseBodyValidJson: null, networkErrorType: null, timeout: false, ...overrides,
    })
  return {
    diagnostics: () => lastDiagnostics,
    async generate({ systemPrompt, userContent, signal }) {
      let response: Response
      try {
        response = await fetchImpl(config.endpoint, {
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
      } catch (error) {
        const errorName = error instanceof Error ? error.name : ''
        const networkErrorType = ['TypeError', 'AbortError', 'DOMException', 'Error'].includes(errorName) ? errorName : 'unknown'
        throw failure({ networkErrorType }, 'PROVIDER_NETWORK_FAILURE')
      }

      let rawBody = ''
      try { rawBody = await response.text() } catch {
        throw failure({ httpStatus: response.status, networkErrorType: 'body_read_failure' }, 'PROVIDER_NETWORK_FAILURE')
      }
      let payload: unknown
      let bodyValidJson = false
      try { payload = JSON.parse(rawBody); bodyValidJson = true } catch { /* body content is never retained or logged */ }
      lastDiagnostics = {
        ...baseDiagnostics, httpStatus: response.status, providerErrorCode: null, providerErrorMessage: null,
        responseBodyValidJson: bodyValidJson, networkErrorType: null, timeout: false,
      }
      if (!response.ok) {
        const providerError = bodyValidJson ? getProviderError(payload) : { code: null, message: null }
        throw failure({
          httpStatus: response.status,
          providerErrorCode: providerError.code,
          providerErrorMessage: providerError.message,
          responseBodyValidJson: bodyValidJson,
        }, 'PROVIDER_FAILURE')
      }
      if (!bodyValidJson) throw failure({ httpStatus: response.status, responseBodyValidJson: false, providerErrorCode: 'invalid_response_json', providerErrorMessage: 'Provider response was not valid JSON.' }, 'INVALID_PROVIDER_RESPONSE')
      const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw failure({ httpStatus: response.status, responseBodyValidJson: true, providerErrorCode: 'missing_message_content', providerErrorMessage: 'Provider response lacked message content.' }, 'INVALID_PROVIDER_RESPONSE')
      try { return JSON.parse(content) } catch {
        throw failure({ httpStatus: response.status, responseBodyValidJson: true, providerErrorCode: 'invalid_model_json', providerErrorMessage: 'Provider response content was not valid JSON.' }, 'INVALID_JSON')
      }
    },
  }
}
