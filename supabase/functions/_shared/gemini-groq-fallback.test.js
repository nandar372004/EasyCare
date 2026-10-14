import { describe, expect, it, vi } from 'vitest'
import { createGeminiGroqFallbackAdapters } from './gemini-groq-fallback.js'

function adapters({ classify, groqClassify, transcribe, groqTranscribe } = {}) {
  const events = []
  const geminiModelAdapter = {
    metadata: { provider: 'Google Gemini', name: 'gemini-3.6-flash', version: 'configured' },
    classify: classify ?? vi.fn(async () => ({ source: 'gemini' })),
    extract: vi.fn(async () => ({ source: 'gemini' })),
  }
  const groqModelAdapter = {
    metadata: { provider: 'Groq', name: 'qwen/qwen3.8-27b', version: 'configured' },
    classify: groqClassify ?? vi.fn(async () => ({ source: 'groq', review_required: true })),
    extract: vi.fn(async () => ({ source: 'groq' })),
  }
  const geminiTextExtractor = { extract: transcribe ?? vi.fn(async () => 'Gemini transcription') }
  const groqTextExtractor = { extract: groqTranscribe ?? vi.fn(async () => 'Groq transcription') }
  const result = createGeminiGroqFallbackAdapters({
    geminiModelAdapter,
    geminiTextExtractor,
    geminiExplanationAdapter: { explain: vi.fn(async () => ({ language: 'bilingual' })) },
    groqModelAdapter,
    groqTextExtractor,
    groqExplanationAdapter: { explain: vi.fn(async () => ({ language: 'bilingual' })) },
    groqModel: 'qwen/qwen3.8-27b', onDiagnostic: event => events.push(event),
  })
  return { ...result, events, geminiModelAdapter, groqModelAdapter, geminiTextExtractor, groqTextExtractor }
}

describe('Gemini primary with Groq fallback', () => {
  it('keeps Gemini primary and never calls Groq when Gemini succeeds', async () => {
    const f = adapters()
    await expect(f.modelAdapter.classify({})).resolves.toEqual({ source: 'gemini' })
    expect(f.groqModelAdapter.classify).not.toHaveBeenCalled()
    expect(f.modelAdapter.metadata.provider).toBe('Google Gemini')
    expect(f.events.at(-1)).toMatchObject({ event: 'final_provider_used', provider: 'gemini' })
  })

  it('does not fall back when Gemini internally recovers after transient retries', async () => {
    // The retrying Gemini client returns success to this wrapper after recovering.
    const primary = vi.fn(async () => ({ source: 'gemini-after-retry' }))
    const f = adapters({ classify: primary })
    await expect(f.modelAdapter.classify({})).resolves.toEqual({ source: 'gemini-after-retry' })
    expect(f.groqModelAdapter.classify).not.toHaveBeenCalled()
  })

  it('keeps PDF transcription on Gemini when it succeeds', async () => {
    const f = adapters()
    const bytes = new Uint8Array([37, 80, 68, 70, 45])
    await expect(f.sourceTextExtractor.extract({ bytes, mimeType: 'application/pdf' })).resolves.toBe('Gemini transcription')
    expect(f.geminiTextExtractor.extract).toHaveBeenCalledOnce()
    expect(f.groqTextExtractor.extract).not.toHaveBeenCalled()
  })

  it('returns Gemini temporary failure for PDF after retries without invoking Groq', async () => {
    const f = adapters({ transcribe: vi.fn().mockRejectedValue(new Error('PROVIDER_TEMPORARILY_UNAVAILABLE')) })
    await expect(f.sourceTextExtractor.extract({ bytes: new Uint8Array([37, 80, 68, 70, 45]), mimeType: 'application/pdf' }))
      .rejects.toThrow('PROVIDER_TEMPORARILY_UNAVAILABLE')
    expect(f.geminiTextExtractor.extract).toHaveBeenCalledOnce()
    expect(f.groqTextExtractor.extract).not.toHaveBeenCalled()
    expect(f.events.some(event => event.event === 'fallback_provider_selected')).toBe(false)
  })

  it.each(['image/jpeg', 'image/png'])('uses Groq for %s only when Gemini reports exhausted transient retries', async mimeType => {
    const f = adapters({ classify: vi.fn().mockRejectedValue(new Error('PROVIDER_TEMPORARILY_UNAVAILABLE')) })
    await expect(f.modelAdapter.classify({ mimeType })).resolves.toMatchObject({ source: 'groq' })
    expect(f.groqModelAdapter.classify).toHaveBeenCalledOnce()
    expect(f.modelAdapter.metadata).toMatchObject({ provider: 'Groq', name: 'qwen/qwen3.8-27b' })
    expect(f.events.map(event => event.event)).toEqual(['fallback_provider_selected', 'final_provider_used'])
  })

  it('does not fall back for non-transient Gemini errors', async () => {
    const f = adapters({ classify: vi.fn().mockRejectedValue(new Error('PROVIDER_REQUEST_FAILED')) })
    await expect(f.modelAdapter.classify({})).rejects.toThrow('PROVIDER_REQUEST_FAILED')
    expect(f.groqModelAdapter.classify).not.toHaveBeenCalled()
  })

  it('turns any failed fallback into the safe temporary provider failure', async () => {
    const f = adapters({
      classify: vi.fn().mockRejectedValue(new Error('PROVIDER_TEMPORARILY_UNAVAILABLE')),
      groqClassify: vi.fn().mockRejectedValue(new Error('GROQ_TEMPORARILY_UNAVAILABLE')),
    })
    await expect(f.modelAdapter.classify({})).rejects.toThrow('PROVIDER_TEMPORARILY_UNAVAILABLE')
    expect(f.events.at(-1)).toMatchObject({ event: 'provider_final_failure', provider: 'groq', error_code: 'GROQ_TEMPORARILY_UNAVAILABLE' })
  })
})
