import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { loadAuthorizedPatient, signInPatient, signOutPatient } from '../../services/authService.js'
import { supabase, supabaseConfiguration } from '../../lib/supabase.js'
import { clearPrototypeSession, DEMO_AUTH_ERROR, DEMO_CREDENTIALS, HACKATHON_PROTOTYPE, loadPrototypeSession, savePrototypeSession } from '../../lib/prototypeMode.js'
import { normalizeMyanmarPhone } from './registrationSchema.js'

const AuthContext = createContext(null)

export function AuthProvider({ children, client = supabase, configuration = supabaseConfiguration }) {
  const prototypeActive = HACKATHON_PROTOTYPE && client === supabase
  const [state, setState] = useState(() => {
    const prototypeSession = loadPrototypeSession()
    if (prototypeActive) return prototypeSession
      ? { status: 'authenticated', session: prototypeSession, user: null, patient: { full_name: prototypeSession.fullName, isPrototype: true } }
      : { status: 'anonymous', session: null, user: null, patient: null }
    return { status: client ? 'loading' : 'fixture', session: null, user: null, patient: null }
  })
  const hydrationId = useRef(0)

  const hydrateSession = useCallback(async (session) => {
    const requestId = ++hydrationId.current
    if (!session?.user) {
      setState({ status: 'anonymous', session: null, user: null, patient: null })
      return
    }

    const patient = await loadAuthorizedPatient(session.user.id, client)
    if (requestId !== hydrationId.current) return

    if (!patient) {
      await client.auth.signOut({ scope: 'local' })
      setState({ status: 'anonymous', session: null, user: null, patient: null })
      return
    }

    setState({ status: 'authenticated', session, user: session.user, patient })
  }, [client])

  useEffect(() => {
    if (prototypeActive) return undefined
    if (!client) return undefined

    let active = true
    client.auth.getSession().then(({ data }) => {
      if (active) void hydrateSession(data.session)
    })

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (active) void hydrateSession(session)
    })

    return () => {
      active = false
      hydrationId.current += 1
      data.subscription.unsubscribe()
    }
  }, [client, hydrateSession, prototypeActive])

  const signIn = useCallback(async (credentials) => {
    if (prototypeActive) {
      if (normalizeMyanmarPhone(credentials.phoneNumber) !== normalizeMyanmarPhone(DEMO_CREDENTIALS.phoneNumber) || credentials.password !== DEMO_CREDENTIALS.password) throw new Error(DEMO_AUTH_ERROR)
      const prototypeSession = savePrototypeSession('Demo Patient')
      const result = { session: prototypeSession, user: null, patient: { full_name: prototypeSession.fullName, isPrototype: true } }
      setState({ status: 'authenticated', ...result })
      return result
    }
    const result = await signInPatient(credentials, client)
    setState({ status: 'authenticated', session: result.session, user: result.user, patient: result.patient })
    return result
  }, [client, prototypeActive])

  const signOut = useCallback(async () => {
    if (prototypeActive) {
      clearPrototypeSession()
      setState({ status: 'anonymous', session: null, user: null, patient: null })
      return
    }
    await signOutPatient(client)
    setState({ status: client ? 'anonymous' : 'fixture', session: null, user: null, patient: null })
  }, [client, prototypeActive])

  const registerPrototype = useCallback((fullName) => {
    const prototypeSession = savePrototypeSession(fullName)
    setState({
      status: 'authenticated',
      session: prototypeSession,
      user: null,
      patient: { full_name: prototypeSession.fullName, isPrototype: true },
    })
  }, [])

  const synchronizePatient = useCallback((patient) => {
    if (!patient?.id) return
    setState((current) => current.patient?.id === patient.id
      ? { ...current, patient: { ...current.patient, ...patient } }
      : current)
  }, [])

  const value = useMemo(() => ({
    ...state,
    signIn,
    signOut,
    registerPrototype,
    synchronizePatient,
    isPrototypeMode: prototypeActive,
    isFixtureMode: prototypeActive || configuration.mode === 'fixture',
    isAuthenticated: state.status === 'authenticated',
  }), [state, signIn, signOut, registerPrototype, synchronizePatient, configuration.mode, prototypeActive])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
