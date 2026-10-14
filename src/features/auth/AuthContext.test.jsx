import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, SESSION_RESTORE_TIMEOUT_MS, useAuth } from './AuthContext.jsx'
import { AdminProtectedRoute, ProtectedRoute, ProviderProtectedRoute, PublicOnlyRoute } from './RouteGuards.jsx'
import { RegisterPage } from './RegisterPage.jsx'

const configured = { mode: 'supabase', isConfigured: true, message: '' }

it('requests wellness after patient hydration without repeating on rerender, and retries for a new login', async () => {
  const session = { access_token: 'session-one', user: { id: 'user-1' } }
  const client = createClient(session)
  let authEvent
  client.auth.onAuthStateChange.mockImplementation(callback => {
    authEvent = callback
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  const wellnessCalls = () => client.rpc.mock.calls.filter(([name]) => name === 'create_my_login_wellness_notification')
  const view = render(<AuthProvider client={client} configuration={configured}><div>First route</div></AuthProvider>)
  await waitFor(() => expect(wellnessCalls()).toHaveLength(1))
  view.rerender(<AuthProvider client={client} configuration={configured}><div>Another route</div></AuthProvider>)
  expect(wellnessCalls()).toHaveLength(1)
  await act(async () => authEvent('SIGNED_OUT', null))
  await act(async () => authEvent('SIGNED_IN', { ...session, access_token: 'session-two' }))
  await waitFor(() => expect(wellnessCalls()).toHaveLength(2))
})

function createClient(session = null, { patient, provider = null, providerSetup = null, admin = false, role, roleError = null } = {}) {
  const profileRole = role === undefined ? (admin ? 'admin' : provider || providerSetup ? 'provider' : 'patient') : role
  const profile = { id: 'patient-1', auth_user_id: 'user-1', full_name: 'Synthetic Patient', preferred_language: 'en', status: 'active' }
  const profilesQuery = {
    select: vi.fn(() => profilesQuery),
    eq: vi.fn(() => profilesQuery),
    maybeSingle: vi.fn().mockResolvedValue(roleError ? { data: null, error: roleError } : { data: profileRole ? { role: profileRole } : null, error: null }),
  }
  const patientQuery = {
    select: vi.fn(() => patientQuery),
    eq: vi.fn(() => patientQuery),
    maybeSingle: vi.fn().mockResolvedValue(patient === null ? { data: null, error: null } : { data: patient ?? profile, error: null }),
  }
  const queries = { profiles: profilesQuery, patients: patientQuery }
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { session: { access_token: 'admin-token', user: { id: 'admin-user' } }, user: { id: 'admin-user' } }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(table => queries[table]),
    queries,
    rpc: vi.fn(name => Promise.resolve({ data: name === 'is_main_admin' ? admin : name === 'get_my_provider_setup_identity' ? providerSetup ? [providerSetup] : provider ? [{ profile_role: 'provider', provider_id: provider.provider_id, provider_type: provider.provider_type, display_name: provider.display_name, account_status: 'active', setup_state: 'ready' }] : [] : [], error: null })),
  }
}

function LoginMarker() {
  const location = useLocation()
  return <div>Login destination: {location.state?.from ?? 'none'}</div>
}

function LogoutControl() {
  const auth = useAuth()
  return <button onClick={() => void auth.signOut()}>Logout test</button>
}

function CreateAccountLink() {
  return <Link to="/register">Create Account</Link>
}

function SessionMarker() {
  const auth = useAuth()
  return <div>Session: {auth.status} / {auth.patient?.full_name ?? 'none'}</div>
}

function WorkspaceStateMarker() {
  const auth = useAuth()
  return <div>Workspace: {auth.workspace ?? 'none'}</div>
}

function IdentityStateMarker() {
  const auth = useAuth()
  return <div>Identities: {auth.patient ? 'patient' : ''}{auth.provider ? ' provider' : ''}{auth.admin ? ' admin' : ''} / {auth.workspace ?? 'none'}</div>
}

function AdminEmailSignInControl() {
  const auth = useAuth()
  return <><button onClick={() => void auth.signInAdminWithEmail({ email: 'admin@example.test', password: 'Synthetic123' })}>Sign in admin email</button><div>Admin state: {auth.admin ? 'yes' : 'no'} / {auth.workspace}</div></>
}

function ProviderEmailSignInControl() {
  const auth = useAuth()
  return <><button onClick={() => void auth.signInAsProvider({ email: 'provider@example.test', password: 'InitialPass123' })}>Sign in provider email</button><div>Provider state: {auth.providerSetup?.setupState ?? auth.provider?.id ?? 'none'} / {auth.workspace}</div></>
}

function RegistrationRoutes() {
  return <>
    <SessionMarker />
    <Routes>
      <Route path="/login" element={<CreateAccountLink />} />
      <Route element={<PublicOnlyRoute />}><Route path="/register" element={<RegisterPage />} /></Route>
      <Route path="/dashboard" element={<div>Dashboard destination</div>} />
      <Route path="/onboarding" element={<div>Onboarding destination</div>} />
      <Route path="/provider" element={<div>Provider destination</div>} />
    </Routes>
  </>
}

describe('session and route protection', () => {
  it('restores a valid patient session after refresh', async () => {
    const session = { access_token: 'synthetic-token', user: { id: 'user-1' } }
    const client = createClient(session)
    render(
      <AuthProvider client={client} configuration={configured}>
        <MemoryRouter initialEntries={['/appointments']}>
          <Routes>
            <Route element={<ProtectedRoute />}><Route path="/appointments" element={<div>Protected appointments</div>} /></Route>
            <Route path="/login" element={<LoginMarker />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )
    expect(await screen.findByText('Protected appointments')).toBeInTheDocument()
    expect(client.auth.getSession).toHaveBeenCalledOnce()
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('restores a verified provider-only session without requiring a patient row', async () => {
    const session = { access_token: 'provider-token', user: { id: 'provider-user' } }
    const providerSetup = { profile_role: 'provider', provider_id: 'provider-id', provider_type: 'doctor', display_name: 'Dr Example', account_status: 'active', setup_state: 'ready' }
    const client = createClient(session, { role: 'provider', patient: null, providerSetup })
    render(<AuthProvider client={client} configuration={configured}><MemoryRouter initialEntries={['/provider']}><Routes><Route element={<ProviderProtectedRoute />}><Route path="/provider" element={<div>Provider workspace restored</div>} /></Route><Route path="/provider/login" element={<div>Provider login</div>} /></Routes></MemoryRouter></AuthProvider>)
    expect(await screen.findByText('Provider workspace restored')).toBeInTheDocument()
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(['profiles'])
    expect(client.rpc).toHaveBeenCalledWith('get_my_provider_setup_identity')
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('resolves a provider workspace by role without loading patient identity', async () => {
    const session = { access_token: 'provider-token', user: { id: 'provider-user' } }
    const client = createClient(session, { role: 'provider', patient: null, providerSetup: { profile_role: 'provider', provider_id: 'provider-id', provider_type: 'nurse_aide', display_name: 'Example Nurse', account_status: 'active', setup_state: 'ready' } })
    render(<AuthProvider client={client} configuration={configured}><SessionMarker /><WorkspaceStateMarker /></AuthProvider>)
    expect(await screen.findByText('Workspace: provider')).toBeInTheDocument()
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(['profiles'])
  })

  it('restores an authorized main-admin session without a patient or provider row', async () => {
    const session = { access_token: 'admin-token', user: { id: 'admin-user' } }
    const client = createClient(session, { role: 'admin', patient: null, admin: true })
    render(<AuthProvider client={client} configuration={configured}><MemoryRouter initialEntries={['/admin/provider-applications']}><Routes><Route element={<AdminProtectedRoute />}><Route path="/admin/provider-applications" element={<div>Admin review queue</div>} /></Route><Route path="/login" element={<div>Login</div>} /><Route path="/dashboard" element={<div>Patient dashboard</div>} /></Routes></MemoryRouter></AuthProvider>)
    expect(await screen.findByText('Admin review queue')).toBeInTheDocument()
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(['profiles'])
    expect(client.rpc).toHaveBeenCalledWith('is_main_admin')
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('keeps an authenticated session when provider/setup identities are absent and admin is false', async () => {
    const session = { access_token: 'patient-token', user: { id: 'user-1' } }
    const client = createClient(session)
    render(<AuthProvider client={client} configuration={configured}><SessionMarker /><WorkspaceStateMarker /></AuthProvider>)
    expect(await screen.findByText('Session: authenticated / Synthetic Patient')).toBeInTheDocument()
    expect(screen.getByText('Workspace: patient')).toBeInTheDocument()
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(['profiles', 'patients'])
    expect(client.rpc.mock.calls).toEqual([['create_my_login_wellness_notification']])
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('preserves the session if every identity lookup returns no role', async () => {
    const session = { access_token: 'session-token', user: { id: 'unmapped-user' } }
    const client = createClient(session, { role: null, patient: null })
    render(<AuthProvider client={client} configuration={configured}><SessionMarker /></AuthProvider>)
    expect(await screen.findByText('Session: authenticated / none')).toBeInTheDocument()
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('does not issue a logout when local Supabase session lookup rejects', async () => {
    const client = createClient(null)
    client.auth.getSession.mockRejectedValueOnce(new Error('session storage unavailable'))
    render(<AuthProvider client={client} configuration={configured}><MemoryRouter initialEntries={['/appointments']}><Routes><Route element={<ProtectedRoute />}><Route path="/appointments" element={<div>Protected appointments</div>} /></Route><Route path="/login" element={<LoginMarker />} /></Routes></MemoryRouter></AuthProvider>)
    expect(await screen.findByText('Login destination: /appointments')).toBeInTheDocument()
    expect(screen.queryByText(/Restoring your secure session/i)).not.toBeInTheDocument()
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('keeps a valid patient session when non-patient role resolution rejects', async () => {
    const client = createClient({ access_token: 'synthetic-token', user: { id: 'user-1' } }, { roleError: new Error('role lookup unavailable') })
    render(<AuthProvider client={client} configuration={configured}><MemoryRouter initialEntries={['/appointments']}><Routes><Route element={<ProtectedRoute />}><Route path="/appointments" element={<div>Protected appointments</div>} /></Route><Route path="/login" element={<LoginMarker />} /></Routes></MemoryRouter></AuthProvider>)
    expect(await screen.findByText('Login destination: /appointments')).toBeInTheDocument()
    expect(screen.queryByText(/Restoring your secure session/i)).not.toBeInTheDocument()
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('does not revoke a session merely because no patient, provider, or admin identity resolves', async () => {
    const client = createClient({ access_token: 'expired-synthetic-token', user: { id: 'unknown-user' } }, { role: null, patient: null })
    render(<AuthProvider client={client} configuration={configured}><MemoryRouter initialEntries={['/appointments']}><Routes><Route element={<ProtectedRoute />}><Route path="/appointments" element={<div>Protected appointments</div>} /></Route><Route path="/login" element={<LoginMarker />} /></Routes></MemoryRouter></AuthProvider>)
    expect(await screen.findByText('Login destination: /appointments')).toBeInTheDocument()
    expect(screen.queryByText(/Restoring your secure session/i)).not.toBeInTheDocument()
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('exits loading without issuing logout when session lookup never resolves', async () => {
    vi.useFakeTimers()
    try {
      const client = createClient(null)
      client.auth.getSession.mockReturnValue(new Promise(() => {}))
      render(<AuthProvider client={client} configuration={configured}><MemoryRouter initialEntries={['/appointments']}><Routes><Route element={<ProtectedRoute />}><Route path="/appointments" element={<div>Protected appointments</div>} /></Route><Route path="/login" element={<LoginMarker />} /></Routes></MemoryRouter></AuthProvider>)
      await act(async () => { await vi.advanceTimersByTimeAsync(SESSION_RESTORE_TIMEOUT_MS) })
      expect(screen.getByText('Login destination: /appointments')).toBeInTheDocument()
      expect(screen.queryByText(/Restoring your secure session/i)).not.toBeInTheDocument()
      expect(client.auth.signOut).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('sets the email-authenticated admin session only after the admin RPC succeeds', async () => {
    const client = createClient(null, { role: 'admin', patient: null, admin: true })
    render(<AuthProvider client={client} configuration={configured}><AdminEmailSignInControl /></AuthProvider>)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in admin email' }))
    expect(await screen.findByText('Admin state: yes / admin')).toBeInTheDocument()
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'admin@example.test', password: 'Synthetic123' })
    expect(client.rpc).toHaveBeenCalledWith('is_main_admin')
  })

  it('keeps an Admin-created provider authenticated and marks setup as required after email login', async () => {
    const providerSetup = { profile_role: 'provider', provider_id: 'p1', provider_type: 'nurse_aide', account_status: 'active', setup_state: 'setup_required' }
    const client = createClient(null, { role: 'provider', patient: null, providerSetup })
    render(<AuthProvider client={client} configuration={configured}><ProviderEmailSignInControl /></AuthProvider>)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in provider email' }))
    expect(await screen.findByText('Provider state: setup_required / provider-setup')).toBeInTheDocument()
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'provider@example.test', password: 'InitialPass123' })
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('does not expose admin routes to a normal patient session', async () => {
    const session = { access_token: 'patient-token', user: { id: 'user-1' } }
    const client = createClient(session)
    render(<AuthProvider client={client} configuration={configured}><MemoryRouter initialEntries={['/admin/provider-applications']}><Routes><Route element={<AdminProtectedRoute />}><Route path="/admin/provider-applications" element={<div>Admin review queue</div>} /></Route><Route path="/dashboard" element={<div>Patient dashboard</div>} /></Routes></MemoryRouter></AuthProvider>)
    expect(await screen.findByText('Patient dashboard')).toBeInTheDocument()
    expect(screen.queryByText('Admin review queue')).not.toBeInTheDocument()
  })

  it('keeps an admin without a patient or provider identity out of patient routes', async () => {
    const session = { access_token: 'admin-token', user: { id: 'admin-user' } }
    const client = createClient(session, { role: 'admin', patient: null, admin: true })
    render(<AuthProvider client={client} configuration={configured}><MemoryRouter initialEntries={['/dashboard']}><Routes><Route element={<ProtectedRoute />}><Route path="/dashboard" element={<div>Patient dashboard</div>} /></Route><Route path="/admin/provider-applications" element={<div>Admin review queue</div>} /><Route path="/login" element={<div>Login</div>} /></Routes></MemoryRouter></AuthProvider>)
    expect(await screen.findByText('Admin review queue')).toBeInTheDocument()
    expect(screen.queryByText('Patient dashboard')).not.toBeInTheDocument()
  })

  it('redirects logged-out direct access and preserves the intended route', async () => {
    const client = createClient(null)
    render(
      <AuthProvider client={client} configuration={configured}>
        <MemoryRouter initialEntries={['/appointments?tab=upcoming']}>
          <Routes>
            <Route element={<ProtectedRoute />}><Route path="/appointments" element={<div>Protected appointments</div>} /></Route>
            <Route path="/login" element={<LoginMarker />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )
    expect(await screen.findByText('Login destination: /appointments?tab=upcoming')).toBeInTheDocument()
  })

  it('redirects an authenticated patient away from login', async () => {
    const session = { access_token: 'synthetic-token', user: { id: 'user-1' } }
    const client = createClient(session)
    render(
      <AuthProvider client={client} configuration={configured}>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route element={<PublicOnlyRoute />}><Route path="/login" element={<div>Login form</div>} /></Route>
            <Route path="/dashboard" element={<div>Dashboard destination</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )
    expect(await screen.findByText('Dashboard destination')).toBeInTheDocument()
  })

  it('lets a signed-out user choose Create Account and reach the registration form', async () => {
    const user = userEvent.setup()
    render(<AuthProvider client={createClient(null)} configuration={configured}><MemoryRouter initialEntries={['/login']}><RegistrationRoutes /></MemoryRouter></AuthProvider>)
    await user.click(screen.getByRole('link', { name: 'Create Account' }))
    expect(await screen.findByRole('heading', { name: 'Create Your EasyCare Account' })).toBeInTheDocument()
  })

  it('shows an intentional new-account choice instead of silently redirecting a signed-in patient', async () => {
    const user = userEvent.setup()
    const session = { access_token: 'synthetic-token', user: { id: 'user-1' } }
    render(<AuthProvider client={createClient(session)} configuration={configured}><MemoryRouter initialEntries={['/login']}><RegistrationRoutes /></MemoryRouter></AuthProvider>)
    expect(await screen.findByText('Session: authenticated / Synthetic Patient')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Create Account' }))
    expect(await screen.findByRole('heading', { name: 'You’re currently signed in' })).toBeInTheDocument()
    expect(screen.getByText('Synthetic Patient', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.queryByText('Dashboard destination')).not.toBeInTheDocument()
    expect(screen.getByText('Session: authenticated / Synthetic Patient')).toBeInTheDocument()
  })

  it('continues to the dashboard without signing out the existing patient', async () => {
    const user = userEvent.setup()
    const session = { access_token: 'synthetic-token', user: { id: 'user-1' } }
    const client = createClient(session)
    render(<AuthProvider client={client} configuration={configured}><MemoryRouter initialEntries={['/register']}><RegistrationRoutes /></MemoryRouter></AuthProvider>)
    await screen.findByText('Session: authenticated / Synthetic Patient')
    await user.click(screen.getByRole('button', { name: 'Continue to Dashboard' }))
    expect(await screen.findByText('Dashboard destination')).toBeInTheDocument()
    expect(screen.getByText('Session: authenticated / Synthetic Patient')).toBeInTheDocument()
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('signs out explicitly, clears AuthContext, and then opens clean registration', async () => {
    const user = userEvent.setup()
    const session = { access_token: 'synthetic-token', user: { id: 'user-1' } }
    const client = createClient(session)
    render(<AuthProvider client={client} configuration={configured}><MemoryRouter initialEntries={['/register']}><RegistrationRoutes /></MemoryRouter></AuthProvider>)
    await screen.findByText('Session: authenticated / Synthetic Patient')
    await user.click(screen.getByRole('button', { name: 'Sign Out and Create New Account' }))
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(await screen.findByRole('heading', { name: 'Create Your EasyCare Account' })).toBeInTheDocument()
    expect(screen.getByText('Session: anonymous / none')).toBeInTheDocument()
  })

  it('clears the Supabase session on logout', async () => {
    const user = userEvent.setup()
    const session = { access_token: 'synthetic-token', user: { id: 'user-1' } }
    const client = createClient(session)
    render(
      <AuthProvider client={client} configuration={configured}>
        <LogoutControl />
      </AuthProvider>,
    )
    await waitFor(() => expect(client.from).toHaveBeenCalledWith('patients'))
    await user.click(screen.getByRole('button', { name: 'Logout test' }))
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('clears patient, provider, admin and workspace state immediately on logout', async () => {
    const session = { access_token: 'provider-token', user: { id: 'provider-user' } }
    const client = createClient(session, { role: 'provider', patient: null, providerSetup: { profile_role: 'provider', provider_id: 'provider-id', provider_type: 'nurse_aide', display_name: 'Example Nurse', account_status: 'active', setup_state: 'ready' } })
    function LogoutAllControl() {
      const auth = useAuth()
      return <button onClick={() => void auth.signOut()}>Sign out test</button>
    }
    render(<AuthProvider client={client} configuration={configured}><IdentityStateMarker /><LogoutAllControl /></AuthProvider>)
    await screen.findByText((_, element) => element?.textContent?.replace(/\s+/g, ' ').trim() === 'Identities: provider / provider')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out test' }))
    expect(await screen.findByText((_, element) => element?.textContent?.replace(/\s+/g, ' ').trim() === 'Identities: / none')).toBeInTheDocument()
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('guards protected routes even when fixture data is selected', () => {
    render(
      <AuthProvider client={null} configuration={{ mode: 'fixture', isConfigured: false }}>
        <MemoryRouter initialEntries={['/appointments']}>
          <Routes>
            <Route element={<ProtectedRoute />}><Route path="/appointments" element={<div>Fixture appointments</div>} /></Route>
            <Route path="/login" element={<div>Prototype login</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )
    expect(screen.getByText('Prototype login')).toBeInTheDocument()
  })
})
