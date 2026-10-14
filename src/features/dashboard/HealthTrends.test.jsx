import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { HealthTrends } from './HealthTrends.jsx'

const bp = { id: 'bp', title: 'Daily BP', measurementType: 'blood_pressure', measurementUnit: 'mmHg' }
const weight = { id: 'weight', title: 'Weight', measurementType: 'weight', measurementUnit: 'kg' }
const rows = [
  ...['2026-10-07', '2026-10-09', '2026-10-12', '2026-09-20'].map((localDate, index) => ({ id: `${index}`, monitoringPlanId: 'bp', status: 'done', localDate, completedAt: `${localDate}T02:00:00Z`, systolicValue: [124,128,125,140][index], diastolicValue: [79,82,80,90][index], measurementUnit: 'mmHg' })),
  { id: 'w', monitoringPlanId: 'weight', status: 'done', localDate: '2026-10-12', measurementValue: '58.5', measurementUnit: 'kg' },
  { id: 'w2', monitoringPlanId: 'weight', status: 'done', localDate: '2026-10-09', measurementValue: '58.9', measurementUnit: 'kg' },
]
const view = (plans = [weight,bp], checkIns = rows, status = 'ready', patientName = '') => <MemoryRouter><HealthTrends patientName={patientName} asOfDate="2026-10-12" monitoring={{ status, data: { plans, checkIns } }} /></MemoryRouter>
describe('shared monitoring health trends', () => {
  it('defaults to BP, separates averages, and switches periods using real readings', () => {
    const page = render(view())
    expect(screen.getByLabelText('Measurement')).toHaveValue('bp')
    expect(screen.getByText('125 / 80 mmHg')).toBeInTheDocument()
    expect(screen.getByText('125.67 / 80.33 mmHg')).toBeInTheDocument()
    expect(page.container.querySelectorAll('.patient-trend-chart circle')).toHaveLength(6)
    expect(page.container.querySelectorAll('.patient-trend-chart polyline')).toHaveLength(2)
    expect(screen.queryByText('2026-09-20')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '30' } })
    expect(screen.getByText('129.25 / 82.75 mmHg')).toBeInTheDocument()
    expect(screen.getByText('2026-09-20')).toBeInTheDocument()
    expect(page.container.querySelectorAll('.patient-trend-chart circle')).toHaveLength(8)
    expect(screen.getByRole('link', { name: 'View Monitoring' })).toHaveAttribute('href', '/my-care-plan')
  })
  it('switches to a single metric with recorded units and correct average', () => {
    const page = render(view())
    fireEvent.change(screen.getByLabelText('Measurement'), { target: { value: 'weight' } })
    expect(screen.getByText('58.5 kg')).toBeInTheDocument()
    expect(screen.getByText('58.7 kg')).toBeInTheDocument()
    expect(page.container.querySelectorAll('.patient-trend-chart circle')).toHaveLength(2)
  })
  it('defaults to the first compatible routine and excludes invalid measurements', () => {
    render(view([weight, { id: 'bad', title: 'Bad', measurementType: 'custom', measurementUnit: 'cm' }], [...rows, { monitoringPlanId: 'bad', status: 'done', localDate: '2026-10-12', measurementValue: 'text' }]))
    expect(screen.getByLabelText('Measurement')).toHaveValue('weight')
    expect(screen.queryByRole('option', { name: 'Bad' })).not.toBeInTheDocument()
  })
  it('shows a compact empty state', () => {
    render(view([], []))
    expect(screen.getByText('No monitoring measurements yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add a measurement in My Care Plan' })).toHaveAttribute('href', '/my-care-plan')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
  it('shows a latest value but no chart for one reading', () => {
    render(view([bp], [rows[2]]))
    expect(screen.getAllByText('125 / 80 mmHg')).toHaveLength(2)
    expect(screen.getByText(/One reading recorded/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
  it('shows Nandar Kyaw presentation placeholders while keeping all summaries based on the one real reading', () => {
    const actual = [{ id: 'actual', monitoringPlanId: 'bp', status: 'done', localDate: '2026-10-12', completedAt: '2026-10-12T02:00:00Z', systolicValue: 115, diastolicValue: 73, measurementUnit: 'mmHg' }]
    const page = render(view([bp], actual, 'ready', 'Nandar Kyaw'))
    expect(screen.getAllByText('115 / 73 mmHg')).toHaveLength(2)
    const summary = page.container.querySelector('[aria-label="Blood Pressure summary"]')
    expect(summary).toHaveTextContent('1')
    expect(screen.getByRole('img', { name: /Placeholder history is distinct from recorded/ })).toBeInTheDocument()
    expect(screen.getByText('Placeholder', { selector: '.patient-trend-legend span' })).toBeInTheDocument()
    expect(screen.getByText('Recorded', { selector: '.patient-trend-legend span' })).toBeInTheDocument()
    expect(screen.getByText('Recorded data begins')).toBeInTheDocument()
    expect(screen.getByText(/Recorded monitoring data begins Oct 12/)).toBeInTheDocument()
    expect(page.container.querySelectorAll('.patient-trend-chart circle')).toHaveLength(14)
    expect(page.container.querySelectorAll('table tbody tr')).toHaveLength(1)
    expect(page.container.querySelector('table')).toHaveTextContent('2026-10-12')
    expect(page.container.querySelector('table')).not.toHaveTextContent('2026-10-11')
  })
  it('prefers actual readings for dates in the placeholder window and does not apply presentation points to others', () => {
    const actualRows = [
      { id: 'actual-9', monitoringPlanId: 'bp', status: 'done', localDate: '2026-10-09', completedAt: '2026-10-09T02:00:00Z', systolicValue: 121, diastolicValue: 78, measurementUnit: 'mmHg' },
      { id: 'actual-12', monitoringPlanId: 'bp', status: 'done', localDate: '2026-10-12', completedAt: '2026-10-12T02:00:00Z', systolicValue: 115, diastolicValue: 73, measurementUnit: 'mmHg' },
    ]
    const page = render(view([bp], actualRows, 'ready', 'Nandar Kyaw'))
    expect(page.container.querySelectorAll('.patient-trend-chart circle')).toHaveLength(14)
    expect(page.container.querySelector('table tbody')).toHaveTextContent('2026-10-09')
    expect(page.container.querySelector('table tbody')).toHaveTextContent('121')
    page.rerender(view([bp], actualRows, 'ready', 'Another Patient'))
    expect(page.container.querySelector('.patient-trend-presentation-note')).toBeNull()
    expect(page.container.querySelectorAll('.patient-trend-chart circle')).toHaveLength(4)
    expect(page.container.querySelectorAll('table tbody tr')).toHaveLength(2)
  })
  it('isolates load and analysis failures', () => {
    const page = render(view([], [], 'error'))
    expect(screen.getByRole('alert')).toHaveTextContent('Health trends are temporarily unavailable.')
    page.rerender(view([bp], [null]))
    expect(screen.getByRole('alert')).toHaveTextContent('Health trends are temporarily unavailable.')
  })
  it('clears values when shared data is loading for another account', () => {
    const page = render(view())
    page.rerender(view([], [], 'loading'))
    expect(screen.queryByText('125 / 80 mmHg')).not.toBeInTheDocument()
    expect(screen.getByText('Loading health trends…')).toBeInTheDocument()
  })
})
