import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { canOpenDemoCodeVerification, PASSWORD_RESET_DEMO_CONFIG, verifyPasswordResetDemoCode } from '../../services/passwordResetDemoService.js'

export function VerifyResetCodePage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    if (!canOpenDemoCodeVerification()) navigate('/forgot-password', { replace: true })
  }, [navigate])

  function handleSubmit(event) {
    event.preventDefault()
    const result = verifyPasswordResetDemoCode(code)
    if (!result.success) return setError(result.error)
    navigate('/reset-password')
  }

  return (
    <section className="auth-card card demo-reset-card">
      <span className="eyebrow">Simulated verification</span>
      <h2>Verify Reset Code</h2>
      <div className="demo-warning" role="note"><strong>Presentation Demo — No real SMS is sent.</strong><span>Demo verification code: <b>{PASSWORD_RESET_DEMO_CONFIG.verificationCode}</b></span></div>
      {error && <div className="error-message" role="alert">{error}</div>}
      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="demo-code">Demo Verification Code</label>
        <div className="input-wrap"><KeyRound aria-hidden="true" /><input id="demo-code" inputMode="numeric" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value)} /></div>
        <button className="button button--primary" type="submit">Verify Demo Code</button>
      </form>
      <Link className="text-link" to="/forgot-password">Restart Demo</Link>
    </section>
  )
}
