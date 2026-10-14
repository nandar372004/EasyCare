import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { ProviderSetupPage } from './ProviderSetupPage.jsx'

const state = vi.hoisted(() => ({
  auth: {}, refreshIdentity: vi.fn(), complete: vi.fn(), listSpecialties: vi.fn(),
  loadProfessionalInfo: vi.fn(), saveProfessionalInfo: vi.fn(), createLicenseUrl: vi.fn(),
}))

vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ ...state.auth, refreshIdentity: state.refreshIdentity }) }))
vi.mock('../../services/providerSetupService.js', () => ({
  PROVIDER_SETUP_TYPES: ['doctor', 'nurse_aide', 'skilled_nurse_aide', 'special_nurse'],
  providerSetupService: { complete: state.complete, listSpecialties: state.listSpecialties },
}))
vi.mock('../../services/doctorProfessionalInformationService.js', () => ({
  DOCTOR_LICENSE_TYPES: [
    { value: 'general_medical_practitioner', label: 'General Medical Practitioner' },
    { value: 'specialist_medical_practitioner', label: 'Specialist Medical Practitioner' },
    { value: 'limited_medical_practitioner', label: 'Limited Medical Practitioner' },
  ],
  doctorProfessionalInformationService: {
    load: state.loadProfessionalInfo,
    save: state.saveProfessionalInfo,
    createLicenseUrl: state.createLicenseUrl,
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function setIdentity(type) {
  state.auth = {
    status: 'authenticated', isAuthenticated: true, patient: null, admin: null,
    providerSetup: {
      id: `${type}-1`, type, displayName: 'Dr Example', fullName: 'Dr Example', phone: '',
      bio: '', qualification: '', licenseNumber: '', specialtyId: '', teleconsultEnabled: false,
      homeVisitEnabled: false, consultationFeeMmk: '', setupState: 'profile_incomplete',
    },
  }
  state.refreshIdentity.mockResolvedValue(undefined)
  state.complete.mockResolvedValue(undefined)
  state.listSpecialties.mockResolvedValue([{ id: 'specialty-1', name: 'Cardiology' }])
  state.loadProfessionalInfo.mockResolvedValue(null)
  state.saveProfessionalInfo.mockImplementation(async (_providerId, fields) => fields)
}

function LocationProbe() { return <output data-testid="current-path">{useLocation().pathname}</output> }

describe('ProviderSetupPage doctor professional information integration', () => {
  it('replaces the old generic doctor step with the shared inline professional form', async () => {
    setIdentity('doctor')
    render(<MemoryRouter initialEntries={['/provider/setup']}><ProviderSetupPage /></MemoryRouter>)

    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0912345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Professional Information' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Doctor Full Name *')).toBeInTheDocument()
    expect(screen.getByLabelText('NRC *')).toBeInTheDocument()
    expect(screen.getByLabelText('Specialty *')).toBeInTheDocument()
    expect(screen.getByLabelText('Teleconsultation')).toBeInTheDocument()
    expect(screen.getByLabelText('Home Visit')).toBeInTheDocument()
    expect(screen.getByLabelText('Consultation Fee (MMK)')).toBeInTheDocument()
    expect(screen.getByLabelText('Upload Medical License')).toBeInTheDocument()
    expect(screen.queryByText('Open Doctor Professional Information')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Qualification')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('License or registration number')).not.toBeInTheDocument()
    expect(screen.queryByText('Consultation type')).not.toBeInTheDocument()
  })

  it('validates and saves once on Review, then advances to a professional information summary', async () => {
    setIdentity('doctor')
    render(<MemoryRouter initialEntries={['/provider/setup']}><ProviderSetupPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0912345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.change(await screen.findByLabelText('Doctor Full Name *'), { target: { value: 'Dr Example' } })
    fireEvent.change(screen.getByLabelText('NRC *'), { target: { value: '12/ABC(N)123456' } })
    fireEvent.change(screen.getByLabelText('Date of Birth *'), { target: { value: '1990-10-10' } })
    fireEvent.change(screen.getByLabelText('Work Experience (Years) *'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('Medical Qualification *'), { target: { value: 'MBBS' } })
    fireEvent.change(screen.getByLabelText('Specialty *'), { target: { value: 'specialty-1' } })
    fireEvent.change(screen.getByLabelText('MMC Registration Number *'), { target: { value: 'MMC-10' } })
    fireEvent.change(screen.getByLabelText('Medical Practitioner License Number (ဆမ) *'), { target: { value: 'SAM-20' } })
    fireEvent.change(screen.getByLabelText('License Type *'), { target: { value: 'general_medical_practitioner' } })
    fireEvent.click(screen.getByLabelText('Teleconsultation'))
    fireEvent.change(screen.getByLabelText('Consultation Fee (MMK)'), { target: { value: '30000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))

    expect(await screen.findByText('Review your saved professional information before finishing setup.')).toBeInTheDocument()
    expect(screen.getByText('12/ABC(N)123456')).toBeInTheDocument()
    expect(screen.getByText('MMC-10')).toBeInTheDocument()
    expect(state.saveProfessionalInfo).toHaveBeenCalledTimes(1)
    expect(state.saveProfessionalInfo).toHaveBeenCalledWith('doctor-1', expect.objectContaining({
      nrc: '12/ABC(N)123456', date_of_birth: '1990-10-10', medical_qualification: 'MBBS',
    }), null)
    expect(state.complete).not.toHaveBeenCalled()
  })

  it('blocks Review while required professional fields are incomplete', async () => {
    setIdentity('doctor')
    render(<MemoryRouter initialEntries={['/provider/setup']}><ProviderSetupPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0912345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(await screen.findByLabelText('Doctor Full Name *'), { target: { value: 'Dr Example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))

    expect(state.saveProfessionalInfo).not.toHaveBeenCalled()
    expect(screen.queryByText('Review your saved professional information before finishing setup.')).not.toBeInTheDocument()
  })

  it('finishes setup after Review without saving professional information a second time', async () => {
    setIdentity('doctor')
    render(<MemoryRouter initialEntries={['/provider/setup']}><ProviderSetupPage /><LocationProbe /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0912345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(await screen.findByLabelText('NRC *'), { target: { value: '12/ABC(N)123456' } })
    fireEvent.change(screen.getByLabelText('Date of Birth *'), { target: { value: '1990-10-10' } })
    fireEvent.change(screen.getByLabelText('Work Experience (Years) *'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('Medical Qualification *'), { target: { value: 'MBBS' } })
    fireEvent.change(screen.getByLabelText('Specialty *'), { target: { value: 'specialty-1' } })
    fireEvent.change(screen.getByLabelText('MMC Registration Number *'), { target: { value: 'MMC-10' } })
    fireEvent.change(screen.getByLabelText('Medical Practitioner License Number (ဆမ) *'), { target: { value: 'SAM-20' } })
    fireEvent.change(screen.getByLabelText('License Type *'), { target: { value: 'general_medical_practitioner' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    await screen.findByText('Review your saved professional information before finishing setup.')
    fireEvent.click(screen.getByRole('button', { name: 'Complete setup' }))

    await waitFor(() => expect(state.complete).toHaveBeenCalledTimes(1))
    expect(state.saveProfessionalInfo).toHaveBeenCalledTimes(1)
    expect(state.complete).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Dr Example', phone: '0912345678', specialtyId: 'specialty-1' }))
    await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/provider'))
  })
})

describe('ProviderSetupPage non-doctor flow', () => {
  it.each(['nurse_aide', 'skilled_nurse_aide', 'special_nurse'])('%s retains the existing role information step', async type => {
    setIdentity(type)
    render(<MemoryRouter initialEntries={['/provider/setup']}><ProviderSetupPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0912345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Role Information' })).toBeInTheDocument()
    expect(screen.getByLabelText('Qualification')).toBeInTheDocument()
    expect(screen.queryByLabelText('NRC *')).not.toBeInTheDocument()
    expect(state.loadProfessionalInfo).not.toHaveBeenCalled()
    expect(state.saveProfessionalInfo).not.toHaveBeenCalled()
  })
})
