import { useLoginTranslation } from './useLoginTranslation.js'
import { useOptionalLocalization } from '../localization/LocalizationContext.jsx'
import './loginLocalization.css'
import { useState } from 'react'
import { Eye, EyeOff, LockKeyhole, Mail, Phone, ShieldCheck, Smartphone } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'
import { getPostLoginPath } from './RouteGuards.jsx'
import { GENERIC_AUTH_ERROR } from '../../services/authService.js'
import { DEMO_AUTH_ERROR, DEMO_CREDENTIALS } from '../../lib/prototypeMode.js'

export function LoginPage() {
  const t = useLoginTranslation()
  const language = useOptionalLocalization()?.language || 'en'
  const [phoneNumber, setPhoneNumber] = useState('')
  const [email, setEmail] = useState('')
  const [loginMethod, setLoginMethod] = useState('phone')
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
      const identity = loginMethod === 'email'
        ? await auth.signInWithEmail({ email, password })
        : await auth.signIn({ phoneNumber, password })
      setPassword('')
      navigate(getPostLoginPath(identity, location.state), { replace: true, state: identity.patient ? { openMorningVoiceAssistant: true } : undefined })
    } catch {
      setPassword('')
      setErrorMessage(auth.isPrototypeMode ? DEMO_AUTH_ERROR : GENERIC_AUTH_ERROR)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-card card ec-signin-card" lang={language}>
      <span className="ec-signin-lock"><LockKeyhole aria-hidden="true" /></span>
      <h2>{t("Sign In")}</h2>
      <p className="muted">{t("Access your EasyCare account")}</p>
      {auth.isPrototypeMode && <div className="success-message" role="note">{t("Demo login:")} {DEMO_CREDENTIALS.phoneNumber} / {DEMO_CREDENTIALS.password}</div>}
      <div className="ec-signin-tabs" role="tablist" aria-label={t("Sign-in method")}>
        <button type="button" role="tab" aria-selected={loginMethod === 'phone'} onClick={() => { setLoginMethod('phone'); setErrorMessage('') }}><Smartphone/>{t("Patient Phone")}</button>
        <button type="button" role="tab" aria-selected={loginMethod === 'email'} onClick={() => { setLoginMethod('email'); setErrorMessage('') }}><Mail/>{t("Admin / Provider Email")}</button>
      </div>
      {location.state?.restoreFailed && <div className="session-recovery-message" role="status">{t("Your secure session could not be restored. Sign in again to continue.")}</div>}
      {location.state?.signOutError && <div className="session-recovery-message" role="status">{t("Your session was cleared on this device. Sign in again when you’re ready.")}</div>}
      {location.state?.registered && <div className="success-message" role="status">{t("Registration completed. You can now sign in.")}</div>}
      {errorMessage && <div className="error-message" role="alert">{t(errorMessage)}</div>}
      <form className="auth-form" onSubmit={handleSubmit}>
        {loginMethod === 'phone' ? <>
          <label htmlFor="phone">{t("Phone Number")}</label>
          <div className="input-wrap"><Phone aria-hidden="true" /><input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder={t("Enter your phone number")} required /></div>
          <small className="ec-signin-hint">{t("Use your registered phone number. EasyCare opens the patient or verified provider workspace linked to your account.")}</small>
        </> : <>
          <label htmlFor="email">{t("Email")}</label>
          <div className="input-wrap"><Mail aria-hidden="true" /><input id="email" name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("Enter your email")} required /></div>
          <small className="ec-signin-hint">{t("Admin and Provider accounts sign in with email. EasyCare opens the workspace for your authorized role.")}</small>
        </>}
        <div className="label-row"><label htmlFor="password">{t("Password")}</label>{loginMethod === 'phone' && <Link to="/forgot-password">{t("Forgot Password?")}</Link>}</div>
        <div className="input-wrap password-login-wrap">
          <LockKeyhole aria-hidden="true" />
          <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("Enter your password")} required />
          <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={t(showPassword ? 'Hide password' : 'Show password')}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
        </div>
        <label className="ec-remember"><input type="checkbox" checked={rememberMe} onChange={(event)=>setRememberMe(event.target.checked)}/><span><b>{t("Remember me")}</b><small>{t("Keep me signed in on this device")}</small></span></label>
        <button className="button button--primary" type="submit" disabled={isSubmitting}><LockKeyhole/>{t(isSubmitting ? 'Signing In…' : 'Sign In')}</button>
      </form>
      <p className="auth-switch">{t("Don’t have an account?")} <Link to="/register">{t("Create Account")}</Link></p>
      <p className="auth-switch"><Link to="/provider/login">{t("Provider sign-in help")}</Link></p>
      <div className="ec-signin-privacy"><ShieldCheck/><span><b>{t("Your privacy is our priority.")}</b><small>{t("We use industry-standard security to keep your data safe and private.")}</small></span></div>
    </div>
  )
}
