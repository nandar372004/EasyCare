import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PatientOnboardingPage } from './PatientOnboardingPage.jsx'
import { PatientOnboardingRoute } from '../auth/RouteGuards.jsx'

const mocks = vi.hoisted(() => ({ auth: { status: 'authenticated', isAuthenticated: true, patient: { id: 'patient-from-session', full_name: 'Session Patient' }, workspace: 'patient' }, get: vi.fn(), save: vi.fn() }))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => mocks.auth }))
vi.mock('../../services/patientOnboardingService.js', () => ({ getPatientOnboarding: (...args) => mocks.get(...args), savePatientOnboarding: (...args) => mocks.save(...args) }))

const record = status => ({ status, profile: {}, identity: { fullName: 'Session Patient', dateOfBirth: '1990-01-01', phone: '+959123456789' } })
function view(path = '/onboarding') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route element={<PatientOnboardingRoute />}><Route path="/onboarding" element={<PatientOnboardingPage />} /></Route>
    <Route path="/dashboard" element={<div>Patient dashboard</div>} />
    <Route path="/login" element={<div>Sign in destination</div>} />
    <Route path="/provider" element={<div>Provider workspace</div>} />
  </Routes></MemoryRouter>)
}

beforeEach(() => {
  mocks.auth = { status: 'authenticated', isAuthenticated: true, patient: { id: 'patient-from-session', full_name: 'Session Patient' }, workspace: 'patient' }
  mocks.get.mockReset().mockResolvedValue(record('not_started'))
  mocks.save.mockReset().mockImplementation(async status => record(status))
})

describe('patient onboarding shell', () => {
  it('allows a session patient in, while signed-out and non-patient workspaces are redirected', async () => {
    const { unmount } = view()
    expect(await screen.findByRole('heading', { name: 'Welcome to EasyCare, Session' })).toBeInTheDocument()
    expect(mocks.get).toHaveBeenCalledWith()
    unmount()
    mocks.auth = { status: 'anonymous', isAuthenticated: false, patient: null, workspace: null }
    view()
    expect(await screen.findByText('Sign in destination')).toBeInTheDocument()
  })

  it('redirects an authenticated provider workspace away from patient onboarding', async () => {
    mocks.auth = { status: 'authenticated', isAuthenticated: true, patient: null, workspace: 'provider', provider: { provider_id: 'provider-1' } }
    view()
    expect(await screen.findByText('Provider workspace')).toBeInTheDocument()
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('skips without blocking access and saves state without a browser supplied patient identifier', async () => {
    const user = userEvent.setup()
    view()
    await user.click(await screen.findByRole('button', { name: 'I’ll Do This Later' }))
    expect(await screen.findByText('Patient dashboard')).toBeInTheDocument()
    expect(mocks.save).toHaveBeenCalledWith('skipped', expect.any(Object))
    expect(JSON.stringify(mocks.save.mock.calls)).not.toContain('patient-from-session')
  })

  it('resumes an in-progress setup and completes with only safe profile fields', async () => {
    const user = userEvent.setup()
    mocks.get.mockResolvedValue(record('in_progress'))
    view()
    expect(await screen.findByRole('heading', { name: 'Complete your profile' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Step 2 of 5: Contact & Address')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Step 3 of 5: Health Information')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Skip Health Information' }))
    expect(await screen.findByText('Step 4 of 5: Family Setup')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Step 5 of 5: Review')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Finish Setup' }))
    expect(await screen.findByText('Patient dashboard')).toBeInTheDocument()
    expect(mocks.save).toHaveBeenLastCalledWith('completed', expect.any(Object))
    const saved = mocks.save.mock.calls.at(-1)[1]
    expect(saved).not.toHaveProperty('patientId')
    expect(saved).not.toHaveProperty('allergies')
    expect(saved).not.toHaveProperty('conditions')
    expect(saved).not.toHaveProperty('medications')
  })

  it('keeps patient identity read-only and exposes no patient ID field', async () => {
    view()
    await screen.findByRole('heading', { name: 'Welcome to EasyCare, Session' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Set Up My Profile' }))
    expect(await screen.findByLabelText('Full Name')).toHaveValue('Session Patient')
    expect(screen.getByLabelText('Full Name')).toHaveAttribute('readonly')
    expect(screen.queryByLabelText(/patient id/i)).not.toBeInTheDocument()
  })

  it('offers Just Myself and Family setup as optional choices without changing onboarding persistence', async () => {
    const user = userEvent.setup()
    mocks.get.mockResolvedValue(record('in_progress'))
    view()
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Skip Health Information' }))
    expect(await screen.findByRole('heading', { name: 'How will you use EasyCare?' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Just Myself/ })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: /Myself and My Family/ }))
    expect(screen.getByRole('link', { name: 'Open Family Setup' })).toHaveAttribute('href', '/family')
    expect(screen.getByText(/Health information stays private until that adult grants specific permissions/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Step 5 of 5: Review')).toBeInTheDocument()
    expect(mocks.save).toHaveBeenLastCalledWith('in_progress', expect.any(Object))
  })
})
