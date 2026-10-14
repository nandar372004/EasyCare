function report(callback, details) {
  try { callback?.(details) } catch { /* Diagnostics must not change provider behavior. */ }
}

function fallbackCall({ primaryCall, fallbackCall, stage, groqModel, onDiagnostic, onPrimarySuccess, onFallbackSuccess, shouldFallback = () => true }) {
  return async (...args) => {
    try {
      const result = await primaryCall(...args)
      onPrimarySuccess?.()
      report(onDiagnostic, { stage, event: 'final_provider_used', provider: 'gemini' })
      return result
    } catch (error) {
      if (error?.message !== 'PROVIDER_TEMPORARILY_UNAVAILABLE' || !shouldFallback(...args)) throw error
      report(onDiagnostic, { stage, event: 'fallback_provider_selected', provider: 'groq', model: groqModel })
      try {
        const result = await fallbackCall(...args)
        onFallbackSuccess?.()
        report(onDiagnostic, { stage, event: 'final_provider_used', provider: 'groq', model: groqModel })
        return result
      } catch (fallbackError) {
        const allowedCode = ['GROQ_UNSUPPORTED_PDF', 'GROQ_TEMPORARILY_UNAVAILABLE', 'GROQ_REQUEST_FAILED', 'GROQ_TIMEOUT', 'GROQ_INVALID_RESPONSE'].includes(fallbackError?.message)
          ? fallbackError.message : 'GROQ_FALLBACK_FAILED'
        report(onDiagnostic, { stage, event: 'provider_final_failure', provider: 'groq', model: groqModel, error_code: allowedCode })
        throw new Error('PROVIDER_TEMPORARILY_UNAVAILABLE')
      }
    }
  }
}

export function createGeminiGroqFallbackAdapters({ geminiModelAdapter, geminiTextExtractor, geminiExplanationAdapter,
  groqModelAdapter, groqTextExtractor, groqExplanationAdapter, groqModel, onDiagnostic } = {}) {
  let activeMetadata = { ...geminiModelAdapter.metadata }
  const rememberGemini = () => { activeMetadata = { ...geminiModelAdapter.metadata } }
  const rememberGroq = () => { activeMetadata = { ...groqModelAdapter.metadata } }
  return {
    modelAdapter: {
      get metadata() { return activeMetadata },
      classify: fallbackCall({ primaryCall: geminiModelAdapter.classify.bind(geminiModelAdapter), fallbackCall: groqModelAdapter.classify.bind(groqModelAdapter), stage: 'medical_document_classification', groqModel, onDiagnostic, onPrimarySuccess: rememberGemini, onFallbackSuccess: rememberGroq }),
      extract: fallbackCall({ primaryCall: geminiModelAdapter.extract.bind(geminiModelAdapter), fallbackCall: groqModelAdapter.extract.bind(groqModelAdapter), stage: 'medical_document_candidate_facts', groqModel, onDiagnostic, onPrimarySuccess: rememberGemini, onFallbackSuccess: rememberGroq }),
    },
    sourceTextExtractor: {
      extract: fallbackCall({ primaryCall: geminiTextExtractor.extract.bind(geminiTextExtractor), fallbackCall: groqTextExtractor.extract.bind(groqTextExtractor), stage: 'medical_document_transcription', groqModel, onDiagnostic,
        shouldFallback: ({ mimeType } = {}) => mimeType !== 'application/pdf' }),
    },
    explanationAdapter: {
      explain: fallbackCall({ primaryCall: geminiExplanationAdapter.explain.bind(geminiExplanationAdapter), fallbackCall: groqExplanationAdapter.explain.bind(groqExplanationAdapter), stage: 'bilingual_document_fact_explanation', groqModel, onDiagnostic }),
    },
  }
}
