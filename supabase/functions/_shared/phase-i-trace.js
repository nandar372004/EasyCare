const EVENT_NAMES = Object.freeze({
  model_configured: 'provider_selected',
  request_started: 'request_sent',
  provider_transport_error: 'provider_fetch_error',
  provider_timeout: 'provider_fetch_error',
  provider_response_received: 'provider_response_ok',
  provider_structured_json_parse_failed: 'structured_parse_failed',
  provider_structured_output_parse_failed: 'structured_parse_failed',
  provider_malformed_response: 'provider_malformed_json',
  provider_final_failure: 'provider_final_failure',
  fallback_provider_selected: 'fallback_provider_selected',
  groq_request_sent: 'groq_request_sent',
  groq_response_ok: 'groq_response_ok',
  groq_http_error: 'groq_http_error',
  final_provider_used: 'final_provider_used',
})

const SAFE_FIELDS = Object.freeze([
  'stage', 'provider', 'model', 'provider_type', 'http_status', 'status',
  'error_code', 'error_message', 'response_body_exists', 'response_body_present',
  'response_json_parsed', 'request_sent', 'error_type', 'malformed_json',
  'parse_stage', 'mime_type', 'byte_length', 'operation',
  'attempt', 'max_attempts', 'delay_ms',
])

/** Converts known diagnostic metadata into a Staging-safe, PII-free trace line. */
export function formatPhaseITrace(details = {}) {
  const event = EVENT_NAMES[details.event] ?? details.event ?? 'diagnostic'
  const record = {}
  for (const key of SAFE_FIELDS) {
    if (Object.hasOwn(details, key)) record[key] = details[key]
  }
  if (details.event === 'model_configured') {
    record.provider = details.provider
    record.model = details.model
    record.selected_provider = details.provider
    record.configured_model = details.model
    delete record.provider
    delete record.model
  } else if (details.event === 'request_started') {
    record.request_sent = true
    record.provider_http_status = null
    record.provider_error_code = null
    record.sanitized_provider_error_message = null
    record.response_body_present = null
    record.response_json_parsed = null
    record.provider = details.provider
    record.model = details.model
    record.selected_provider = details.provider
    record.configured_model = details.model
    delete record.provider
    delete record.model
  } else if (details.event === 'provider_http_error') {
    record.status = details.http_status ?? null
    record.provider_http_status = details.http_status ?? null
    record.provider_error_code = details.error_code ?? null
    record.sanitized_provider_error_message = details.error_message ?? null
    record.response_body_present = details.response_body_exists === true
    record.response_json_parsed = details.response_json_parsed === true
    delete record.http_status
    delete record.error_code
    delete record.error_message
    delete record.response_body_exists
  } else if (details.event === 'provider_response_received') {
    record.status = details.http_status ?? null
    record.provider_http_status = details.http_status ?? null
    record.response_body_present = details.response_body_exists === true
    record.response_json_parsed = true
    delete record.http_status
    delete record.response_body_exists
  } else if (details.event === 'provider_transport_error' || details.event === 'provider_timeout') {
    record.error_type = details.event === 'provider_timeout' ? 'timeout' : 'network_or_fetch'
    record.request_sent = true
    record.provider_http_status = null
    record.provider_error_code = null
    record.sanitized_provider_error_message = null
    record.response_body_present = null
    record.response_json_parsed = null
  } else if (details.event === 'provider_structured_json_parse_failed' || details.event === 'provider_structured_output_parse_failed') {
    record.parse_stage = 'structured_output'
    record.provider_http_status = details.http_status ?? null
    record.provider_error_code = null
    record.sanitized_provider_error_message = null
    record.response_body_present = details.response_body_exists === true
    record.response_json_parsed = true
  } else if (details.event === 'provider_malformed_response') {
    record.provider_http_status = details.http_status ?? null
    record.provider_error_code = null
    record.sanitized_provider_error_message = null
    record.response_body_present = details.response_body_exists === true
    record.response_json_parsed = false
  }
  return `[PHASE_I_TRACE] ${event} ${JSON.stringify(record)}`
}
