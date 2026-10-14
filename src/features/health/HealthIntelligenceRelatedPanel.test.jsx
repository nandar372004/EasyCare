import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HealthIntelligenceRelatedPanel } from './HealthIntelligenceRelatedPanel.jsx'
import { documentExtractionReviewService } from '../../services/documentExtractionReviewService.js'
import { documentHealthIntelligenceService } from '../../services/documentHealthIntelligenceService.js'
import { medicalDocumentService } from '../../services/medicalDocumentService.js'
import { LocalizationProvider } from '../localization/LocalizationContext.jsx'

vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ patient: { id: 'patient-a' } }) }))
vi.mock('../../services/documentHealthIntelligenceService.js', () => ({ documentHealthIntelligenceService: { getForPatient: vi.fn() } }))
vi.mock('../../services/documentExtractionReviewService.js', () => ({ documentExtractionReviewService: { reviewMyFact: vi.fn() } }))
vi.mock('../../services/medicalDocumentService.js', () => ({ medicalDocumentService: { createSignedUrl: vi.fn() } }))

const item = {
  fact_id: 'fact-a', fact_type: 'lab_result', name: 'HbA1c', value_numeric: 6.4, unit: '%',
  reference_range_text: 'Source says 4.0–5.6%', simple_title: 'HbA1c result', short_summary: 'Recorded as 6.4%.',
  plain_language_explanation: 'This is a transcription from your uploaded report.', why_it_may_matter: 'Discuss the result with your care team.',
  confidence_band: 'high', review_status: 'needs_review', source_date: '2026-10-01', source_document_id: 'doc-a',
  source_document_title: 'Synthetic report', source_page: 2, source_section: 'Results', source_excerpt: 'HbA1c 6.4%',
  simple_title_my: 'HbA1c ဓာတ်ခွဲရလဒ်', short_summary_my: 'အစီရင်ခံစာတွင် မှတ်တမ်းတင်ထားသည်။',
  plain_language_explanation_my: 'တင်ထားသော အစီရင်ခံစာမှ ကူးယူဖော်ပြထားခြင်း ဖြစ်သည်။',
  why_it_may_matter_my: 'ကျန်းမာရေးစောင့်ရှောက်မှုအဖွဲ့နှင့် ဆွေးနွေးနိုင်ပါသည်။',
  review_message_my: 'ဒီအချက်အလက်ကို AI က သင့် document ထဲကနေ ထုတ်ယူထားတာပါ။ ကျေးဇူးပြုပြီး ပြန်လည်စစ်ဆေးပါ။',
  uncertainty_note_my: 'အရင်းအမြစ်တွင် ရလဒ်အတိုင်းအတာကို မဖော်ပြထားသဖြင့် အဓိပ္ပာယ်ဖွင့်ဆိုခြင်းမပြုပါ။',
}

