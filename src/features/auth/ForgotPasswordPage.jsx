import { useState } from 'react'
import { Phone } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { beginPasswordResetDemo, PASSWORD_RESET_DEMO_CONFIG } from '../../services/passwordResetDemoService.js'

export function ForgotPasswordPage() {
  const [phoneNumber, setPhoneNumber] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  function handleSubmit(event) {
    event.preventDefault()
    const result = beginPasswordResetDemo(phoneNumber)
    if (!result.success) return setError(result.error)
    navigate('/verify-reset-code')
  }

  return (
    <section className="auth-card card demo-reset-card">
      <span className="eyebrow">Simulated recovery</span>
      <h2>Forgot Password</h2>
      <div className="demo-warning" role="note"><strong>Presentation Demo — No real SMS is sent.</strong><span>This does not check or reveal whether arbitrary phone numbers have accounts.</span></div>
      <p className="muted">Use the configured synthetic demo phone: <strong>{PASSWORD_RESET_DEMO_CONFIG.phoneNumber}</strong></p>
      {error && <div className="error-message" role="alert">{error}</div>}
      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="reset-phone">Phone Number</label>
        <div className="input-wrap"><Phone aria-hidden="true" /><input id="reset-phone" type="tel" inputMode="tel" autoComplete="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} required /></div>
        <button className="button button--primary" type="submit">Continue Demo</button>
      </form>
      <Link className="text-link" to="/login">Return to Login</Link>
    </section>
  )
}
