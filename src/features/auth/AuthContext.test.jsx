import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext.jsx'
import { ProtectedRoute, PublicOnlyRoute } from './RouteGuards.jsx'

const configured = { mode: 'supabase', isConfigured: true, message: '' }

function createClient(session = null) {
  const profile = { id: 'patient-1', auth_user_id: 'user-1', full_name: 'Synthetic Patient', preferred_language: 'en', status: 'active' }
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    single: vi.fn().mockResolvedValue({ data: profile, error: null }),
  }
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => query),
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

  it('keeps protected demo routes available in fixture mode', () => {
    render(
      <AuthProvider client={null} configuration={{ mode: 'fixture', isConfigured: false }}>
        <MemoryRouter initialEntries={['/appointments']}>
          <Routes>
            <Route element={<ProtectedRoute />}><Route path="/appointments" element={<div>Fixture appointments</div>} /></Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )
    expect(screen.getByText('Fixture appointments')).toBeInTheDocument()
  })
})
