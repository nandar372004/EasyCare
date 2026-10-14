import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { adminProviderApplicationService } from '../../services/adminProviderApplicationService.js'
import { AdminProviderApplicationDetailPage, AdminProviderApplicationsPage } from './AdminProviderApplicationsPage.jsx'

vi.mock('../../services/adminProviderApplicationService.js', () => ({
  adminProviderApplicationService: {
    list: vi.fn(), load: vi.fn(), startReview: vi.fn(), approve: vi.fn(), reject: vi.fn(),
    createCredentialUrl: vi.fn(),
  },
}))

const authState = vi.hoisted(() => ({ value: null }))
vi.mock('../../features/auth/AuthContext.jsx', () => ({ useAuth: () => authState.value }))

const row = {
  application_id: 'application-1', applicant_name: 'Applicant One', requested_provider_type: 'doctor',
  specialty_name: 'Family Medicine', status: 'submitted', submitted_at: '2026-10-04T00:00:00Z',
}
const document = { id: 'document-1', document_type: 'professional_license', file_name: 'license.pdf', storage_path: 'owner/application/license.pdf', mime_type: 'application/pdf', file_size: 2048 }
const baseRecord = {
  application: { id: 'application-1', status: 'submitted', requested_provider_type: 'doctor', license_number: 'MD-123', license_issuer: 'Health Council', qualifications: 'MD', languages: ['English'], submitted_at: '2026-10-04T00:00:00Z' },
  applicant: { profile_id: 'applicant-1', full_name: 'Applicant One', phone: '+959860000001', email: 'applicant@example.invalid', role: 'patient', status: 'active' },
  specialty: 'Family Medicine', documents: [document],
}

function renderList() {
  return render(<MemoryRouter initialEntries={['/admin/provider-applications']}><Routes><Route path="/admin/provider-applications" element={<AdminProviderApplicationsPage />} /></Routes></MemoryRouter>)
}

function renderDetail() {
  return render(<MemoryRouter initialEntries={['/admin/provider-applications/application-1']}><Routes><Route path="/admin/provider-applications/:applicationId" element={<AdminProviderApplicationDetailPage />} /></Routes></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.value = { patient: null, provider: null, admin: true, workspace: 'admin', switchWorkspace: vi.fn(), signOut: vi.fn() }
  adminProviderApplicationService.list.mockResolvedValue([row])
  adminProviderApplicationService.load.mockResolvedValue(baseRecord)
  adminProviderApplicationService.startReview.mockResolvedValue('under_review')
  adminProviderApplicationService.approve.mockResolvedValue('provider-1')
  adminProviderApplicationService.reject.mockResolvedValue('rejected')
  adminProviderApplicationService.createCredentialUrl.mockResolvedValue('https://signed.invalid/temporary')
})

describe('admin provider application review pages', () => {
  it('shows the submitted review queue and sends selected status filters to the server', async () => {
    const user = userEvent.setup()
    renderList()
    expect(await screen.findByRole('heading', { name: 'Provider application review' })).toBeInTheDocument()
    expect(await screen.findByText('Applicant One')).toBeInTheDocument()
    expect(screen.getByText('Family Medicine')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Application status'), 'under_review')
    await waitFor(() => expect(adminProviderApplicationService.list).toHaveBeenLastCalledWith('under_review'))
  })

  it('labels the supported non-doctor provider roles and displays no specialty when absent', async () => {
    adminProviderApplicationService.list.mockResolvedValue([
      { ...row, application_id: 'nurse-aide', applicant_name: 'Aide', requested_provider_type: 'nurse_aide', specialty_name: null },
      { ...row, application_id: 'skilled-aide', applicant_name: 'Skilled aide', requested_provider_type: 'skilled_nurse_aide', specialty_name: null },
      { ...row, application_id: 'special-nurse', applicant_name: 'Special nurse', requested_provider_type: 'special_nurse', specialty_name: null },
      { ...row, application_id: 'caregiver', applicant_name: 'Caregiver', requested_provider_type: 'caregiver', specialty_name: null },
    ])
    renderList()
    expect(await screen.findByText('Nurse Aide')).toBeInTheDocument()
    expect(screen.getByText('Skilled Nurse Aide')).toBeInTheDocument()
    expect(screen.getByText('Special Nurse')).toBeInTheDocument()
    expect(screen.getAllByText('Caregiver')).toHaveLength(2)
    expect(screen.getAllByText('Not selected')).toHaveLength(4)
  })

  it('loads professional details and opens credentials with an ephemeral signed URL', async () => {
    const user = userEvent.setup()
    renderDetail()
    expect(await screen.findByText('MD-123')).toBeInTheDocument()
    expect(screen.getByText('Health Council')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Prepare secure link' }))
    const link = await screen.findByRole('link', { name: 'Open secure document' })
    expect(link).toHaveAttribute('href', 'https://signed.invalid/temporary')
    expect(link).toHaveAttribute('target', '_blank')
    expect(adminProviderApplicationService.createCredentialUrl).toHaveBeenCalledWith('application-1', document.storage_path)
  })

  it('starts review and requires a separate confirmation before approval', async () => {
    const user = userEvent.setup()
    adminProviderApplicationService.load
      .mockResolvedValueOnce(baseRecord)
      .mockResolvedValueOnce({ ...baseRecord, application: { ...baseRecord.application, status: 'under_review' } })
      .mockResolvedValueOnce({ ...baseRecord, application: { ...baseRecord.application, status: 'verified', provisioned_provider_id: 'provider-1', decided_at: '2026-10-05T00:00:00Z' } })
    renderDetail()
    await user.click(await screen.findByRole('button', { name: 'Start Review' }))
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(adminProviderApplicationService.startReview).toHaveBeenCalledWith('application-1')
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm Approval' }))
    expect(await screen.findByText('provider-1')).toBeInTheDocument()
    expect(adminProviderApplicationService.approve).toHaveBeenCalledWith('application-1')
  })

  it('requires a safe applicant-facing reason and confirms rejection', async () => {
    const user = userEvent.setup()
    adminProviderApplicationService.load
      .mockResolvedValueOnce({ ...baseRecord, application: { ...baseRecord.application, status: 'under_review' } })
      .mockResolvedValueOnce({ ...baseRecord, application: { ...baseRecord.application, status: 'rejected', decision_reason: 'Please provide a current professional license.', decided_at: '2026-10-05T00:00:00Z' } })
    renderDetail()
    await user.click(await screen.findByRole('button', { name: 'Reject' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm Rejection' })).toBeDisabled()
    await user.type(screen.getByLabelText('Safe reason shown to the applicant'), 'Please provide a current professional license.')
    await user.click(screen.getByRole('button', { name: 'Confirm Rejection' }))
    expect(await screen.findByText('Application rejected. The reason is visible to the applicant.')).toBeInTheDocument()
    expect(adminProviderApplicationService.reject).toHaveBeenCalledWith('application-1', 'Please provide a current professional license.')
  })
})
