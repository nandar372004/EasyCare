import { useState } from 'react'
import { Eye, EyeOff, LockKeyhole, Mail, Phone, ShieldCheck, Smartphone } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'
import { getSafeReturnPath } from './RouteGuards.jsx'
import { GENERIC_AUTH_ERROR } from '../../services/authService.js'
import { DEMO_AUTH_ERROR, DEMO_CREDENTIALS } from '../../lib/prototypeMode.js'

export function LoginPage() {
  const [phoneNumber, setPhoneNumber] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  async function handleSubmit(event) {
    event.preventDefault()
    setErrorMessage('')

    setIsSubmitting(true)
    try {
      await auth.signIn({ phoneNumber, password })
      setPassword('')
      navigate(getSafeReturnPath(location.state), { replace: true })
    } catch {
      setPassword('')
      setErrorMessage(auth.isPrototypeMode ? DEMO_AUTH_ERROR : GENERIC_AUTH_ERROR)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-card card ec-signin-card">
      <span className="ec-signin-lock"><LockKeyhole aria-hidden="true" /></span>
      <h2>Sign In</h2>
      <p className="muted">Access your EasyCare account</p>
      {auth.isPrototypeMode && <div className="success-message" role="note">Demo login: {DEMO_CREDENTIALS.phoneNumber} / {DEMO_CREDENTIALS.password}</div>}
      <div className="ec-signin-tabs" role="tablist" aria-label="Sign-in method"><button type="button" role="tab" aria-selected="true"><Smartphone/>Phone Number</button><button type="button" role="tab" aria-selected="false" aria-disabled="true" title="Email sign-in is not available yet"><Mail/>Email (Optional)</button></div>
      {location.state?.registered && <div className="success-message" role="status">Registration completed. You can now sign in.</div>}
      {errorMessage && <div className="error-message" role="alert">{errorMessage}</div>}
      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="phone">Phone Number</label>
        <div className="input-wrap"><Phone aria-hidden="true" /><input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="Enter your phone number" required /></div>
        <small className="ec-signin-hint">Use your registered phone number to sign in.</small>
        <div className="label-row"><label htmlFor="password">Password</label><Link to="/forgot-password">Forgot Password?</Link></div>
        <div className="input-wrap password-login-wrap">
          <LockKeyhole aria-hidden="true" />
          <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required />
          <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
        </div>
        <label className="ec-remember"><input type="checkbox" checked={rememberMe} onChange={(event)=>setRememberMe(event.target.checked)}/><span><b>Remember me</b><small>Keep me signed in on this device</small></span></label>
        <button className="button button--primary" type="submit" disabled={isSubmitting}><LockKeyhole/>{isSubmitting ? 'Signing In…' : 'Sign In'}</button>
      </form>
      <p className="auth-switch">Don’t have an account? <Link to="/register">Create Account</Link></p>
      <div className="ec-signin-privacy"><ShieldCheck/><span><b>Your privacy is our priority.</b><small>We use industry-standard security to keep your data safe and private.</small></span></div>
    </div>
  )
}
