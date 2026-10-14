import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProviderProfilePage, ProviderSettingsPage, ProviderShell } from './ProviderWorkspace.jsx'
import { ProviderAppointmentsPage } from './ProviderAppointmentsPage.jsx'
import { ProviderAvailabilityPage } from './ProviderAvailabilityPage.jsx'
import { ProviderTabs } from './components/ProviderSharedComponents.jsx'

const state = vi.hoisted(() => ({ auth: {}, listSlots: vi.fn() }))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => state.auth }))
vi.mock('../auth/WorkspaceSwitcher.jsx', () => ({ WorkspaceSwitcher: () => null }))
vi.mock('../../services/providerAvailabilityService.js', () => ({ providerAvailabilityService: { listMySlots: state.listSlots, addSlot: vi.fn(), removeAvailableSlot: vi.fn() } }))
afterEach(() => cleanup())

describe('provider navigation and profile UI', () => {
  it.each([
    ['doctor', ['Dashboard', 'Appointments', 'Availability', 'Patients', 'Profile', 'Settings']],
    ['nurse_aide', ['Dashboard', 'Assigned Care', 'Tasks / Visits', 'Profile', 'Settings']],
    ['skilled_nurse_aide', ['Dashboard', 'Assigned Care', 'Monitoring / Tasks', 'Profile', 'Settings']],
    ['special_nurse', ['Dashboard', 'Assigned Care', 'Monitoring', 'Profile', 'Settings']],
  ])('shows the supported %s navigation', (type, labels) => {
    state.auth = { provider: { id: 'provider-1', type, displayName: 'Provider One' }, signOut: vi.fn() }
    render(<MemoryRouter><ProviderShell /></MemoryRouter>)
    const navigation = within(screen.getByRole('navigation', { name: 'Provider workspace' }))
    for (const label of labels) expect(navigation.getByRole('link', { name: label })).toBeInTheDocument()
    if (type === 'doctor') expect(screen.getByRole('link', { name: 'Appointments' })).toBeInTheDocument()
    else expect(screen.queryByRole('link', { name: 'Appointments' })).not.toBeInTheDocument()
    if (type !== 'doctor') expect(screen.queryByRole('link', { name: 'Availability' })).not.toBeInTheDocument()
  })

  it('shows common nurse profile fields and omits unsupported doctor details', () => {
    state.auth = { provider: { id: 'provider-1', type: 'nurse_aide', displayName: 'Nurse A', phone: '+959123', bio: 'Care support' }, user: { email: 'nurse@example.test' } }
    render(<MemoryRouter><ProviderProfilePage /></MemoryRouter>)
    expect(screen.getByText('nurse@example.test')).toBeInTheDocument()
    expect(screen.getByText('+959123')).toBeInTheDocument()
    expect(screen.queryByText('License / registration')).not.toBeInTheDocument()
    expect(screen.getByText('Profile updates are not available yet.')).toBeInTheDocument()
  })

  it('shows doctor fields already present in the provider identity', () => {
    state.auth = { provider: { id: 'provider-1', type: 'doctor', displayName: 'Dr A', licenseNumber: 'LIC-1', qualification: 'MBBS', specialtyId: 'cardiology', consultationFeeMmk: 30000, teleconsultEnabled: true }, user: { email: 'doctor@example.test' } }
    render(<MemoryRouter><ProviderProfilePage /></MemoryRouter>)
    expect(screen.getByText('LIC-1')).toBeInTheDocument()
    expect(screen.getByText('MBBS')).toBeInTheDocument()
    expect(screen.getByText('Teleconsultation')).toBeInTheDocument()
    expect(screen.getByText('30000 MMK')).toBeInTheDocument()
  })

  it('does not render doctor appointment actions for a nurse account', () => {
    state.auth = { provider: { id: 'provider-1', type: 'special_nurse', displayName: 'Nurse' } }
    render(<ProviderAppointmentsPage />)
    expect(screen.getByText('Appointment management is available to doctor accounts only.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
  })

  it('shows the read-only account email and supported password setting', () => {
    state.auth = { user: { email: 'provider@example.test' }, session: null, signOut: vi.fn() }
    render(<MemoryRouter><ProviderSettingsPage /></MemoryRouter>)
    expect(screen.getByLabelText('Email')).toHaveValue('provider@example.test')
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly')
    expect(screen.getByRole('heading', { name: 'Change password' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('wires availability for doctors and protects it from nurse accounts', async () => {
    state.auth = { provider: { id: 'doctor-1', type: 'doctor' } }
    state.listSlots.mockResolvedValueOnce([])
    const view = render(<ProviderAvailabilityPage />)
    expect(await screen.findByRole('heading', { name: 'Availability Management' })).toBeInTheDocument()
    expect(state.listSlots).toHaveBeenCalledWith('doctor-1')
    view.rerender(<ProviderAvailabilityPage />)
    state.auth = { provider: { id: 'nurse-1', type: 'nurse_aide' } }
    view.rerender(<ProviderAvailabilityPage />)
    expect(await screen.findByText('This scheduling workspace is available to doctor accounts only.')).toBeInTheDocument()
    expect(state.listSlots).toHaveBeenCalledTimes(1)
  })

  it('supports arrow-key navigation and selected state for appointment tabs', () => {
    const change = vi.fn()
    render(<ProviderTabs tabs={[{ id: 'pending', label: 'Pending' }, { id: 'confirmed', label: 'Confirmed' }]} activeTab="pending" onChange={change} />)
    const pending = screen.getByRole('tab', { name: 'Pending' })
    fireEvent.keyDown(pending, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Confirmed' })).toHaveFocus()
    expect(change).toHaveBeenCalledWith('confirmed')
  })
})
