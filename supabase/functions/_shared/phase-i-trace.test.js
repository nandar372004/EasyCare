import { describe, expect, it } from 'vitest'
import { formatPhaseITrace } from './phase-i-trace.js'

describe('Staging Phase I provider trace formatting', () => {
  it('reports selected provider and model without retaining unapproved fields', () => {
    expect(formatPhaseITrace({
      event: 'model_configured', provider: 'gemini', model: 'gemini-3.6-flash',
      patient_id: 'private-patient', clinical_document_id: 'private-document',
    })).toBe('[PHASE_I_TRACE] provider_selected {"selected_provider":"gemini","configured_model":"gemini-3.6-flash"}')
  })

  it('formats HTTP errors with status, safe provider details, and response parse flags', () => {
    const line = formatPhaseITrace({
      event: 'provider_http_error', provider: 'gemini', model: 'gemini-3.6-flash', stage: 'classification',
      http_status: 429, error_code: 'RESOURCE_EXHAUSTED', error_message: 'Quota exceeded',
      response_body_exists: true, response_json_parsed: true, source_excerpt: 'must not be logged',
    })
    expect(line.startsWith('[PHASE_I_TRACE] provider_http_error ')).toBe(true)
    expect(JSON.parse(line.slice(line.indexOf('{')))).toMatchObject({
      stage: 'classification', provider: 'gemini', model: 'gemini-3.6-flash', status: 429,
      provider_error_code: 'RESOURCE_EXHAUSTED', sanitized_provider_error_message: 'Quota exceeded',
      response_body_present: true, response_json_parsed: true,
    })
    expect(line).not.toContain('must not be logged')
  })

  it('distinguishes request, response, parse, and network failure events', () => {
    const requestLine = formatPhaseITrace({ event: 'request_started', provider: 'openai', model: 'model' })
    expect(requestLine.startsWith('[PHASE_I_TRACE] request_sent ')).toBe(true)
    expect(JSON.parse(requestLine.slice(requestLine.indexOf('{')))).toMatchObject({
      request_sent: true, selected_provider: 'openai', configured_model: 'model',
      provider_http_status: null, provider_error_code: null, response_body_present: null, response_json_parsed: null,
    })
    const responseLine = formatPhaseITrace({ event: 'provider_response_received', http_status: 200, response_body_exists: true })
    expect(responseLine.startsWith('[PHASE_I_TRACE] provider_response_ok ')).toBe(true)
    expect(JSON.parse(responseLine.slice(responseLine.indexOf('{')))).toMatchObject({ provider_http_status: 200, response_body_present: true, response_json_parsed: true })
    expect(formatPhaseITrace({ event: 'provider_structured_json_parse_failed' }))
      .toContain('[PHASE_I_TRACE] structured_parse_failed')
    expect(formatPhaseITrace({ event: 'provider_transport_error' }))
      .toContain('[PHASE_I_TRACE] provider_fetch_error')
  })

  it('logs bounded provider retry metadata without payload data', () => {
    const line = formatPhaseITrace({ event: 'provider_retry', stage: 'transcription', provider: 'gemini', attempt: 2, max_attempts: 3, http_status: 503, delay_ms: 2000, source_excerpt: 'private' })
    expect(JSON.parse(line.slice(line.indexOf('{')))).toMatchObject({ stage: 'transcription', attempt: 2, max_attempts: 3, http_status: 503, delay_ms: 2000 })
    expect(line).not.toContain('private')
  })
})
