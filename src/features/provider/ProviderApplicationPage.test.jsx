import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProviderApplicationPage } from './ProviderApplicationPage.jsx'
import { providerApplicationService } from '../../services/providerApplicationService.js'

vi.mock('../../services/providerApplicationService.js', () => ({ providerApplicationService: {
  load: vi.fn(), listSpecialties: vi.fn(), saveDraft: vi.fn(), submit: vi.fn(), uploadCredential: vi.fn(), createDownloadUrl: vi.fn(), removeCredential: vi.fn(),
} }))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'applicant-1' } }) }))

const initial = { profile: { full_name: 'Applicant Name', phone: '+959123456789' }, is_verified_provider: false, application: null }
const specialties = [{ id: 'specialty-1', name: 'Cardiology' }]
const view = () => render(<MemoryRouter initialEntries={['/provider/apply']}><Routes><Route path="/provider/apply" element={<ProviderApplicationPage />} /><Route path="/settings" element={<p>Profile Settings destination</p>} /><Route path="/provider" element={<p>Verified Provider Workspace</p>} /></Routes></MemoryRouter>)

beforeEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  providerApplicationService.load.mockResolvedValue(initial)
  providerApplicationService.listSpecialties.mockResolvedValue(specialties)
  providerApplicationService.saveDraft.mockResolvedValue('application-1')
  providerApplicationService.submit.mockResolvedValue('submitted')
  providerApplicationService.uploadCredential.mockResolvedValue({ id: 'credential-document-id', fileName: 'license.pdf', storagePath: 'owner/application/license.pdf', mimeType: 'application/pdf', fileSize: 10 })
  providerApplicationService.createDownloadUrl.mockResolvedValue('https://private.invalid/signed')
  providerApplicationService.removeCredential.mockResolvedValue(true)
})

