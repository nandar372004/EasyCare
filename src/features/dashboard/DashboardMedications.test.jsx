import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { DashboardMedications } from './DashboardMedications.jsx'
import { summarizeCarePlanMedicationActions } from '../../services/carePlanMedicationService.js'
const id = '81000000-0000-4000-8000-000000000010'
const now = new Date('2026-10-12T05:00:00Z')
const view = (data, status = 'ready') => <MemoryRouter><DashboardMedications section={{ status, data }} summary={summarizeCarePlanMedicationActions(data, now)} /></MemoryRouter>
describe('Dashboard medication actions from My Care Plan', () => {
  it('shows separate daily occurrence completion, PRN and the My Care Plan link', () => {
    const medication = { id, name: 'Shared daily medication', dosage: '1 tablet', frequency: 'twice daily', schedules: [], todaySchedules: [] }
    const data = { medications: [medication, { ...medication, id: '81000000-0000-4000-8000-000000000011', name: 'Shared PRN', frequency: 'PRN' }], checkIns: [{ patientMedicationId: id, occurrenceIndex: 1, isPrn: false, status: 'taken' }], checkInsAvailable: true }
    render(view(data))
    expect(screen.getByText('1 of 2 required doses completed')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 doses done · View details')).toBeInTheDocument()
    const details = screen.getByText('1 of 2 doses done · View details').closest('details')
    expect(details.open).toBe(false)
    details.querySelector('summary').click()
    const doses = within(screen.getByRole('list', { name: "Today's doses for Shared daily medication" }))
    expect(doses.getByText('Dose 1')).toBeInTheDocument()
    expect(doses.getByText('Dose 2')).toBeInTheDocument()
    expect(doses.getByText('Done')).toBeInTheDocument()
    expect(doses.getByText('Not done')).toBeInTheDocument()
    expect(screen.getAllByText('As needed').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'View Medications' })).toHaveAttribute('href', '/my-care-plan#care-my-medications')
    expect(screen.queryByText(/08:00|20:00/)).not.toBeInTheDocument()
  })
  it('shows compact empty and failure states without the broader untracked list', () => {
    const page = render(view({ medications: [{ id: 'reported:r', name: 'Untracked broader record', frequency: 'daily', isPatientReported: true, todaySchedules: [] }], checkIns: [] }))
    expect(screen.getByText('No medication actions for today.')).toBeInTheDocument()
    expect(screen.queryByText('Untracked broader record')).not.toBeInTheDocument()
    page.rerender(view({}, 'error'))
    expect(screen.getByRole('alert')).toHaveTextContent('Medication summary is temporarily unavailable.')
  })
})
