import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { WorkspaceSwitcher } from './WorkspaceSwitcher.jsx'

const state = vi.hoisted(() => ({ auth: null }))
vi.mock('./AuthContext.jsx', () => ({ useAuth: () => state.auth }))
afterEach(() => cleanup())

describe('workspace switcher', () => {
  it('shows only server-resolved identities and navigates without signing out', async () => {
    const user = userEvent.setup()
    const switchWorkspace = vi.fn(() => true)
    const signOut = vi.fn()
    state.auth = {
      patient: { id: 'patient-id' },
      provider: { id: 'provider-id', type: 'nurse_aide' },
      admin: false,
      workspace: 'patient',
      switchWorkspace,
      signOut,
    }
    render(<MemoryRouter initialEntries={['/dashboard']}><WorkspaceSwitcher /><Routes><Route path="/dashboard" element={<div>Patient workspace</div>} /><Route path="/provider" element={<div>Provider workspace</div>} /><Route path="/admin/provider-applications" element={<div>Admin workspace</div>} /></Routes></MemoryRouter>)
    const select = screen.getByRole('combobox', { name: 'Switch workspace' })
    expect(select).toHaveTextContent('Patient Dashboard')
    expect(select).toHaveTextContent('Provider Workspace · Nurse Aide')
    expect(select).not.toHaveTextContent('Admin Provider Review')
    await user.selectOptions(select, 'provider')
    expect(await screen.findByText('Provider workspace')).toBeInTheDocument()
    expect(switchWorkspace).toHaveBeenCalledWith('provider')
    expect(signOut).not.toHaveBeenCalled()
  })

  it('includes Admin only when the server-resolved admin identity is present', () => {
    state.auth = { patient: { id: 'patient-id' }, provider: null, admin: true, workspace: null, switchWorkspace: vi.fn() }
    render(<MemoryRouter><WorkspaceSwitcher /></MemoryRouter>)
    expect(screen.getByRole('option', { name: 'Patient Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Admin Provider Review' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Provider Workspace/ })).not.toBeInTheDocument()
  })

  it('hides switching when only one authorized workspace exists', () => {
    state.auth = { patient: { id: 'patient-id' }, provider: null, admin: false, workspace: 'patient', switchWorkspace: vi.fn() }
    const { container } = render(<MemoryRouter><WorkspaceSwitcher /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
  })
})
