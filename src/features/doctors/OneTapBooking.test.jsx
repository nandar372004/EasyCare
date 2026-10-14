import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingForm } from './DoctorsPage.jsx'
import { AppointmentsPage } from '../appointments/AppointmentsPage.jsx'
import { LocalizationProvider } from '../localization/LocalizationContext.jsx'
const { repo, care } = vi.hoisted(() => ({ repo: { mode: 'supabase', createAppointment: vi.fn(), listAppointments: vi.fn(), listDoctors: vi.fn() }, care: { draft: { intent: 'Medication question', note: 'My note' }, clear: vi.fn() } }))
vi.mock('../../services/repositories/index.js', () => ({ presentationRepository: repo }))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'auth-id' }, patient: { id: 'patient-id', full_name: 'Self Name' }, status: 'authenticated' }) }))
vi.mock('../care/OneTapCare.jsx', async importOriginal => ({ ...await importOriginal(), useOneTapCare: () => care }))
vi.mock('../health/HealthIntelligenceRelatedPanel.jsx', () => ({ HealthIntelligenceRelatedPanel: () => null }))
const doctor = { id: 'doctor', displayName: 'Verified Doctor', consultationTypes: ['video'], consultationFeeMmk: 5000 }
const slots = [{ id: 'slot', doctorId: 'doctor', status: 'available', serviceType: 'teleconsultation', startsAt: '2099-01-01T10:00:00Z', endsAt: '2099-01-01T10:30:00Z' }]
function open() { render(<MemoryRouter><BookingForm doctor={doctor} slots={slots} onConflictRefresh={vi.fn()} onCancel={vi.fn()} onBooked={vi.fn()} /></MemoryRouter>); fireEvent.change(screen.getByLabelText('Available date and time'), { target: { value: 'slot' } }); fireEvent.click(screen.getByRole('button', { name: 'Review booking' })) }
beforeEach(() => { vi.clearAllMocks(); repo.listAppointments.mockResolvedValue([]); repo.listDoctors.mockResolvedValue([]); care.draft = { intent: 'Medication question', note: 'My note' } })
describe('One-Tap booking integration', () => {
  it('uses the stored provider, specialty, time and Pending status across confirmation and appointments', async () => {
    const stored = { id: 'stored', patientId: 'patient-id', doctorId: 'doctor', doctor: { displayName: 'Stored Provider', specialty: 'Cardiology' }, bookingCode: 'STORED-REF', status: 'pending', scheduledAt: slots[0].startsAt, consultationType: 'video', feeMmk: 6000 }
    repo.createAppointment.mockResolvedValue(stored)
    const booking = render(<MemoryRouter><BookingForm doctor={doctor} slots={slots} onConflictRefresh={vi.fn()} onCancel={vi.fn()} onBooked={vi.fn()} /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Available date and time'), { target: { value: 'slot' } })
    fireEvent.click(screen.getByText('Review booking')); fireEvent.click(screen.getByText('Confirm booking'))
    await screen.findByText('Status: Pending')
    expect(screen.getByText(/Stored Provider · Cardiology/)).toBeInTheDocument()
    expect(screen.getByText('STORED-REF')).toBeInTheDocument()
    expect(screen.getByText(/6,000/)).toBeInTheDocument()
    booking.unmount(); repo.listAppointments.mockResolvedValue([stored])
    render(<MemoryRouter><LocalizationProvider><AppointmentsPage /></LocalizationProvider></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Stored Provider' })).toBeInTheDocument()
    expect(screen.getByText('Cardiology')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Video consultation')).toBeInTheDocument()
    expect(screen.getByText('Reference: STORED-REF')).toBeInTheDocument()
    expect(screen.getByText(/Fee: 6,000/)).toBeInTheDocument()
  })
  it('supports normal booking without a draft and exposes pressed consultation semantics', async () => {
    care.draft = null
    repo.createAppointment.mockResolvedValue({ bookingCode: 'normal', status: 'pending', scheduledAt: slots[0].startsAt, consultationType: 'video', feeMmk: 5000 })
    render(<MemoryRouter><BookingForm doctor={doctor} slots={slots} onConflictRefresh={vi.fn()} onCancel={vi.fn()} onBooked={vi.fn()} /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /Video Remote consultation/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByLabelText('Available date and time'), { target: { value: 'slot' } })
    fireEvent.change(screen.getByLabelText(/Reason for Visit/), { target: { value: '  My own reason  ' } })
    fireEvent.click(screen.getByText('Review booking')); fireEvent.click(screen.getByText('Confirm booking'))
    await screen.findByText('Status: Pending')
    expect(repo.createAppointment.mock.calls[0][0].symptoms).toBe('My own reason')
  })
  it('requires review, submits Self with merged reason, shows stored pending status and price, clears draft', async () => {
    repo.createAppointment.mockResolvedValue({ bookingCode: 'reference', status: 'pending', scheduledAt: slots[0].startsAt, consultationType: 'video', feeMmk: 6000 })
    open(); expect(repo.createAppointment).not.toHaveBeenCalled()
    expect(screen.getByText('Patient: Self · Self Name')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Confirm booking'))
    expect(await screen.findByText('Status: Pending')).toBeInTheDocument()
    expect(screen.queryByText('Appointment confirmed')).not.toBeInTheDocument()
    expect(repo.createAppointment.mock.calls[0][0]).toMatchObject({ patientId: 'patient-id', doctorId: 'doctor', slotId: 'slot', consultationType: 'video', symptoms: 'Care request: Medication question\n\nPatient note:\nMy note' })
    expect(care.clear).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/6,000/)).toBeInTheDocument()
  })
  it('blocks blind retry after uncertain failure and reads appointments for Self only', async () => {
    repo.createAppointment.mockRejectedValue(new Error('Network failure'))
    open(); fireEvent.click(screen.getByText('Confirm booking'))
    expect(await screen.findByText('Check My Appointments')).toBeInTheDocument()
    expect(repo.listAppointments).toHaveBeenCalledWith({ patientId: 'patient-id' })
    expect(screen.queryByText('Confirm booking')).not.toBeInTheDocument()
    expect(repo.createAppointment).toHaveBeenCalledTimes(1)
  })
  it('recovers an uncertain insert only by matching its Self-owned booking reference', async () => {
    repo.createAppointment.mockImplementation(async input => { repo.listAppointments.mockResolvedValue([{ patientId: 'patient-id', bookingCode: input.bookingCode, status: 'pending', scheduledAt: slots[0].startsAt, consultationType: 'video', feeMmk: 5000 }]); throw new Error('Lost response') })
    open(); fireEvent.click(screen.getByText('Confirm booking'))
    expect(await screen.findByText('Status: Pending')).toBeInTheDocument()
    expect(repo.createAppointment).toHaveBeenCalledTimes(1)
    expect(care.clear).toHaveBeenCalledTimes(1)
  })
})
