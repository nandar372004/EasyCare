import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { GENERIC_AUTH_ERROR, PROVIDER_ACCESS_ERROR } from '../../services/authService.js'
import { getPostLoginPath } from '../auth/RouteGuards.jsx'
import { DEMO_AUTH_ERROR } from '../../lib/prototypeMode.js'

export function ProviderLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  async function submit(event) {
    event.preventDefault()
    setMessage('')
    setBusy(true)
    try {
      const identity = await auth.signInAsProvider({ email, password })
      setPassword('')
      navigate(getPostLoginPath(identity, location.state), { replace: true })
    } catch (error) {
      setPassword('')
      setMessage(error?.message === PROVIDER_ACCESS_ERROR ? 'Provider access is unavailable or requires verification.' : error?.message === DEMO_AUTH_ERROR ? DEMO_AUTH_ERROR : GENERIC_AUTH_ERROR)
    } finally { setBusy(false) }
  }
  return <main className="provider-login-page">
    <section className="card auth-card">
      <span className="eyebrow">Healthcare Provider</span>
      <h1>Provider Sign In</h1>
      <p>Sign in with the email and password provided by your EasyCare administrator. Change the initial password and complete setup before using the Provider Workspace.</p>
      {location.state?.restoreFailed && <div className="session-recovery-message" role="status">Your secure session could not be restored. Sign in again to continue.</div>}
      {location.state?.signOutError && <div className="session-recovery-message" role="status">Your session was cleared on this device. Sign in again when you’re ready.</div>}
      {message && <div className="error-message" role="alert">{message}</div>}
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="provider-email">Email</label>
        <input className="form-control" id="provider-email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required />
        <label htmlFor="provider-password">Password</label>
        <input className="form-control" id="provider-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
        <button className="button button--primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in to Provider Workspace'}</button>
      </form>
      <p className="auth-switch"><Link to="/login">Patient Sign In</Link></p>
    </section>
  </main>
}
