import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { calculateDoctorAge, DoctorProfessionalInformationPage } from './DoctorProfessionalInformationPage.jsx'

const state = vi.hoisted(() => ({ auth: {}, load: vi.fn(), save: vi.fn(), createLicenseUrl: vi.fn() }))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => state.auth }))
vi.mock('../../services/doctorProfessionalInformationService.js', () => ({
  DOCTOR_LICENSE_TYPES: [
    { value: 'general_medical_practitioner', label: 'General Medical Practitioner' },
    { value: 'specialist_medical_practitioner', label: 'Specialist Medical Practitioner' },
    { value: 'limited_medical_practitioner', label: 'Limited Medical Practitioner' },
  ],
  doctorProfessionalInformationService: { load: state.load, save: state.save, createLicenseUrl: state.createLicenseUrl },
}))
afterEach(() => cleanup())

describe('Doctor Professional Information portal form', () => {
  it('calculates age from date of birth, including whether the birthday has passed', () => {
    expect(calculateDoctorAge('1990-10-10', new Date('2026-10-09T00:00:00Z'))).toBe(35)
    expect(calculateDoctorAge('1990-10-10', new Date('2026-10-10T00:00:00Z'))).toBe(36)
    expect(calculateDoctorAge('', new Date('2026-10-10T00:00:00Z'))).toBe('')
  })

  it('shows the simple doctor-only form and saves information without a review workflow', async () => {
    state.auth = { status: 'authenticated', isAuthenticated: true, user: { id: 'profile-1' }, provider: { id: 'doctor-1', type: 'doctor', displayName: 'Dr Example' }, providerSetup: null }
    state.load.mockResolvedValueOnce(null)
    state.save.mockImplementation(async (_providerId, fields) => fields)
    render(<MemoryRouter><DoctorProfessionalInformationPage /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Doctor Professional Information' })
    fireEvent.change(screen.getByLabelText('Doctor Full Name *'), { target: { value: 'Dr Example' } })
    fireEvent.change(screen.getByLabelText('NRC *'), { target: { value: '12/ABC(N)123456' } })
    fireEvent.change(screen.getByLabelText('Date of Birth *'), { target: { value: '1990-10-10' } })
    fireEvent.change(screen.getByLabelText('Work Experience (Years) *'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('Medical Qualification *'), { target: { value: 'MBBS' } })
    fireEvent.change(screen.getByLabelText('MMC Registration Number *'), { target: { value: 'MMC-10' } })
    fireEvent.change(screen.getByLabelText('Medical Practitioner License Number (ဆမ) *'), { target: { value: 'SAM-20' } })
    fireEvent.change(screen.getByLabelText('License Type *'), { target: { value: 'general_medical_practitioner' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Professional Information' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Professional information saved.')
    expect(state.save).toHaveBeenCalledWith('doctor-1', expect.objectContaining({ nrc: '12/ABC(N)123456', date_of_birth: '1990-10-10', mmc_registration_number: 'MMC-10' }), null)
    expect(screen.queryByText(/admin review|approve|reject|pending|changes required|submit for verification/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Age, calculated from date of birth').value).toMatch(/^\d+ years$/)
  })

  it('does not offer the form to another provider type', () => {
    state.auth = { status: 'authenticated', isAuthenticated: true, provider: { id: 'nurse-1', type: 'nurse_aide' } }
    render(<MemoryRouter><DoctorProfessionalInformationPage /></MemoryRouter>)
    expect(screen.getByText('This form is available to doctor accounts only.')).toBeInTheDocument()
    expect(screen.queryByLabelText('NRC *')).not.toBeInTheDocument()
  })
})
