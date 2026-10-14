import { createDocumentClassificationService } from './document-classification-service.js'
import { createDocumentHealthFactExtractionService } from './document-health-fact-extraction-service.js'
import { createDocumentFactExplanationService } from './document-fact-explanation-service.js'

/** Runs the existing Phase I services over an authenticated user client. */
export function createDocumentHealthPipeline({ userClient, serviceClient, sourceTextExtractor, modelAdapter, explanationAdapter, onDiagnostic }) {
  const classification = createDocumentClassificationService({ userClient, serviceClient, modelAdapter, onDiagnostic })
  const extraction = createDocumentHealthFactExtractionService({ userClient, serviceClient, sourceTextExtractor, modelAdapter })
  const explanation = createDocumentFactExplanationService({ userClient, serviceClient, explanationAdapter })
  return {
    async processDocument(documentId) {
      const classified = await classification.classifyForDocument(documentId)
      const extracted = await extraction.extractForDocument(documentId)
      const { data: facts, error } = await userClient.from('document_extracted_facts')
        .select('id,review_status').eq('extraction_id', extracted.extraction_id)
      if (error || !Array.isArray(facts)) throw new Error('EXTRACTION_UNAVAILABLE')
      for (const fact of facts) {
        if (fact.review_status !== 'needs_review') throw new Error('EXTRACTION_UNAVAILABLE')
        await explanation.explainMyFact(fact.id)
      }
      return {
        source_document_id: documentId, extraction_id: extracted.extraction_id,
        document_type: classified.document_type, candidate_count: facts.length,
        review_status: 'needs_review', explanation_count: facts.length,
      }
    },
  }
}
