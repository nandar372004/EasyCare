import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { deriveInternalEmail } from '../../lib/phoneIdentity.js'
import { AuthProvider, useAuth } from './AuthContext.jsx'
import { ProtectedRoute, PublicOnlyRoute } from './RouteGuards.jsx'
import { RegisterPage } from './RegisterPage.jsx'

const registrationMock = vi.hoisted(() => ({ registerPatient: vi.fn() }))

vi.mock('../../services/registrationService.js', () => ({
  registerPatient: (...args) => registrationMock.registerPatient(...args),
  submitRegistration: vi.fn(),
}))

const configuration = { mode: 'supabase', isConfigured: true, message: '' }

function SessionMarker() {
  const auth = useAuth()
  return <div>Active patient: {auth.patient?.id ?? 'none'} ({auth.patient?.full_name ?? 'none'})</div>
}

function createAccountStore() {
  const store = {
    authUsers: new Map([['user-A', { id: 'user-A' }]]),
    profiles: new Map([['user-A', { id: 'user-A', role: 'patient', full_name: 'Account A' }]]),
    patients: new Map([['user-A', { id: 'patient-A', auth_user_id: 'user-A', full_name: 'Account A', status: 'active' }]]),
    emailToUser: new Map(),
    currentSession: { access_token: 'account-A-token', user: { id: 'user-A' } },
    listeners: new Set(),
  }

  const emit = (event, session) => store.listeners.forEach((listener) => listener(event, session))
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: store.currentSession } })),
      onAuthStateChange: vi.fn((listener) => {
        store.listeners.add(listener)
        return { data: { subscription: { unsubscribe: () => store.listeners.delete(listener) } } }
      }),
      signOut: vi.fn(async ({ scope }) => {
        expect(scope).toBe('local')
        store.currentSession = null
        emit('SIGNED_OUT', null)
        return { error: null }
      }),
      signInWithPassword: vi.fn(async ({ email, password }) => {
        const userId = store.emailToUser.get(email)
        const account = userId && store.authUsers.get(userId)
        if (!account || account.password !== password) return { data: null, error: new Error('invalid credentials') }
        store.currentSession = { access_token: `${userId}-token`, user: { id: userId } }
        emit('SIGNED_IN', store.currentSession)
        return { data: { session: store.currentSession, user: store.currentSession.user }, error: null }
      }),
    },
    from: vi.fn((table) => {
      if (table !== 'patients') throw new Error(`Unexpected table ${table}`)
      let userId
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn((column, value) => { if (column === 'auth_user_id') userId = value; return chain }),
        single: vi.fn(async () => {
          const patient = store.patients.get(userId)
          return patient ? { data: patient, error: null } : { data: null, error: new Error('patient not found') }
        }),
      }
      return chain
    }),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  }
  return { store, client }
}

function TestRoutes({ client, initialEntry = '/register' }) {
  return <AuthProvider client={client} configuration={configuration}>
    <SessionMarker />
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<PublicOnlyRoute />}><Route path="/register" element={<RegisterPage />} /></Route>
        <Route element={<ProtectedRoute />}><Route path="/dashboard" element={<div>Dashboard for current patient</div>} /></Route>
        <Route path="/onboarding" element={<div>Onboarding for current patient</div>} />
        <Route path="/login" element={<div>Sign in</div>} />
      </Routes>
    </MemoryRouter>
  </AuthProvider>
}

describe('Create Account with an existing patient session', () => {
  it('clears Account A before creating and signing in as a separate Account B, then restores B after refresh', async () => {
    const user = userEvent.setup()
    const { store, client } = createAccountStore()
    const accountAAtStart = structuredClone({
      authUser: store.authUsers.get('user-A'),
      profile: store.profiles.get('user-A'),
      patient: store.patients.get('user-A'),
    })

    registrationMock.registerPatient.mockImplementation(async (formValues) => {
      expect(store.currentSession).toBeNull()
      expect(formValues.termsAccepted).toBe(true)
      expect(formValues.privacyConsent).toBe(true)
      const email = await deriveInternalEmail(formValues.phoneNumber)
      store.authUsers.set('user-B', { id: 'user-B', password: formValues.password })
      store.profiles.set('user-B', { id: 'user-B', role: 'patient', full_name: formValues.fullName })
      store.patients.set('user-B', { id: 'patient-B', auth_user_id: 'user-B', full_name: formValues.fullName, status: 'active' })
      store.emailToUser.set(email, 'user-B')
      return { success: true }
    })
    store.authUsers.get('user-A').password = 'AccountA123'
    store.emailToUser.set(await deriveInternalEmail('09111111111'), 'user-A')

    const firstMount = render(<TestRoutes client={client} />)
    expect(await screen.findByText('Active patient: patient-A (Account A)')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'You’re currently signed in' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign Out and Create New Account' }))
    expect(await screen.findByRole('heading', { name: 'Create Your EasyCare Account' })).toBeInTheDocument()
    expect(await screen.findByText('Active patient: none (none)')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Phone Number'), '09 222 222 222')
    await user.type(screen.getByLabelText('Password'), 'AccountB123')
    await user.type(screen.getByLabelText('Confirm Password'), 'AccountB123')
    await user.type(screen.getByLabelText('Full Name'), 'Account B')
    await user.type(screen.getByLabelText('Date of Birth'), '1990-05-06')
    await user.click(screen.getByLabelText('I agree to the Terms of Service'))
    await user.click(screen.getByLabelText('I acknowledge the Privacy Policy and information handling'))
    await user.click(screen.getByRole('button', { name: 'Create Account' }))

    expect(await screen.findByText('Onboarding for current patient')).toBeInTheDocument()
    expect(screen.getByText('Active patient: patient-B (Account B)')).toBeInTheDocument()
    expect(store.currentSession.user.id).toBe('user-B')
    expect(store.authUsers.has('user-A')).toBe(true)
    expect(store.profiles.get('user-A')).toEqual(accountAAtStart.profile)
    expect(store.patients.get('user-A')).toEqual(accountAAtStart.patient)
    expect(store.authUsers.get('user-B').id).not.toBe(store.authUsers.get('user-A').id)
    expect(store.profiles.get('user-B').id).not.toBe(store.profiles.get('user-A').id)
    expect(store.patients.get('user-B').id).not.toBe(store.patients.get('user-A').id)

    firstMount.unmount()
    render(<TestRoutes client={client} initialEntry="/dashboard" />)
    await waitFor(() => expect(screen.getByText('Active patient: patient-B (Account B)')).toBeInTheDocument())
    expect(await screen.findByText('Dashboard for current patient')).toBeInTheDocument()
    expect(store.currentSession.user.id).toBe('user-B')
  })
})
