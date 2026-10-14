import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { resolveAuthenticatedIdentity, signInAdminWithEmail as authenticateAdminWithEmail, signInPatient, signInProvider, signInWithEmail as authenticateEmail, signOutPatient } from '../../services/authService.js'
import { supabase, supabaseConfiguration } from '../../lib/supabase.js'
import { clearPrototypeSession, DEMO_AUTH_ERROR, DEMO_CREDENTIALS, HACKATHON_PROTOTYPE, loadPrototypeSession, savePrototypeSession } from '../../lib/prototypeMode.js'
import { normalizeMyanmarPhone } from './registrationSchema.js'

const AuthContext = createContext(null)
const emptyState = (status, restoreError = false) => ({ status, session: null, user: null, patient: null, provider: null, providerSetup: null, admin: false, workspace: null, restoreError })
export const SESSION_RESTORE_TIMEOUT_MS = 12_000

function resolveWorkspace({ patient, provider, admin }, preferred) {
  if (preferred === 'patient' && patient) return 'patient'
  if (preferred === 'provider' && provider) return 'provider'
  if (preferred === 'admin' && admin) return 'admin'
  const available = [patient && 'patient', provider && 'provider', admin && 'admin'].filter(Boolean)
  if (available.length === 1) return available[0]
  return null
}

function identityWorkspace(identity) {
  return resolveWorkspace(identity) ?? (identity.providerSetup?.setupState === 'ready' && identity.providerSetup.accountStatus === 'active'
    ? 'provider'
    : identity.providerSetup ? 'provider-setup' : null)
}

function withTimeout(promise, timeoutMs) {
  let timer
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Session restoration timed out')), Math.max(0, timeoutMs))
    }),
  ]).finally(() => clearTimeout(timer))
}

