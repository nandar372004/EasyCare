import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HealthRecordsPage, LabResultsPage, MedicationsPage, PrescriptionsPage } from './HealthPages.jsx'
import { presentationRepository } from '../../services/repositories/index.js'

const reportedApi = vi.hoisted(() => ({ get: vi.fn() }))
const documentApi = vi.hoisted(() => ({ listMine: vi.fn() }))
const monitoringApi = vi.hoisted(() => ({ plans: vi.fn(), checkIns: vi.fn(), summaries: vi.fn() }))
vi.mock('../../services/documentHealthIntelligenceService.js', () => ({ documentHealthIntelligenceService: { getForPatient: vi.fn().mockResolvedValue({ status: 'ready', items: [], total_count: 0, extraction_pending: false }) } }))
vi.mock('../../services/documentExtractionReviewService.js', () => ({ documentExtractionReviewService: { reviewMyFact: vi.fn() } }))
vi.mock('../../services/medicalDocumentService.js', () => ({ medicalDocumentService: { createSignedUrl: vi.fn(), listMine: (...args) => documentApi.listMine(...args) } }))
vi.mock('../../services/patientReportedHealthService.js', () => ({ getMyReportedHealthIntake: (...args) => reportedApi.get(...args) }))
vi.mock('../../services/patientMonitoringService.js', () => ({
  patientMonitoringService: { listMyPlans: (...args) => monitoringApi.plans(...args), listMyCheckIns: (...args) => monitoringApi.checkIns(...args) },
  buildMonitoringWeeklySummaries: (...args) => monitoringApi.summaries(...args),
}))

vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ patient: { id: '51000000-0000-4000-8000-000000000001' }, user: { id: 'auth-user-1' }, status: 'authenticated' }) }))
vi.mock('../../services/repositories/index.js', () => ({ presentationRepository: { metadata: { isSynthetic: true }, getPatientHealthRecordSources: vi.fn(), listPrescriptions: vi.fn().mockResolvedValue([]), listMedications: vi.fn().mockResolvedValue([
  { id: 'med-1', name: 'Demo Paracetamol', dosage: '500 mg', frequency: 'Twice daily', instructions: 'Synthetic record', status: 'active', startDate: '2026-07-01', schedules: [] },
  { id: 'med-2', name: 'Demo Vitamin B Complex', dosage: '1 tablet', frequency: 'Once daily', instructions: 'Synthetic record', status: 'completed', schedules: [] },
]) } }))