describe('related health intelligence panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
    documentHealthIntelligenceService.getForPatient.mockResolvedValue({ status: 'ready', items: [item], total_count: 1 })
    medicalDocumentService.createSignedUrl.mockResolvedValue('https://signed.test')
    vi.spyOn(window, 'open').mockReturnValue({ opener: null, location: { replace: vi.fn() }, close: vi.fn() })
  })

  it('shows provenance, review status and extracted details without clinical-truth actions', async () => {
    render(<HealthIntelligenceRelatedPanel category="labs" title="Extracted Lab Results" />)
    expect(documentHealthIntelligenceService.getForPatient).toHaveBeenCalledWith('patient-a', { limit: 50, factTypes: ['lab_result'] })
    expect(await screen.findByText('6.4 %')).toBeInTheDocument()
    expect(screen.getByText(/Source reference range:/).parentElement).toHaveTextContent('Source says 4.0–5.6%')
    expect(screen.getByText('AI extracted — review needed')).toBeInTheDocument()
    expect(screen.getByText(/not a diagnosis, prescription, or clinician confirmation/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /diagnose|prescribe|add to record/i })).not.toBeInTheDocument()
  })

  it('only shows the fact type related to this tab and supports the existing patient review RPC', async () => {
    const other = { ...item, fact_id: 'fact-b', fact_type: 'medication_candidate', name: 'Medicine mention' }
    documentHealthIntelligenceService.getForPatient.mockResolvedValue({ status: 'ready', items: [item, other], total_count: 2 })
    documentExtractionReviewService.reviewMyFact.mockResolvedValue({ fact_id: item.fact_id, review_status: 'confirmed' })
    render(<HealthIntelligenceRelatedPanel category="labs" title="Extracted Lab Results" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' }))
    await waitFor(() => expect(documentExtractionReviewService.reviewMyFact).toHaveBeenCalledWith({ factId: 'fact-a', decision: 'confirmed' }))
    expect(screen.queryByText('Medicine mention')).not.toBeInTheDocument()
  })

  it('uses the private signed-document service for source access', async () => {
    render(<HealthIntelligenceRelatedPanel category="labs" title="Extracted Lab Results" />)
    fireEvent.click(await screen.findByRole('button', { name: 'View source' }))
    await waitFor(() => expect(medicalDocumentService.createSignedUrl).toHaveBeenCalledWith({ id: 'doc-a' }, 'patient-a'))
  })

  it('rejects a candidate through the review boundary and removes it from active intelligence', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    documentHealthIntelligenceService.getForPatient.mockResolvedValueOnce({ status: 'ready', items: [item], total_count: 1 })
      .mockResolvedValueOnce({ status: 'ready', items: [], total_count: 0 })
    documentExtractionReviewService.reviewMyFact.mockResolvedValue({ fact_id: item.fact_id, review_status: 'rejected' })
    render(<HealthIntelligenceRelatedPanel category="labs" title="Extracted Lab Results" />)
    await user.click(await screen.findByRole('button', { name: 'Not accurate' }))
    await waitFor(() => expect(documentExtractionReviewService.reviewMyFact).toHaveBeenCalledWith({ factId: 'fact-a', decision: 'rejected' }))
    expect(await screen.findByText('No matching extracted information is available.')).toBeInTheDocument()
  })

  it('focuses the matching candidate when opened from a dashboard link', async () => {
    window.history.replaceState({}, '', '/lab-results?factId=fact-a&sourceDocumentId=doc-a')
    render(<HealthIntelligenceRelatedPanel category="labs" title="Extracted Lab Results" />)
    const candidate = await screen.findByText('HbA1c result')
    expect(candidate.closest('li')).toHaveClass('is-focused')
  })

  it('switches candidate explanations between English, Myanmar, and both', async () => {
    sessionStorage.setItem('easycare-health-intelligence-language-mode', 'en')
    render(<LocalizationProvider><HealthIntelligenceRelatedPanel category="labs" title="Extracted Lab Results" /></LocalizationProvider>)
    expect(await screen.findByText('This is a transcription from your uploaded report.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'မြန်မာ' }))
    expect(await screen.findByText('တင်ထားသော အစီရင်ခံစာမှ ကူးယူဖော်ပြထားခြင်း ဖြစ်သည်။')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Both' }))
    expect(screen.getByText('This is a transcription from your uploaded report.')).toBeInTheDocument()
    expect(screen.getAllByText((_, node) => node?.textContent?.includes('တင်ထားသော အစီရင်ခံစာမှ ကူးယူဖော်ပြထားခြင်း ဖြစ်သည်။')).length).toBeGreaterThan(0)
  })

  it('distinguishes failed extraction from a clean empty state', async () => {
    documentHealthIntelligenceService.getForPatient.mockResolvedValue({ status: 'ready', items: [], total_count: 0, extraction_failed: true })
    render(<HealthIntelligenceRelatedPanel category="labs" title="Extracted Lab Results" />)
    expect(await screen.findByText(/couldn't prepare extracted information/i)).toBeInTheDocument()
  })
})
