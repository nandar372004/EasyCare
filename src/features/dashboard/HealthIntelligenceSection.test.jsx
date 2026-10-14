import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { FamilyHealthIntelligenceSection } from './HealthIntelligenceSection.jsx'

const item = {
  fact_id: 'fact-1', simple_title: 'Recent result', short_summary: 'A source-recorded result.',
  why_it_may_matter: 'Review this with your healthcare professional.', review_message: 'AI extracted this from your document. Please review it.',
  uncertainty_note: 'Source-derived only.', confidence_band: 'low', review_status: 'needs_review', source_date: '2026-10-01',
  source_document_id: 'doc-1', source_document_title: 'Report', source_page: 1,
}
const section = data => ({ status: 'ready', data: { status: 'ready', items: [item], total_count: 1, ...data } })

describe('Family Health Intelligence section', () => {
  it('renders only supplied authorized data and invokes the existing source access callback', () => {
    const openSource = vi.fn()
    render(<MemoryRouter><FamilyHealthIntelligenceSection section={section()} person="Mother's health records" onOpenSource={openSource} /></MemoryRouter>)
    expect(screen.getByText('Recent result')).toBeInTheDocument()
    expect(screen.getByText('AI extracted — review needed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open source document' }))
    expect(openSource).toHaveBeenCalledWith(item)
  })

  it('shows a bounded no-access state when the section is unauthorized', () => {
    render(<MemoryRouter><FamilyHealthIntelligenceSection section={{ status: 'not_authorized', data: null }} person="Mother's health records" /></MemoryRouter>)
    expect(screen.getByText('Health information has not been shared with you.')).toBeInTheDocument()
    expect(screen.queryByText('Recent result')).not.toBeInTheDocument()
  })

  it('labels confirmed facts as patient reviewed rather than clinician confirmed', () => {
    const confirmed = { ...item, review_status: 'confirmed', review_message: 'This item was patient-reviewed and confirmed. This is not clinician confirmation.' }
    render(<MemoryRouter><FamilyHealthIntelligenceSection section={section({ items: [confirmed] })} person="Family health records" /></MemoryRouter>)
    expect(screen.getByText('Patient reviewed')).toBeInTheDocument()
    expect(screen.getByText(/not clinician confirmation/i)).toBeInTheDocument()
  })

  it('explains a failed extraction without presenting a broken empty dashboard', () => {
    render(<MemoryRouter><FamilyHealthIntelligenceSection section={{ status: 'ready', data: { status: 'ready', items: [], total_count: 0, extraction_failed: true } }} person="Family health records" /></MemoryRouter>)
    expect(screen.getByText(/couldn't prepare health intelligence/i)).toBeInTheDocument()
  })
})
