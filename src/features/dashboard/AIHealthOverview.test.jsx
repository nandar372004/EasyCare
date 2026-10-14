import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AIHealthOverview } from './AIHealthOverview.jsx'
import { getAIHealthOverview } from '../../services/aiHealthOverviewService.js'
vi.mock('../../services/aiHealthOverviewService.js',()=>({getAIHealthOverview:vi.fn()}))
beforeEach(()=>vi.resetAllMocks())
describe('AI overview dashboard integration',()=>{
  it('shows a persisted summary, generation time and clinical disclaimer',async()=>{
    getAIHealthOverview.mockResolvedValue({summary:{overall_status:'model',summary_text:'Recorded overview',things_to_watch:['Recorded watch item'],recommended_actions:['Review records with your clinician.'],generated_at:'2026-09-29T10:00Z'}})
    const page=render(<AIHealthOverview patientId="patient" />)
    expect(await screen.findByText('Recorded overview')).toBeInTheDocument()
    expect(page.container.querySelector('time')).toHaveAttribute('datetime','2026-09-29T10:00Z')
    expect(screen.getByText(/not a diagnosis/)).toBeInTheDocument()
    expect(screen.getByText('Recorded watch item')).toBeInTheDocument()
    expect(screen.getByText('Overall Status: model')).toBeInTheDocument()
    page.rerender(<AIHealthOverview patientId="patient" />)
    expect(getAIHealthOverview).toHaveBeenCalledTimes(1)
  })
  it('shows safe fallback rather than fabricated normal health',async()=>{
    getAIHealthOverview.mockResolvedValue({summary:null,fallback:{summary:'Unavailable',guidance:['Arrange a clinician review.']}})
    render(<AIHealthOverview patientId="patient" />)
    expect(await screen.findByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/Generated/)).not.toBeInTheDocument()
  })
  it('ignores an old patient response after switching identity',async()=>{
    let finish
    getAIHealthOverview.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockResolvedValue({summary:null,fallback:{summary:'No overview',guidance:[]}})
    const page=render(<AIHealthOverview patientId="first" />)
    page.rerender(<AIHealthOverview patientId="second" />)
    await act(async()=>finish({summary:{summary_text:'PRIVATE OLD SUMMARY',recommended_actions:[],generated_at:'2026-09-29'}}))
    expect(screen.queryByText('PRIVATE OLD SUMMARY')).not.toBeInTheDocument()
  })
})
