import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { loadAuthorizedPatient, signInPatient, signOutPatient } from '../../services/authService.js'
import { supabase, supabaseConfiguration } from '../../lib/supabase.js'

const AuthContext = createContext(null)

export function AuthProvider({ children, client = supabase, configuration = supabaseConfiguration }) {
  const [state, setState] = useState({ status: client ? 'loading' : 'fixture', session: null, user: null, patient: null })
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
  }, [client, hydrateSession])

  const signIn = useCallback(async (credentials) => {
    const result = await signInPatient(credentials, client)
    setState({ status: 'authenticated', session: result.session, user: result.user, patient: result.patient })
    return result
  }, [client])

  const signOut = useCallback(async () => {
    await signOutPatient(client)
    setState({ status: client ? 'anonymous' : 'fixture', session: null, user: null, patient: null })
  }, [client])

  const continueWithoutAccount = useCallback((fullName) => {
    setState({
      status: 'authenticated',
      session: null,
      user: null,
      patient: { full_name: fullName?.trim() || 'EasyCare Patient', isTemporary: true },
    })
  }, [])

  const value = useMemo(() => ({
    ...state,
    signIn,
    signOut,
    continueWithoutAccount,
    isFixtureMode: configuration.mode === 'fixture',
    isAuthenticated: state.status === 'authenticated',
  }), [state, signIn, signOut, configuration.mode])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