describe('Provider Application UI', () => {
  it('lets a signed-in user start a separate application with requested provider type and specialty', async () => {
    const user = userEvent.setup()
    view()
    await user.click(await screen.findByRole('button', { name: 'Start Application' }))
    expect(await screen.findByRole('heading', { name: 'Professional Role' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Requested provider type'), 'doctor')
    await user.selectOptions(screen.getByLabelText('Specialty'), 'specialty-1')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Professional Details' })).toBeInTheDocument()
    expect(providerApplicationService.saveDraft).toHaveBeenCalledWith('application-1', expect.objectContaining({ requested_provider_type: 'doctor', specialty_id: 'specialty-1' }))
    expect(screen.queryByLabelText(/profile role/i)).not.toBeInTheDocument()
  })

  it('shows specialty only for Doctor and clears it when changing to any non-doctor role', async () => {
    const user = userEvent.setup()
    view()
    await user.click(await screen.findByRole('button', { name: 'Start Application' }))
    const type = screen.getByLabelText('Requested provider type')
    expect([...type.options].filter(option => !option.hidden).map(option => option.textContent)).toEqual([
      'Select provider type', 'Doctor', 'Nurse Aide', 'Skilled Nurse Aide', 'Special Nurse', 'Caregiver',
    ])

    await user.selectOptions(type, 'doctor')
    expect(screen.getByLabelText('Specialty')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Specialty'), 'specialty-1')
    await user.selectOptions(type, 'nurse_aide')
    expect(screen.queryByLabelText('Specialty')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(providerApplicationService.saveDraft).toHaveBeenLastCalledWith('application-1', expect.objectContaining({ requested_provider_type: 'nurse_aide', specialty_id: '' })))

    for (const role of ['skilled_nurse_aide', 'special_nurse', 'caregiver']) {
      await user.selectOptions(type, role)
      expect(screen.queryByLabelText('Specialty')).not.toBeInTheDocument()
    }
  })

  it('saves and resumes an owner draft', async () => {
    const user = userEvent.setup()
    providerApplicationService.load.mockResolvedValue({ ...initial, application: { id: 'draft-1', status: 'draft', requested_provider_type: 'nurse', specialty_id: 'specialty-1', documents: [] } })
    view()
    await user.click(await screen.findByRole('button', { name: 'Continue Application' }))
    expect(await screen.findByRole('heading', { name: 'Professional Role' })).toBeInTheDocument()
    expect(screen.getByLabelText('Requested provider type')).toHaveValue('nurse')
    await user.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(providerApplicationService.saveDraft).toHaveBeenCalledWith('draft-1', expect.any(Object)))
    expect(await screen.findByRole('status')).toHaveTextContent('Draft saved.')
  })

  it('uploads a credential, reviews it, submits, and then shows pending status only', async () => {
    const user = userEvent.setup()
    const submitted = { ...initial, application: { id: 'application-1', status: 'submitted', requested_provider_type: 'doctor', submitted_at: '2026-10-05T00:00:00Z', documents: [{ id: 'doc-1', document_type: 'professional_license', file_name: 'license.pdf', storage_path: 'owner/application/license.pdf' }] } }
    providerApplicationService.load.mockResolvedValueOnce(initial).mockResolvedValueOnce(submitted)
    view()
    await user.click(await screen.findByRole('button', { name: 'Start Application' }))
    await user.selectOptions(screen.getByLabelText('Requested provider type'), 'doctor')
    await user.selectOptions(screen.getByLabelText('Specialty'), 'specialty-1')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText('Professional license or registration number'), 'MD-123')
    await user.type(screen.getByLabelText('License issuer'), 'Health Council')
    await user.type(screen.getByLabelText('Qualifications'), 'MD')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    const file = new File(['credential'], 'license.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText(/Credential file/), { target: { files: [file] } })
    expect(await screen.findByText(/Professional license · license.pdf/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Review & Submit' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit Application' }))
    expect(await screen.findByRole('heading', { name: 'Submitted — pending review' })).toBeInTheDocument()
    expect(screen.getByText(/does not grant clinical access/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit Application' })).not.toBeInTheDocument()
    expect(providerApplicationService.submit).toHaveBeenCalledWith('application-1')
  })

  it('shows an existing verified-provider message without starting another application', async () => {
    providerApplicationService.load.mockResolvedValue({ ...initial, is_verified_provider: true })
    view()
    expect(await screen.findByRole('heading', { name: 'Your provider account is already verified' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Provider Workspace' })).toHaveAttribute('href', '/provider')
    expect(screen.queryByRole('button', { name: 'Start Application' })).not.toBeInTheDocument()
    expect(providerApplicationService.saveDraft).not.toHaveBeenCalled()
  })

  it('shows the safe applicant-facing rejection reason without admin metadata or credential URLs', async () => {
    providerApplicationService.load.mockResolvedValue({ ...initial, application: { id: 'rejected-1', status: 'rejected', submitted_at: '2026-10-01T00:00:00Z', requested_provider_type: 'doctor', decision_reason: 'Please provide a current professional license.', documents: [] } })
    view()
    expect(await screen.findByRole('heading', { name: 'Rejected' })).toBeInTheDocument()
    expect(screen.getByText('Please provide a current professional license.')).toBeInTheDocument()
    expect(screen.queryByText(/reviewer_profile_id|decided_by_profile_id|provisioned_provider_id/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/storage\.supabase|publicUrl/i)).not.toBeInTheDocument()
  })

  it('lets only the owning applicant remove a credential while the application is a draft', async () => {
    const user = userEvent.setup()
    const file = { id: 'document-1', document_type: 'other', file_name: 'test.pdf', storage_path: 'owner/draft/test.pdf' }
    providerApplicationService.load.mockResolvedValue({ ...initial, application: {
      id: 'draft-1', applicant_profile_id: 'applicant-1', status: 'draft', requested_provider_type: 'skilled_nurse_aide', documents: [file],
    } })
    view()
    await user.click(await screen.findByRole('button', { name: 'Continue Application' }))
    for (let step = 0; step < 3; step += 1) await user.click(await screen.findByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Remove test.pdf' }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Remove test.pdf from this draft?')
    await user.click(screen.getByRole('button', { name: 'Remove credential' }))
    await waitFor(() => expect(providerApplicationService.removeCredential).toHaveBeenCalledWith('application-1', 'document-1'))
    await waitFor(() => expect(screen.queryByText(/Other credential evidence · test.pdf/)).not.toBeInTheDocument())
    expect(await screen.findByRole('status')).toHaveTextContent('Credential removed from your draft.')
  })

  it('hides removal for documents not owned by the current applicant', async () => {
    const user = userEvent.setup()
    const file = { id: 'document-1', document_type: 'other', file_name: 'test.pdf', storage_path: 'other/draft/test.pdf' }
    providerApplicationService.load.mockResolvedValue({ ...initial, application: {
      id: 'draft-1', applicant_profile_id: 'other-applicant', status: 'draft', requested_provider_type: 'skilled_nurse_aide', documents: [file],
    } })
    view()
    await user.click(await screen.findByRole('button', { name: 'Continue Application' }))
    for (let step = 0; step < 3; step += 1) await user.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(screen.queryByRole('button', { name: 'Remove test.pdf' })).not.toBeInTheDocument()
    expect(providerApplicationService.removeCredential).not.toHaveBeenCalled()
  })

  it('does not render credential removal for a submitted application', async () => {
    providerApplicationService.load.mockResolvedValue({ ...initial, application: {
      id: 'submitted-1', applicant_profile_id: 'applicant-1', status: 'submitted', requested_provider_type: 'skilled_nurse_aide',
      documents: [{ id: 'document-1', document_type: 'other', file_name: 'test.pdf', storage_path: 'owner/submitted/test.pdf' }],
    } })
    view()
    expect(await screen.findByRole('heading', { name: 'Submitted — pending review' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
  })
})