describe('read-only health presentation pages', () => {
  beforeEach(() => {
    presentationRepository.metadata.isSynthetic = true
    presentationRepository.listPrescriptions.mockReset().mockResolvedValue([])
    presentationRepository.listMedications.mockClear()
    presentationRepository.getPatientHealthRecordSources.mockReset()
    reportedApi.get.mockReset().mockResolvedValue({ items: [] })
    documentApi.listMine.mockReset().mockResolvedValue([])
    monitoringApi.plans.mockReset().mockResolvedValue([])
    monitoringApi.checkIns.mockReset().mockResolvedValue([])
    monitoringApi.summaries.mockReset().mockReturnValue([])
  })

  it('loads patient-scoped prescription details from the existing read service without adding actions', async () => {
    presentationRepository.metadata.isSynthetic = false
    presentationRepository.listPrescriptions.mockResolvedValue([{
      id: 'rx-real-1', itemId: 'rx-item-1', medicine: 'Recorded medicine', strength: '10 mg', dosage: '1 tablet',
      frequency: 'Once daily', duration: '5 days', instructions: 'Recorded directions', doctor: 'Dr. Recorded', status: 'active', issuedAt: '2026-08-01T00:00:00Z',
    }])
    render(<PrescriptionsPage />)
    expect(await screen.findByText('Recorded medicine')).toBeInTheDocument()
    expect(presentationRepository.listPrescriptions).toHaveBeenCalledWith('51000000-0000-4000-8000-000000000001')
    expect(screen.queryByRole('button', { name: /Download Prescription/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'View Details' })[0])
    expect(screen.getByRole('dialog', { name: 'Recorded medicine' })).toHaveTextContent('Recorded directions')
  })

  it('shows the prescription empty state for a successful empty read', async () => {
    presentationRepository.metadata.isSynthetic = false
    presentationRepository.listPrescriptions.mockResolvedValue([])
    render(<PrescriptionsPage />)
    expect(await screen.findByText('No prescriptions in this section')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows only profile-reported records and keeps details read-only without provenance labels', async () => {
    reportedApi.get.mockResolvedValue({ items: [
      { id: 'allergy-1', itemType: 'allergy', entryKind: 'item', name: 'Pollen Allergy', details: { reaction: 'Sneezing', allergenType: 'Seasonal' }, source: 'patient_reported', verificationStatus: 'unverified' },
      { id: 'condition-1', itemType: 'condition', entryKind: 'item', name: 'Migraine', details: { context: 'Recurring headaches' }, source: 'patient_reported' },
      { id: 'vax-1', itemType: 'vaccination', entryKind: 'item', name: 'Flu vaccine', details: { doseNumber: 'Dose 1', dateGiven: '2026-10-11', location: 'Clinic A', notes: 'Annual dose' }, source: 'patient_reported' },
    ] })
    documentApi.listMine.mockResolvedValue([{ id: 'doc-1', title: 'Lab report', document_type: 'lab_result', document_date: '2026-02-01' }])
    render(<HealthRecordsPage />)
    expect(await screen.findByText('Pollen Allergy')).toBeInTheDocument()
    expect(screen.getByText('Migraine')).toBeInTheDocument()
    expect(screen.getByText('Flu vaccine')).toBeInTheDocument()
    expect(screen.getByText('Lab report')).toBeInTheDocument()
    expect(presentationRepository.getPatientHealthRecordSources).not.toHaveBeenCalled()
    expect(screen.queryByText(/Patient-reported|Health record|Clinical|Demo|Synthetic|Sample/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit in Profile Settings' })).not.toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Filter health records' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'View Details' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Pollen Allergy' })
    expect(dialog).toHaveTextContent('Sneezing')
    expect(dialog).toHaveTextContent('Seasonal')
    expect(dialog).not.toHaveTextContent(/source|review status|edit in profile/i)
  })

  it('shows Health Records monitoring summaries from monitoring check-ins without creating record rows', async () => {
    monitoringApi.plans.mockResolvedValue([{ id: 'plan-1', title: 'Blood Pressure' }])
    monitoringApi.checkIns.mockResolvedValue([{ id: 'checkin-1' }])
    monitoringApi.summaries.mockReturnValue([{
      planId: 'plan-1', title: 'Blood Pressure', measurementType: 'blood_pressure', measurementUnit: 'mmHg',
      weekStart: '2026-10-06', weekEnd: '2026-10-12', readingCount: 3, completedOccurrences: 3, scheduledOccurrences: 3,
      average7Days: { systolic: 126, diastolic: 80, unit: 'mmHg' },
      latest: { localDate: '2026-10-12', systolicValue: 124, diastolicValue: 79 },
      readings: [{ id: 'checkin-1', localDate: '2026-10-12', systolicValue: 124, diastolicValue: 79, measurementUnit: 'mmHg' }],
    }])
    const { container } = render(<HealthRecordsPage />)
    expect(await screen.findByRole('heading', { name: 'Monitoring' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Blood Pressure' })).toBeInTheDocument()
    expect(container.querySelector('.health-monitoring-summary')?.textContent).toContain('Average: 126 / 80 mmHg')
    expect(container.querySelector('.health-monitoring-summary')?.textContent).toContain('Latest: 124 / 79 mmHg')
    expect(monitoringApi.summaries).toHaveBeenCalledWith(expect.objectContaining({ plans: [{ id: 'plan-1', title: 'Blood Pressure' }], checkIns: [{ id: 'checkin-1' }] }))
  })

  it('removes the unsupported prescription download and keeps details available', () => {
    render(<PrescriptionsPage />)
    expect(screen.queryByRole('button', { name: /Download Prescription/ })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Active Prescriptions' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'View Details' }))
    const dialog = screen.getByRole('dialog', { name: 'Demo Medication Alpha 500mg' })
    expect(within(dialog).getByRole('heading', { name: 'About This Medicine' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('No additional medicine guidance has been recorded.')
    expect(dialog).not.toHaveTextContent(/side effects|contraindications|warning/i)
  })

  it('switches between active and past prescriptions with keyboard accessible tabs', () => {
    render(<PrescriptionsPage />)
    const active = screen.getByRole('tab', { name: 'Active Prescriptions' })
    active.focus()
    fireEvent.keyDown(active, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Past Prescriptions' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Demo Antihistamine 10mg')).toBeInTheDocument()
    expect(screen.queryByText('Demo Medication Alpha 500mg')).not.toBeInTheDocument()
  })

  it('states that lab results require clinician interpretation', () => {
    render(<LabResultsPage />)
    expect(screen.getByText(/Lab results require interpretation by a qualified clinician/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'View Details' })[0])
    expect(screen.getByRole('dialog')).toHaveTextContent('cannot be used for medical decisions')
  })

  it('hides complete synthetic medication records instead of showing their details', async () => {
    render(<MedicationsPage />, { wrapper: MemoryRouter })
    expect(await screen.findByText('No medications found')).toBeInTheDocument()
    expect(screen.queryByText('Demo Paracetamol')).not.toBeInTheDocument()
    expect(screen.queryByText('500 mg')).not.toBeInTheDocument()
    expect(screen.queryByText('Synthetic record')).not.toBeInTheDocument()
    expect(screen.queryByText('Medication Mentions from Documents')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Taken|Pending/ })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Active Medications' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Medication History' }))
    expect(screen.queryByText('Demo Vitamin B Complex')).not.toBeInTheDocument()
    expect(presentationRepository.listMedications).toHaveBeenCalledWith('51000000-0000-4000-8000-000000000001')
  })

  it('hides synthetic medication rows while preserving real prescription medications', async () => {
    presentationRepository.metadata.isSynthetic = false
    presentationRepository.listMedications.mockResolvedValue([
      { id: 'syn-cetirizine', name: 'Cetirizine', dosage: '10 mg', frequency: 'Once daily', instructions: 'Synthetic record: take in the evening', status: 'active' },
      { id: 'syn-paracetamol', name: 'Paracetamol demo course', dosage: '500 mg', frequency: 'Every 8 hours', instructions: 'Synthetic: sample course', status: 'active' },
      { id: 'real-paracetamol', name: 'Paracetamol', dosage: '500 mg', frequency: 'Every 8 hours as needed for pain', instructions: 'Take as needed for pain.', status: 'active' },
      { id: 'real-diclofenac', name: 'Diclofenac Gel', dosage: 'Thin layer', frequency: '3 times daily', instructions: 'Apply to neck area.', status: 'active' },
      { id: 'real-vitamin', name: 'Vitamin B Complex', dosage: '1 tablet', frequency: 'Once daily', instructions: 'Take after food.', status: 'active' },
    ])
    render(<MedicationsPage />, { wrapper: MemoryRouter })
    expect(await screen.findByRole('heading', { name: 'Paracetamol' })).toBeInTheDocument()
    for (const name of ['Diclofenac Gel', 'Vitamin B Complex']) expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    expect(screen.queryByText('Cetirizine')).not.toBeInTheDocument()
    expect(screen.queryByText('Paracetamol demo course')).not.toBeInTheDocument()
    expect(screen.queryByText(/Synthetic record|Synthetic:/)).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Details' }).find(button => button.closest('article')?.textContent.includes('Paracetamol')))
    expect(screen.getByRole('dialog', { name: 'Paracetamol' })).toHaveTextContent('Take as needed for pain.')
  })

  it('shows active patient-reported medications with provenance and a profile link', async () => {
    presentationRepository.metadata.isSynthetic = false
    presentationRepository.listMedications.mockResolvedValue([])
    reportedApi.get.mockResolvedValue({ items: [{ id: 'report-med-1', itemType: 'medication', entryKind: 'item', name: 'Reported inhaler', details: { dose: '2 puffs', frequency: 'As needed', reason: 'Breathing symptoms' }, source: 'patient_reported' }] })
    render(<MedicationsPage />, { wrapper: MemoryRouter })
    expect(await screen.findByRole('heading', { name: 'Reported inhaler' })).toBeInTheDocument()
    expect(screen.getByText('Patient-reported')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit in Profile Settings' })).toHaveAttribute('href', '/settings')
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Breathing symptoms')
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Prescribed by')
  })

  it('hides clinical rows and counts only visible profile records while retaining documents', async () => {
    presentationRepository.metadata.isSynthetic = false
    presentationRepository.getPatientHealthRecordSources.mockResolvedValue({
      allergies: [{ id: 'allergy-1', allergen: 'Pollen', reaction: 'Sneezing', severity: 'mild' }],
      conditions: [{ id: 'condition-1', conditionName: 'Asthma', status: 'active' }],
      vaccinations: [{ id: 'vax-1', title: 'Flu vaccine', occurredOn: '2026-03-02', details: 'Recorded dose' }],
    })
    reportedApi.get.mockResolvedValue({ bloodType: 'O+', items: [
      { id: 'reported-allergy-1', itemType: 'allergy', entryKind: 'item', name: 'Pollen', details: { reaction: 'Itchy eyes' }, source: 'patient_reported', verificationStatus: 'unverified' },
      { id: 'reported-condition-1', itemType: 'condition', entryKind: 'item', name: 'Migraine', details: { context: 'Patient reported' }, source: 'patient_reported' },
    ] })
    documentApi.listMine.mockResolvedValue([{ id: 'doc-1', title: 'Lab report', document_type: 'lab_result', document_date: '2026-02-01', source: 'patient_upload' }])
    render(<HealthRecordsPage />, { wrapper: MemoryRouter })
    expect(await screen.findByText('Pollen')).toBeInTheDocument()
    expect(screen.queryByText('Asthma')).not.toBeInTheDocument()
    expect(screen.getByText('Migraine')).toBeInTheDocument()
    expect(screen.queryByText('Flu vaccine')).not.toBeInTheDocument()
    expect(screen.getByText('Lab report')).toBeInTheDocument()
    expect(screen.queryByText('O+')).not.toBeInTheDocument()
    expect(screen.getAllByText('Pollen')).toHaveLength(1)
    expect(presentationRepository.getPatientHealthRecordSources).not.toHaveBeenCalled()
    expect(documentApi.listMine).toHaveBeenCalledWith('auth-user-1')
    const allergyCount = screen.getAllByText('Allergies')[0].closest('article')
    expect(within(allergyCount).getByText('1')).toBeInTheDocument()
  })

  it('shows only profile vaccinations in their filter and counts each visible record', async () => {
    presentationRepository.metadata.isSynthetic = false
    presentationRepository.getPatientHealthRecordSources.mockResolvedValue({
      allergies: [], conditions: [], vaccinations: [{ id: 'clinical-vax-1', title: 'Influenza vaccine', occurredOn: '2026-10-01', details: 'Recorded in medical history' }],
    })
    reportedApi.get.mockResolvedValue({ items: [{ id: 'reported-vax-1', itemType: 'vaccination', entryKind: 'item', name: 'Influenza vaccine', details: { doseNumber: 'Dose 1', dateGiven: '2026-10-01', location: 'Clinic A', notes: 'Patient note' }, source: 'patient_reported', verificationStatus: 'unverified' }] })
    render(<HealthRecordsPage />, { wrapper: MemoryRouter })
    await screen.findByText('Influenza vaccine')
    const countCard = screen.getAllByText('Vaccinations')[0].closest('article')
    expect(within(countCard).getByText('1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Vaccinations' }))
    expect(screen.getAllByText('Influenza vaccine')).toHaveLength(1)
    expect(screen.queryByText('Medical history')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit in Profile Settings' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View Details' })).toBeInTheDocument()
    expect(presentationRepository.getPatientHealthRecordSources).not.toHaveBeenCalled()
  })

  it('shows zero vaccination count and an empty Health Records state when no vaccinations exist', async () => {
    presentationRepository.metadata.isSynthetic = false
    reportedApi.get.mockResolvedValue({ items: [] })
    documentApi.listMine.mockResolvedValue([])
    render(<HealthRecordsPage />)
    await screen.findByRole('heading', { name: 'Health Records' })
    const countCard = screen.getAllByText('Vaccinations')[0].closest('article')
    expect(within(countCard).getByText('0')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Vaccinations' }))
    expect(screen.getByText('No records in this category')).toBeInTheDocument()
  })

  it('shows a medication empty state for a successful empty read', async () => {
    presentationRepository.listMedications.mockResolvedValueOnce([])
    render(<MedicationsPage />, { wrapper: MemoryRouter })
    expect(await screen.findByText('No medications found')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps document intelligence on its existing page without showing it in Health Records', () => {
    const { rerender } = render(<LabResultsPage />)
    expect(screen.getByRole('region', { name: 'Extracted Lab Results extracted health intelligence' })).toBeInTheDocument()
    rerender(<HealthRecordsPage />)
    expect(screen.queryByRole('heading', { name: 'Insights from Medical Documents' })).not.toBeInTheDocument()
  })
})
