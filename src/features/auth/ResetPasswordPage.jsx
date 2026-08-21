import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { canOpenDemoPasswordReset, demonstratePasswordReset } from '../../services/passwordResetDemoService.js'

function PasswordField({ id, label, value, onChange, error, inputRef }) {
  const [visible, setVisible] = useState(false)
  return <div className="form-field"><label htmlFor={id}>{label}</label><div className="password-control"><input ref={inputRef} className="form-control" id={id} type={visible ? 'text' : 'password'} autoComplete="new-password" value={value} onChange={onChange} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} /><button type="button" onClick={() => setVisible((shown) => !shown)} aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}>{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button></div>{error && <span className="field-error" id={`${id}-error`}>{error}</span>}</div>
}

export function ResetPasswordPage() {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [success, setSuccess] = useState(false)
  const firstFieldRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!success && !canOpenDemoPasswordReset()) navigate('/forgot-password', { replace: true })
  }, [navigate, success])

  function handleSubmit(event) {
    event.preventDefault()
    const result = demonstratePasswordReset(newPassword, confirmPassword)
    if (!result.success) {
      setErrors(result.errors ?? {})
      firstFieldRef.current?.focus()
      return
    }
    setNewPassword('')
    setConfirmPassword('')
    setErrors({})
    setSuccess(true)
  }

  return (
    <section className="auth-card card demo-reset-card">
      <span className="eyebrow">Simulated password reset</span>
      <h2>Reset Password</h2>
      <div className="demo-warning" role="note"><strong>Presentation Demo — No real SMS is sent.</strong><span>No Supabase password will be changed.</span></div>
      {success ? <><div className="success-message" role="status">Password reset demonstrated successfully. No production SMS verification occurred.</div><Link className="button button--primary" to="/login">Return to Login</Link></> : <form className="auth-form" onSubmit={handleSubmit}><PasswordField id="new-password" label="New Password" inputRef={firstFieldRef} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} error={errors.newPassword} /><span className="field-hint">At least 8 characters, including one letter and one number.</span><PasswordField id="confirm-new-password" label="Confirm Password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} error={errors.confirmPassword} /><button className="button button--primary" type="submit">Demonstrate Password Reset</button></form>}
    </section>
  )
}