export function AuthProvider({ children, client = supabase, configuration = supabaseConfiguration }) {
  const prototypeActive = HACKATHON_PROTOTYPE && client === supabase
  const [state, setState] = useState(() => {
    const prototypeSession = loadPrototypeSession()
    if (prototypeActive) return prototypeSession
      ? { status: 'authenticated', session: prototypeSession, user: null, patient: { full_name: prototypeSession.fullName, isPrototype: true }, provider: null, workspace: 'patient' }
      : emptyState('anonymous')
    return emptyState(client ? 'loading' : 'fixture')
  })
  const hydrationId = useRef(0)
  const identityRequests = useRef(new Map())

  // JWT session identity is deduplicated by the existing server source-key index.
  // Token refresh and remount can safely retry; route changes cannot create rows.
  useEffect(() => {
    if (prototypeActive || !client?.rpc || !state.patient?.id || !state.session?.access_token) return
    void Promise.resolve(client.rpc('create_my_login_wellness_notification'))
      .catch(() => {}) // A notification failure must not prevent successful login.
  }, [client, prototypeActive, state.patient?.id, state.session?.access_token])

  const hydrateSession = useCallback(async (session, deadline = Date.now() + SESSION_RESTORE_TIMEOUT_MS) => {
    const requestId = ++hydrationId.current
    if (!session?.user) {
      setState(emptyState('anonymous'))
      return
    }
    try {
      const userId = session.user.id
      let identityRequest = identityRequests.current.get(userId)
      if (!identityRequest) {
        identityRequest = Promise.resolve().then(() => resolveAuthenticatedIdentity(userId, client))
        identityRequests.current.set(userId, identityRequest)
        identityRequest.finally(() => {
          if (identityRequests.current.get(userId) === identityRequest) identityRequests.current.delete(userId)
        }).catch(() => {})
      }
      const identity = await withTimeout(identityRequest, deadline - Date.now())
      if (requestId !== hydrationId.current) return
      const preferred = globalThis.localStorage?.getItem('easycare-workspace-preference')
      const workspace = identityWorkspace(identity, preferred)
      const hasIdentity = Boolean(identity.patient || identity.provider || identity.providerSetup || identity.admin)
      setState({ status: 'authenticated', session, user: session.user, ...identity, workspace, restoreError: !identity.role || !hasIdentity })
    } catch {
      if (requestId !== hydrationId.current) return
      setState({ ...emptyState('authenticated', true), session, user: session.user })
    }
  }, [client])

  useEffect(() => {
    if (prototypeActive || !client) return undefined
    let active = true
    const restoreDeadline = Date.now() + SESSION_RESTORE_TIMEOUT_MS
    const initialHydrationId = hydrationId.current
    Promise.resolve()
      .then(() => withTimeout(client.auth.getSession(), restoreDeadline - Date.now()))
      .then(({ data }) => { if (active) void hydrateSession(data.session, restoreDeadline) })
      .catch(() => {
        if (!active || hydrationId.current !== initialHydrationId) return
        hydrationId.current += 1
        setState(emptyState('anonymous', true))
      })
    const { data } = client.auth.onAuthStateChange((_event, session) => { if (active) void hydrateSession(session) })
    return () => { active = false; hydrationId.current += 1; data.subscription.unsubscribe() }
  }, [client, hydrateSession, prototypeActive])

  const signIn = useCallback(async (credentials) => {
    if (prototypeActive) {
      if (normalizeMyanmarPhone(credentials.phoneNumber) !== normalizeMyanmarPhone(DEMO_CREDENTIALS.phoneNumber) || credentials.password !== DEMO_CREDENTIALS.password) throw new Error(DEMO_AUTH_ERROR)
      const prototypeSession = savePrototypeSession('Demo Patient')
      const result = { session: prototypeSession, user: null, patient: { full_name: prototypeSession.fullName, isPrototype: true } }
      setState({ status: 'authenticated', ...result, provider: null, workspace: 'patient' })
      return result
    }
    const result = await signInPatient(credentials, client)
    const workspace = resolveWorkspace(result)
    if (workspace) globalThis.localStorage?.setItem('easycare-workspace-preference', workspace)
    else globalThis.localStorage?.removeItem('easycare-workspace-preference')
    setState({ status: 'authenticated', role: result.role, session: result.session, user: result.user, patient: result.patient, provider: result.provider ?? null, providerSetup: null, admin: result.admin === true, workspace })
    return result
  }, [client, prototypeActive])

  const acceptAuthenticatedIdentity = useCallback((result) => {
    const workspace = identityWorkspace(result)
    if (workspace) globalThis.localStorage?.setItem('easycare-workspace-preference', workspace)
    else globalThis.localStorage?.removeItem('easycare-workspace-preference')
    setState({ status: 'authenticated', role: result.role, session: result.session, user: result.user, patient: result.patient ?? null, provider: result.provider ?? null, providerSetup: result.providerSetup ?? null, admin: result.admin === true, workspace, restoreError: false })
    return result
  }, [])

  const signInWithEmail = useCallback(async (credentials) => {
    if (prototypeActive) throw new Error('Email sign-in is unavailable in the demo account.')
    return acceptAuthenticatedIdentity(await authenticateEmail(credentials, client))
  }, [client, prototypeActive, acceptAuthenticatedIdentity])

  const signInAdminWithEmail = useCallback(async (credentials) => {
    if (prototypeActive) throw new Error('Email sign-in is unavailable in the demo account.')
    return acceptAuthenticatedIdentity(await authenticateAdminWithEmail(credentials, client))
  }, [client, prototypeActive, acceptAuthenticatedIdentity])

  const signInAsProvider = useCallback(async (credentials) => {
    if (prototypeActive) throw new Error('Provider access is unavailable in the demo account.')
    const result = await signInProvider(credentials, client)
    return acceptAuthenticatedIdentity(result)
  }, [client, prototypeActive, acceptAuthenticatedIdentity])

  const switchWorkspace = useCallback((workspace) => {
    if (workspace === 'patient' && !state.patient) return false
    if (workspace === 'provider' && !state.provider) return false
    if (workspace === 'admin' && !state.admin) return false
    globalThis.localStorage?.setItem('easycare-workspace-preference', workspace)
    setState(current => ({ ...current, workspace }))
    return true
  }, [state.patient, state.provider, state.admin])

  const signOut = useCallback(async () => {
    hydrationId.current += 1
    globalThis.localStorage?.removeItem('easycare-workspace-preference')
    setState(emptyState(client ? 'anonymous' : 'fixture'))
    if (prototypeActive) clearPrototypeSession()
    else await signOutPatient(client)
    return true
  }, [client, prototypeActive])

  const registerPrototype = useCallback((fullName) => {
    const prototypeSession = savePrototypeSession(fullName)
    setState({ status: 'authenticated', session: prototypeSession, user: null, patient: { full_name: prototypeSession.fullName, isPrototype: true }, provider: null, workspace: 'patient' })
  }, [])

  const synchronizePatient = useCallback((patient) => {
    if (!patient?.id) return
    setState(current => current.patient?.id === patient.id ? { ...current, patient: { ...current.patient, ...patient } } : current)
  }, [])

  const refreshIdentity = useCallback(async () => {
    if (state.session) await hydrateSession(state.session)
  }, [hydrateSession, state.session])

  const value = useMemo(() => ({
    ...state, signIn, signInWithEmail, signInAdminWithEmail, signInAsProvider, signOut, switchWorkspace, registerPrototype, synchronizePatient, refreshIdentity,
    isPrototypeMode: prototypeActive, isFixtureMode: prototypeActive || configuration.mode === 'fixture',
    isAuthenticated: state.status === 'authenticated',
  }), [state, signIn, signInWithEmail, signInAdminWithEmail, signInAsProvider, signOut, switchWorkspace, registerPrototype, synchronizePatient, refreshIdentity, configuration.mode, prototypeActive])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
