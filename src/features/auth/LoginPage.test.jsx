import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { GENERIC_AUTH_ERROR } from '../../services/authService.js'
import { LoginPage } from './LoginPage.jsx'
import { AuthLayout } from '../../app/AuthLayout.jsx'
import { LocalizationProvider } from '../localization/LocalizationContext.jsx'

const { auth } = vi.hoisted(() => ({ auth: {
  isPrototypeMode: false,
  signIn: vi.fn(),
  signInWithEmail: vi.fn(),
} }))

vi.mock('./AuthContext.jsx', () => ({ useAuth: () => auth }))

function renderLogin() {
  return render(<MemoryRouter initialEntries={['/login']}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/admin/provider-applications" element={<p>Admin review queue</p>} />
    <Route path="/dashboard" element={<p>Patient dashboard</p>} />
    <Route path="/provider" element={<p>Provider workspace</p>} />
    <Route path="/provider/setup" element={<p>Provider setup</p>} />
    <Route path="/workspace" element={<p>Workspace choice</p>} />
  </Routes></MemoryRouter>)
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  it('switches the complete login screen and retains entered credentials and language preference', () => {
    const view = render(<MemoryRouter initialEntries={['/login']}><LocalizationProvider><Routes><Route element={<AuthLayout />}><Route path="/login" element={<LoginPage />} /></Route></Routes></LocalizationProvider></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '09123456789' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'ExamplePassword' } })
    fireEvent.click(screen.getByRole('button', { name: 'Myanmar', exact: true }))
    expect(screen.getByLabelText('ဖုန်းနံပါတ်')).toHaveValue('09123456789')
    expect(screen.getByLabelText('စကားဝှက်')).toHaveValue('ExamplePassword')
    expect(screen.getByPlaceholderText('သင့်စကားဝှက် ဖြည့်ပါ')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ပြန်လည်ကြိုဆိုပါသည်။')
    expect(screen.getByRole('link', { name: 'အကောင့်ဖွင့်ရန်' })).toHaveAttribute('href', '/register')
    expect(sessionStorage.getItem('easycare-language')).toBe('my')
    fireEvent.click(screen.getByRole('button', { name: 'English', exact: true }))
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()
    expect(screen.getByLabelText('Phone Number')).toHaveValue('09123456789')
    fireEvent.click(screen.getByRole('button', { name: 'Myanmar', exact: true }))
    view.unmount()
    render(<MemoryRouter><LocalizationProvider><LoginPage /></LocalizationProvider></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'အကောင့်ဝင်ရန်' })).toBeInTheDocument()
  })

  it.each(['phone', 'email'])('keeps the %s sign-in call unchanged in Burmese', async method => {
    sessionStorage.setItem('easycare-language', 'my')
    auth.signIn.mockResolvedValue({ patient: { id: 'patient-1' } })
    auth.signInWithEmail.mockResolvedValue({ role: 'admin', admin: true })
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/login']}><LocalizationProvider><Routes><Route path="/login" element={<LoginPage />} /><Route path="/dashboard" element={<p>Patient dashboard</p>} /><Route path="/admin/provider-applications" element={<p>Admin review queue</p>} /></Routes></LocalizationProvider></MemoryRouter>)
    if (method === 'email') {
      await user.click(screen.getByRole('tab', { name: 'စီမံသူ / ကျန်းမာရေးဝန်ထမ်း အီးမေးလ်' }))
      await user.type(screen.getByLabelText('အီးမေးလ်'), 'admin@example.test')
    } else await user.type(screen.getByLabelText('ဖုန်းနံပါတ်'), '09123456789')
    await user.type(screen.getByLabelText('စကားဝှက်'), 'Synthetic123')
    await user.click(screen.getByRole('button', { name: 'အကောင့်ဝင်ရန်' }))
    expect(method === 'email' ? auth.signInWithEmail : auth.signIn).toHaveBeenCalledWith(method === 'email' ? { email: 'admin@example.test', password: 'Synthetic123' } : { phoneNumber: '09123456789', password: 'Synthetic123' })
    expect(await screen.findByText(method === 'email' ? 'Admin review queue' : 'Patient dashboard')).toBeInTheDocument()
  })

  it('shows Burmese sign-in errors while preserving password clearing', async () => {
    sessionStorage.setItem('easycare-language', 'my')
    auth.signIn.mockRejectedValue(new Error(GENERIC_AUTH_ERROR))
    render(<MemoryRouter><LocalizationProvider><LoginPage /></LocalizationProvider></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('ဖုန်းနံပါတ်'), { target: { value: '09123456789' } })
    fireEvent.change(screen.getByLabelText('စကားဝှက်'), { target: { value: 'ExamplePassword' } })
    fireEvent.click(screen.getByRole('button', { name: 'အကောင့်ဝင်ရန်' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('အကောင့်ဝင်၍ မရပါ။')
    expect(screen.getByLabelText('စကားဝှက်')).toHaveValue('')
  })

  it('authenticates Admin with email and routes by the resolved profile role', async () => {
    auth.signInWithEmail.mockResolvedValue({ role: 'admin', admin: true, patient: null, provider: null })
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('tab', { name: 'Admin / Provider Email' }))
    await user.type(screen.getByLabelText('Email'), 'admin@example.test')
    await user.type(screen.getByLabelText('Password'), 'Synthetic123')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(auth.signInWithEmail).toHaveBeenCalledWith({ email: 'admin@example.test', password: 'Synthetic123' })
    expect(await screen.findByText('Admin review queue')).toBeInTheDocument()
  })

  it('authenticates a setup-required Doctor with email and routes to provider setup', async () => {
    auth.signInWithEmail.mockResolvedValue({ role: 'provider', providerSetup: { id: 'doctor-id', type: 'doctor', accountStatus: 'active', setupState: 'setup_required' } })
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('tab', { name: 'Admin / Provider Email' }))
    await user.type(screen.getByLabelText('Email'), 'doctor@example.test')
    await user.type(screen.getByLabelText('Password'), 'Synthetic123')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(auth.signInWithEmail).toHaveBeenCalledWith({ email: 'doctor@example.test', password: 'Synthetic123' })
    expect(await screen.findByText('Provider setup')).toBeInTheDocument()
  })

  it('routes an email-authenticated ready Doctor to the Doctor workspace', async () => {
    auth.signInWithEmail.mockResolvedValue({ role: 'provider', provider: { id: 'doctor-id', type: 'doctor' }, providerSetup: { id: 'doctor-id', type: 'doctor', accountStatus: 'active', setupState: 'ready' } })
    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByRole('tab', { name: 'Admin / Provider Email' }))
    await user.type(screen.getByLabelText('Email'), 'doctor@example.test')
    await user.type(screen.getByLabelText('Password'), 'Synthetic123')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))
    expect(await screen.findByText('Provider workspace')).toBeInTheDocument()
  })

  it('keeps phone sign-in as the default and preserves its existing call contract', async () => {
    auth.signIn.mockResolvedValue({ admin: false, patient: { id: 'patient-1' }, provider: null })
    const user = userEvent.setup()
    renderLogin()

    expect(screen.getByRole('tab', { name: 'Patient Phone' })).toHaveAttribute('aria-selected', 'true')
    await user.type(screen.getByLabelText('Phone Number'), '09123456789')
    await user.type(screen.getByLabelText('Password'), 'Synthetic123')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(auth.signIn).toHaveBeenCalledWith({ phoneNumber: '09123456789', password: 'Synthetic123' })
    expect(await screen.findByText('Patient dashboard')).toBeInTheDocument()
    expect(auth.signInWithEmail).not.toHaveBeenCalled()
  })

  it('does not treat Provider accounts as phone-login accounts', async () => {
    auth.signIn.mockRejectedValue(new Error(GENERIC_AUTH_ERROR))
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByLabelText('Phone Number'), '09123456789')
    await user.type(screen.getByLabelText('Password'), 'Synthetic123')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(GENERIC_AUTH_ERROR)
    expect(screen.queryByText('Provider workspace')).not.toBeInTheDocument()
  })

  it('explains how to recover when session restoration expires', () => {
    render(<MemoryRouter initialEntries={[{ pathname: '/login', state: { restoreFailed: true } }]}><Routes><Route path="/login" element={<LoginPage />} /></Routes></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent('Your secure session could not be restored. Sign in again to continue.')
  })
})
